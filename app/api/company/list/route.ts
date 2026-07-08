import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// GET — companies the caller belongs to, for the "Gestión de empresas" screen.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const memberships = await prisma.membership.findMany({
    where: { user_id: session.user.id },
    orderBy: { created_at: 'asc' },
    include: {
      company: {
        include: {
          subscriptions: {
            orderBy: { created_at: 'desc' },
            take: 1,
            select: { plan_name: true, status: true },
          },
        },
      },
    },
  });

  const companies = memberships.map((m) => ({
    id: m.company.id,
    name: m.company.name,
    tax_id: m.company.tax_id,
    company_type: m.company.company_type,
    is_beta: m.company.is_beta,
    plan_name: m.company.subscriptions[0]?.plan_name ?? null,
    status: m.company.subscriptions[0]?.status ?? null,
    role: m.role,
    updated_at: m.company.updated_at,
    is_active: m.company.id === session.user.companyId,
  }));

  return NextResponse.json({ companies });
}
