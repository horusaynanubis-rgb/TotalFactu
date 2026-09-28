import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Revoke a pending NEW MODEL invitation. No license/seat to free (unlike
// the legacy DELETE /api/gestoria/invitations/[id]) — this only ever
// touches GestoriaCompanyInvitation.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user_id: session.user.id },
    select: { company_id: true, company: { select: { company_type: true } } },
    orderBy: { created_at: 'asc' },
  });
  if (!membership || membership.company.company_type !== 'gestoria') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const invitation = await prisma.gestoriaCompanyInvitation.findUnique({ where: { id: params.id } });

  // 404 (not 403) when it belongs to a different firm — same
  // don't-leak-existence pattern already used by the legacy revoke route.
  if (!invitation || invitation.gestoria_company_id !== membership.company_id) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
  }

  if (invitation.status !== 'pending') {
    return NextResponse.json({ error: 'Only pending invitations can be revoked' }, { status: 400 });
  }

  await prisma.gestoriaCompanyInvitation.update({
    where: { id: params.id },
    data: { status: 'revoked' },
  });

  return NextResponse.json({ success: true });
}
