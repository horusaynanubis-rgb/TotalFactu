import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { getMonthRange } from '@/lib/caja-period';

export const dynamic = 'force-dynamic';

async function resolveGestoriaAccess(userId: string, clientCompanyId: string) {
  const membership = await prisma.membership.findFirst({
    where: { user_id: userId },
    select: { company_id: true, company: { select: { company_type: true } } },
  });
  if (!membership || membership.company.company_type !== 'gestoria') return null;

  const license = await prisma.license.findFirst({
    where: {
      client_company_id: clientCompanyId,
      status: 'assigned',
      pack: { gestoria_company_id: membership.company_id },
    },
  });
  if (!license) return null;

  return { gestoriaCompanyId: membership.company_id };
}

// GET — read-only Caja y Cobros view for a gestoria acting on a client company.
// Mirrors app/api/caja-cobros/route.ts's GET exactly (same month filter, same
// DailyCashRegister query, same monthly summary shape) but scoped to
// clientCompanyId instead of the caller's own company, and confirmed-only —
// no pending_review list (that queue belongs to the client's own workflow,
// not a gestoria read view) and no write handlers (POST/PUT/DELETE) at all.
export async function GET(
  request: NextRequest,
  { params }: { params: { clientCompanyId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const companyId = params.clientCompanyId;

  const { searchParams } = new URL(request.url);
  const year  = parseInt(searchParams.get('year')  ?? String(new Date().getFullYear()));
  const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1));

  const { from, to } = getMonthRange(year, month);

  const [registers, summary] = await Promise.all([
    prisma.dailyCashRegister.findMany({
      where: { company_id: companyId, date: { gte: from, lt: to }, status: 'confirmed' },
      orderBy: { date: 'desc' },
      include: { document: { select: { id: true, cloud_storage_path: true } } },
    }),
    prisma.dailyCashRegister.aggregate({
      where: { company_id: companyId, date: { gte: from, lt: to }, status: 'confirmed' },
      _sum: {
        cash_amount:     true,
        card_amount:     true,
        bizum_amount:    true,
        transfer_amount: true,
        other_amount:    true,
        total_amount:    true,
      },
    }),
  ]);

  return NextResponse.json({
    registers,
    summary: {
      cash_amount:     Number(summary._sum.cash_amount     ?? 0),
      card_amount:     Number(summary._sum.card_amount     ?? 0),
      bizum_amount:    Number(summary._sum.bizum_amount    ?? 0),
      transfer_amount: Number(summary._sum.transfer_amount ?? 0),
      other_amount:    Number(summary._sum.other_amount    ?? 0),
      total_amount:    Number(summary._sum.total_amount    ?? 0),
    },
  });
}
