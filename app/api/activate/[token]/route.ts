import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const invitation = await prisma.licenseInvitation.findUnique({
    where: { token: params.token },
    include: {
      license: {
        include: {
          pack: {
            include: { gestoria_company: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });

  if (!invitation) {
    return NextResponse.json({ error: 'Invalid activation link' }, { status: 404 });
  }

  if (invitation.status === 'accepted') {
    return NextResponse.json({ error: 'This invitation has already been used' }, { status: 410 });
  }

  if (invitation.status === 'revoked') {
    return NextResponse.json({ error: 'This invitation has been revoked' }, { status: 410 });
  }

  if (invitation.status === 'expired' || invitation.expires_at < new Date()) {
    if (invitation.status === 'pending') {
      await prisma.licenseInvitation.update({
        where: { id: invitation.id },
        data: { status: 'expired' },
      });
    }
    return NextResponse.json({ error: 'This invitation has expired' }, { status: 410 });
  }

  return NextResponse.json({
    valid: true,
    email: invitation.email,
    gestoria_name: invitation.license.pack.gestoria_company.name,
    expires_at: invitation.expires_at,
  });
}
