import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET() {
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

  const invitations = await prisma.licenseInvitation.findMany({
    where: { gestoria_company_id: membership.company_id },
    include: {
      license: {
        include: {
          client_company: { select: { id: true, name: true } },
          pack: { select: { id: true, pack_size: true } },
        },
      },
    },
    orderBy: { created_at: 'desc' },
  });

  return NextResponse.json({ invitations });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { email } = await req.json();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user_id: session.user.id },
    select: { company_id: true, company: { select: { company_type: true } } },
  });

  if (!membership || membership.company.company_type !== 'gestoria') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Find an available license slot
  const availableLicense = await prisma.license.findFirst({
    where: {
      pack: { gestoria_company_id: membership.company_id, status: 'active' },
      status: 'available',
    },
    include: { pack: true },
  });

  if (!availableLicense) {
    return NextResponse.json({ error: 'No available licenses. Purchase a new pack.' }, { status: 400 });
  }

  // Check no pending invitation already exists for this email under this gestoria
  const existing = await prisma.licenseInvitation.findFirst({
    where: {
      gestoria_company_id: membership.company_id,
      email,
      status: 'pending',
    },
  });

  if (existing) {
    return NextResponse.json({ error: 'A pending invitation already exists for this email.' }, { status: 409 });
  }

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

  const result = await prisma.$transaction(async (tx) => {
    // Reserve the license
    await tx.license.update({
      where: { id: availableLicense.id },
      data: { status: 'assigned' },
    });

    // Update pack usage counter
    await tx.licensePack.update({
      where: { id: availableLicense.pack_id },
      data: { licenses_used: { increment: 1 } },
    });

    const invitation = await tx.licenseInvitation.create({
      data: {
        gestoria_company_id: membership.company_id,
        license_id: availableLicense.id,
        email,
        token,
        expires_at: expiresAt,
      },
    });

    return invitation;
  });

  const activationUrl = `${process.env.NEXTAUTH_URL || ''}/activate/${token}`;

  return NextResponse.json({ invitation: result, activation_url: activationUrl }, { status: 201 });
}
