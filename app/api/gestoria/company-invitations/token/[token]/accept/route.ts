import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Authenticated acceptance for an EXISTING TotalFactu company (plan section
// 6 / 26). This is the piece the audit found genuinely missing from the
// codebase: app/api/signup/route.ts only ever creates a brand-new user +
// company. Here the caller must already be logged in and must explicitly
// choose which of their own companies to link — never inferred from the
// invitation's target_email alone, which is exactly the "apropiarse de una
// empresa por email" attack the plan calls out (section 4/28). Knowing
// someone's email is never sufficient; only an authenticated admin of that
// specific company accepting is.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { companyId } = await req.json();
  if (!companyId || typeof companyId !== 'string') {
    return NextResponse.json({ error: 'companyId is required' }, { status: 400 });
  }

  const invitation = await prisma.gestoriaCompanyInvitation.findUnique({ where: { token: params.token } });
  if (!invitation) {
    return NextResponse.json({ error: 'Invalid invitation link' }, { status: 404 });
  }
  if (invitation.status !== 'pending' || invitation.expires_at < new Date()) {
    return NextResponse.json({ error: 'This invitation is no longer valid' }, { status: 410 });
  }

  // IDOR guard: the caller must actually be an admin of the company they're
  // trying to link — not just any authenticated user passing an arbitrary
  // companyId.
  const membership = await prisma.membership.findUnique({
    where: { user_id_company_id: { user_id: session.user.id, company_id: companyId } },
  });
  if (!membership || membership.role !== 'admin') {
    return NextResponse.json({ error: 'You are not an admin of this company' }, { status: 403 });
  }

  // Exclusivity guard (plan section 3): a company can only have one ACTIVE
  // gestoria relation at a time. The DB has a matching partial unique index
  // (prisma/migrations/add_gestoria_new_model.sql) as the real backstop
  // against concurrent requests — this check makes the common case return a
  // clear error instead of a raw constraint violation, and covers
  // "gestoria not yet migrated onto that index" environments too.
  //
  // NOT IMPLEMENTED / FUTURE FEATURE: transferring a company from one
  // gestoria to another. This is a deliberate MVP scope decision, not an
  // oversight or accidental error path — see plan section 5 ("El 409 actual
  // ... queda ACEPTADO para este MVP") and KNOWN LIMITATIONS in the
  // implementation report. When built, it will be a dedicated flow
  // requiring authorization from the company's own admin (never unilateral
  // by either gestoria), atomically closing the old relation and opening
  // the new one. Until then this 409 is the correct, final behavior: no
  // second relation is created, the existing relation is left completely
  // untouched, and the company keeps counting only for its current firm.
  const existingActive = await prisma.gestoriaClientRelation.findFirst({
    where: { client_company_id: companyId, status: 'active' },
  });
  if (existingActive) {
    if (existingActive.gestoria_company_id === invitation.gestoria_company_id) {
      // Idempotent: already linked to this same firm, treat as success.
      await prisma.gestoriaCompanyInvitation.update({
        where: { id: invitation.id },
        data: { status: 'accepted', accepted_at: new Date(), accepted_by_user_id: session.user.id },
      });
      return NextResponse.json({ success: true, relationId: existingActive.id, alreadyLinked: true });
    }
    return NextResponse.json(
      {
        error:
          'Esta empresa ya está gestionada por otra gestoría. El cambio de gestoría todavía no está disponible — pide a la gestoría actual que la desvincule primero.',
        code: 'ALREADY_MANAGED_BY_ANOTHER_GESTORIA',
      },
      { status: 409 },
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const relation = await tx.gestoriaClientRelation.create({
      data: {
        gestoria_company_id: invitation.gestoria_company_id,
        client_company_id: companyId,
        status: 'active',
        source: 'invitation',
        accepted_at: new Date(),
      },
    });
    await tx.gestoriaCompanyInvitation.update({
      where: { id: invitation.id },
      data: { status: 'accepted', accepted_at: new Date(), accepted_by_user_id: session.user.id },
    });
    return relation;
  });

  return NextResponse.json({ success: true, relationId: result.id }, { status: 201 });
}
