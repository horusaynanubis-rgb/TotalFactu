import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { FISCAL_DOCUMENT_STATUSES } from '@/lib/fiscal-document-types';

export const dynamic = 'force-dynamic';

async function resolveGestoriaAccess(userId: string, clientCompanyId: string) {
  const membership = await prisma.membership.findFirst({
    where: { user_id: userId },
    select: { company_id: true, company: { select: { company_type: true } } },
  });
  if (!membership || membership.company.company_type !== 'gestoria') return null;

  const license = await prisma.license.findFirst({
    where: {
      client_company_id: clientCompanyId,
      status: 'assigned',
      pack: { gestoria_company_id: membership.company_id },
    },
  });
  if (!license) return null;

  return { gestoriaCompanyId: membership.company_id };
}

// Gestoría can only flip status (available/reviewed) and attach an internal
// note — it can never edit the client's file metadata or delete the file.
// Every change is written to AuditLog for traceability.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { clientCompanyId: string; id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  const doc = await prisma.fiscalDocument.findUnique({ where: { id: params.id } });
  if (!doc || doc.company_id !== params.clientCompanyId) {
    return NextResponse.json({ message: 'Document not found' }, { status: 404 });
  }

  const body = await request.json();
  const { status, gestoria_notes } = body;

  if (status !== undefined && !FISCAL_DOCUMENT_STATUSES.includes(status)) {
    return NextResponse.json({ message: 'Invalid status' }, { status: 400 });
  }

  const data: Record<string, any> = {};
  if (status !== undefined) {
    data.status = status;
    data.reviewed_at = status === 'reviewed' ? new Date() : null;
    data.reviewed_by_user_id = status === 'reviewed' ? session.user.id : null;
  }
  if (gestoria_notes !== undefined) data.gestoria_notes = gestoria_notes || null;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ message: 'Nothing to update' }, { status: 400 });
  }

  const updated = await prisma.fiscalDocument.update({ where: { id: params.id }, data });

  await prisma.auditLog.create({
    data: {
      company_id: params.clientCompanyId,
      user_id: session.user.id,
      entity_type: 'fiscal_document',
      entity_id: params.id,
      action: 'review',
      old_values: JSON.stringify({ status: doc.status, gestoria_notes: doc.gestoria_notes }),
      new_values: JSON.stringify(data),
    },
  });

  return NextResponse.json({ document: updated });
}
