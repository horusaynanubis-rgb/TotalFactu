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
    include: { company: true },
  });

  if (!membership || membership.company.company_type !== 'gestoria') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const packs = await prisma.licensePack.findMany({
    where: { gestoria_company_id: membership.company_id },
    include: {
      licenses: {
        include: {
          client_company: { select: { id: true, name: true, tax_id: true } },
          invitation: { select: { email: true, status: true } },
        },
      },
    },
    orderBy: { created_at: 'desc' },
  });

  return NextResponse.json({ packs });
}
