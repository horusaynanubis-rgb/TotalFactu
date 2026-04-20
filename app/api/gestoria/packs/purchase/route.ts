import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const VALID_PACK_SIZES = [10, 20, 50];

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { pack_size } = await req.json();

  if (!VALID_PACK_SIZES.includes(pack_size)) {
    return NextResponse.json({ error: 'Invalid pack size. Valid sizes: 10, 20, 50' }, { status: 400 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user_id: session.user.id },
    include: { company: true },
  });

  if (!membership) {
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  }

  const result = await prisma.$transaction(async (tx) => {
    // Upgrade company to gestoria if not already
    if (membership.company.company_type !== 'gestoria') {
      await tx.company.update({
        where: { id: membership.company_id },
        data: { company_type: 'gestoria' },
      });
    }

    // Create license pack
    const pack = await tx.licensePack.create({
      data: {
        gestoria_company_id: membership.company_id,
        pack_size,
        period_start: new Date(),
        period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
    });

    // Create individual license slots
    await tx.license.createMany({
      data: Array.from({ length: pack_size }, () => ({
        pack_id: pack.id,
        status: 'available',
      })),
    });

    return pack;
  });

  return NextResponse.json({ pack: result }, { status: 201 });
}
