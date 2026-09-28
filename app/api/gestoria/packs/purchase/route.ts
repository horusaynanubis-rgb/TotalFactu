import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { requireAdmin } from '@/lib/admin/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const VALID_PACK_SIZES = [10, 20, 50];

// Creates real LicensePack/License entitlements with no Stripe payment involved.
// The paid, customer-facing purchase flow is POST /api/stripe/checkout
// (type: 'gestoria_pack'), which only activates a pack from the
// checkout.session.completed webhook after a real charge. This route is for
// platform-admin manual provisioning only (support/ops granting a
// complimentary pack to an existing gestoria) — same trust boundary as
// /api/admin/demo-gestoria/create. It must never accept anonymous or
// non-admin callers, and must never change a company's company_type.
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

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
    orderBy: { created_at: 'asc' },
  });

  if (!membership) {
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  }

  if (membership.company.company_type !== 'gestoria') {
    return NextResponse.json(
      { error: 'Company is not a gestoria account. This endpoint no longer creates or upgrades accounts.' },
      { status: 400 }
    );
  }

  const result = await prisma.$transaction(async (tx) => {
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
