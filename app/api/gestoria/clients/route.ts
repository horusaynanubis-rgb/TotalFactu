import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

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

  const licenses = await prisma.license.findMany({
    where: {
      pack: { gestoria_company_id: membership.company_id },
      status: 'assigned',
      client_company_id: { not: null },
    },
    include: {
      client_company: {
        select: {
          id: true,
          name: true,
          tax_id: true,
          created_at: true,
          subscriptions: { select: { plan_name: true, status: true }, take: 1 },
        },
      },
      invitation: { select: { email: true, accepted_at: true } },
      pack: { select: { id: true, pack_size: true, period_end: true } },
    },
    orderBy: { assigned_at: 'desc' },
  });

  return NextResponse.json({ clients: licenses });
}
