import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { resolveActiveCompanyId } from '@/lib/active-company';
import { getFiscalQuarterInfo, FiscalQuarter } from '@/lib/fiscal-calendar';
import { buildFiscalSummary, generateResumenCSV } from '@/lib/fiscal-summary';
import { buildSpecialExpensesSummary } from '@/lib/special-expenses';

export const dynamic = 'force-dynamic';

// Standalone "Resumen fiscal trimestral" download — no batching needed, this
// CSV is always small. Same data as the resumen_fiscal.csv inside the paquete.
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
  const year = parseInt(searchParams.get('year') ?? '', 10);
  const quarterParam = searchParams.get('quarter') ?? '';
  const quarter: number | 'annual' = quarterParam === 'annual' ? 'annual' : parseInt(quarterParam, 10);

  if (!year || (quarter !== 'annual' && ![1, 2, 3, 4].includes(quarter as number))) {
    return NextResponse.json({ message: 'year and quarter are required' }, { status: 400 });
  }

  const { start, end, label } = quarter === 'annual'
    ? { start: new Date(year, 0, 1), end: new Date(year, 11, 31, 23, 59, 59, 999), label: `Año ${year}` }
    : (() => {
        const info = getFiscalQuarterInfo(year, quarter as FiscalQuarter);
        return { start: info.period_start, end: info.period_end, label: `Q${quarter} ${year}` };
      })();

  const fiscalPeriodTag = quarter === 'annual' ? 'annual' : `Q${quarter}`;
  const [summary, specialExpenses] = await Promise.all([
    buildFiscalSummary(companyId, start, end, label),
    buildSpecialExpensesSummary(companyId, year, fiscalPeriodTag),
  ]);
  const csv = generateResumenCSV(summary, specialExpenses);

  prisma.exportLog.create({
    data: {
      company_id: companyId,
      user_id: session.user.id,
      export_type: 'fiscal_summary',
      format: 'csv',
      period_label: label,
      fiscal_year: year,
      fiscal_quarter: fiscalPeriodTag,
      record_count: summary.monthly.length,
    },
  }).catch((err) => console.error('[fiscal-summary/csv] ExportLog write failed:', err?.message));

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="resumen_fiscal_${fiscalPeriodTag}_${year}.csv"`,
    },
  });
}
