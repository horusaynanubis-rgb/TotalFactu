import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: { clientCompanyId: string } },
) {
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

  const license = await prisma.license.findFirst({
    where: {
      client_company_id: params.clientCompanyId,
      status: 'assigned',
      pack: { gestoria_company_id: membership.company_id },
    },
  });

  if (!license) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const exports = await prisma.export.findMany({
    where: { company_id: params.clientCompanyId },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      export_type: true,
      period_start: true,
      period_end: true,
      record_count: true,
      email_sent: true,
      email_sent_at: true,
      created_at: true,
      company: { select: { export_email: true } },
    },
  });

  return NextResponse.json({ exports });
}
