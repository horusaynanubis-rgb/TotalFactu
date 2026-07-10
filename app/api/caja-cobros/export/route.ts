import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { resolveActiveCompanyId } from '@/lib/active-company';
import { getFiscalQuarterInfo, FiscalQuarter } from '@/lib/fiscal-calendar';
import { generateCajaCSV } from '@/lib/caja-csv';

export const dynamic = 'force-dynamic';

function getRange(scope: string, year: number, month: number, quarter: number): { start: Date; end: Date; label: string } | null {
  if (scope === 'daily' || scope === 'monthly') {
    if (!month || month < 1 || month > 12) return null;
    return {
      start: new Date(year, month - 1, 1),
      end: new Date(year, month, 0, 23, 59, 59, 999),
      label: `${String(month).padStart(2, '0')}/${year}`,
    };
  }
  if (scope === 'quarterly') {
    if (!quarter || ![1, 2, 3, 4].includes(quarter)) return null;
    const info = getFiscalQuarterInfo(year, quarter as FiscalQuarter);
    return { start: info.period_start, end: info.period_end, label: `Q${quarter} ${year}` };
  }
  return null;
}

// Caja y Cobros CSV export (daily/monthly/quarterly). Per-method columns
// already cover "cobros por método" — no separate exporter needed. Read-only:
// does not touch Caja y Cobros' own CRUD/import-excel logic.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const companyId = await resolveActiveCompanyId(session);
  if (!companyId) {
    return NextResponse.json({ message: 'No company found' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get('scope') ?? 'monthly';
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()), 10);
  const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1), 10);
  const quarter = parseInt(searchParams.get('quarter') ?? '0', 10);

  const range = getRange(scope, year, month, quarter);
  if (!range) {
    return NextResponse.json({ message: 'Invalid scope/period' }, { status: 400 });
  }

  const registers = await prisma.dailyCashRegister.findMany({
    where: { company_id: companyId, date: { gte: range.start, lte: range.end }, status: 'confirmed' },
    orderBy: { date: 'asc' },
  });

  const csv = generateCajaCSV(registers);

  prisma.exportLog.create({
    data: {
      company_id: companyId,
      user_id: session.user.id,
      export_type: 'caja_csv',
      format: 'csv',
      period_label: range.label,
      fiscal_year: year,
      record_count: registers.length,
    },
  }).catch((err) => console.error('[caja-cobros/export] ExportLog write failed:', err?.message));

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="caja_${scope}_${range.label.replace(/\s|\//g, '_')}.csv"`,
    },
  });
}
