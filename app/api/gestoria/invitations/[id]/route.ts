import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user_id: session.user.id },
    select: { company_id: true, company: { select: { company_type: true } } },
  });

  if (!membership || membership.company.company_type !== 'gestoria') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const invitation = await prisma.licenseInvitation.findUnique({
    where: { id: params.id },
  });

  if (!invitation || invitation.gestoria_company_id !== membership.company_id) {
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
  }

  if (invitation.status !== 'pending') {
    return NextResponse.json({ error: 'Only pending invitations can be revoked' }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.licenseInvitation.update({
      where: { id: params.id },
      data: { status: 'revoked' },
    });

    // Free up the license slot
    await tx.license.update({
      where: { id: invitation.license_id },
      data: { status: 'available', assigned_at: null },
    });

    await tx.licensePack.update({
      where: { id: (await tx.license.findUnique({ where: { id: invitation.license_id }, select: { pack_id: true } }))!.pack_id },
      data: { licenses_used: { decrement: 1 } },
    });
  });

  return NextResponse.json({ success: true });
}
