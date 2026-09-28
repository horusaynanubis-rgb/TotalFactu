import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { randomBytes } from 'crypto';
import { sendGestoriaCompanyInvitationEmail } from '@/lib/email';

// NEW MODEL invitations — mirrors the token/expiry/status shape of the
// legacy app/api/gestoria/invitations/route.ts (License-based) but is
// intentionally NOT tied to a License/seat. See
// prisma/schema.prisma#GestoriaCompanyInvitation and
// lib/gestoria-eligibility.ts for why the two models are kept separate.

export const dynamic = 'force-dynamic';

const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireGestoriaMembership(userId: string) {
  const membership = await prisma.membership.findFirst({
    where: { user_id: userId },
    select: { company_id: true, company: { select: { company_type: true, name: true } } },
    orderBy: { created_at: 'asc' },
  });
  if (!membership || membership.company.company_type !== 'gestoria') return null;
  return membership;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const membership = await requireGestoriaMembership(session.user.id);
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const invitations = await prisma.gestoriaCompanyInvitation.findMany({
    where: { gestoria_company_id: membership.company_id },
    orderBy: { created_at: 'desc' },
  });

  return NextResponse.json({ invitations });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { email, target_company_id } = await req.json();

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }

  const membership = await requireGestoriaMembership(session.user.id);
  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // No IDOR: target_company_id is optional metadata only (shown to the
  // gestoria as "who you think you're inviting"), never used to
  // auto-associate — acceptance always requires the invited user's own
  // explicit action (see [token]/accept). Still validate it isn't already
  // actively managed by ANOTHER gestoria, so the UI can surface that early
  // instead of only failing at accept time.
  if (target_company_id) {
    const existingActive = await prisma.gestoriaClientRelation.findFirst({
      where: { client_company_id: target_company_id, status: 'active' },
      select: { gestoria_company_id: true },
    });
    // NOT IMPLEMENTED / FUTURE FEATURE: transfer between gestorías — same
    // deliberate MVP boundary as [token]/accept, surfaced earlier here so
    // the gestoria finds out before sending the invitation, not after.
    if (existingActive && existingActive.gestoria_company_id !== membership.company_id) {
      return NextResponse.json(
        {
          error: 'Esta empresa ya está gestionada por otra gestoría. El cambio de gestoría todavía no está disponible.',
          code: 'ALREADY_MANAGED_BY_ANOTHER_GESTORIA',
        },
        { status: 409 },
      );
    }
  }

  const existingPending = await prisma.gestoriaCompanyInvitation.findFirst({
    where: { gestoria_company_id: membership.company_id, target_email: email, status: 'pending' },
  });
  if (existingPending) {
    return NextResponse.json({ error: 'A pending invitation already exists for this email.' }, { status: 409 });
  }

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_MS);

  const invitation = await prisma.gestoriaCompanyInvitation.create({
    data: {
      gestoria_company_id: membership.company_id,
      target_email: email,
      target_company_id: target_company_id || null,
      mode: target_company_id ? 'existing_company' : 'new_company',
      token,
      expires_at: expiresAt,
      created_by_user_id: session.user.id,
    },
  });

  const activationUrl = `${process.env.NEXTAUTH_URL || ''}/activar-empresa/${token}`;

  // Send the link directly to the invited address — see
  // lib/email.ts#sendGestoriaCompanyInvitationEmail for why this matters
  // (closes the "anyone holding this URL text can use it" gap). Best-effort:
  // a delivery failure never blocks invitation creation — the UI still
  // shows activation_url as a copyable fallback either way.
  const emailSent = await sendGestoriaCompanyInvitationEmail({
    toEmail: email,
    gestoriaName: membership.company.name,
    activationUrl,
    mode: invitation.mode as 'new_company' | 'existing_company',
  });

  return NextResponse.json({ invitation, activation_url: activationUrl, email_sent: emailSent }, { status: 201 });
}
