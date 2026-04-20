import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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

  const license = await prisma.license.findUnique({
    where: { id: params.id },
    include: { pack: true },
  });

  if (!license || license.pack.gestoria_company_id !== membership.company_id) {
    return NextResponse.json({ error: 'License not found' }, { status: 404 });
  }

  if (license.status !== 'assigned') {
    return NextResponse.json({ error: 'License is not assigned' }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.license.update({
      where: { id: params.id },
      data: {
        status: 'revoked',
        client_company_id: null,
        revoked_at: new Date(),
      },
    });

    await tx.licensePack.update({
      where: { id: license.pack_id },
      data: { licenses_used: { decrement: 1 } },
    });

    // Mark invitation as revoked if exists
    await tx.licenseInvitation.updateMany({
      where: { license_id: params.id, status: 'accepted' },
      data: { status: 'revoked' },
    });
  });

  return NextResponse.json({ success: true });
}
