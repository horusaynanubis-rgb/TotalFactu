import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { resolveActiveCompanyId } from '@/lib/active-company';

export const dynamic = 'force-dynamic';

// Unified export history for the "Centro de Exportación" — reads only
// ExportLog (purely additive; does not touch the Export model or its 3
// existing consumers).
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const companyId = await resolveActiveCompanyId(session);
  if (!companyId) {
    return NextResponse.json({ message: 'No company found' }, { status: 400 });
  }

  const logs = await prisma.exportLog.findMany({
    where: { company_id: companyId },
    orderBy: { created_at: 'desc' },
    take: 50,
    include: { user: { select: { name: true, email: true } } },
  });

  return NextResponse.json({ logs });
}
