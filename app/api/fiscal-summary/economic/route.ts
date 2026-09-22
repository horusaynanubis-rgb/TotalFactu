import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { resolveActiveCompanyId } from '@/lib/active-company';
import { getFiscalQuarterInfo, FiscalQuarter } from '@/lib/fiscal-calendar';
import { buildEconomicSummary } from '@/lib/economic-summary';

export const dynamic = 'force-dynamic';

// Read-only "Resumen económico" (Ingresos/Gastos/Resultado estimado) for a
// month, quarter or full year. See lib/economic-summary.ts for the income
// source selection rule (TPV vs facturas emitidas) and why Resultado/Margen
// are null when the period has TPV data.
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
  const monthParam = searchParams.get('month');
  const quarterParam = searchParams.get('quarter');
  const annual = searchParams.get('annual') === 'true' || quarterParam === 'annual';

  if (!year) {
    return NextResponse.json({ message: 'year is required' }, { status: 400 });
  }

  let from: Date;
  let to: Date;
  let periodLabel: string;

  if (monthParam) {
    const month = parseInt(monthParam, 10);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ message: 'month must be 1-12' }, { status: 400 });
    }
    from = new Date(year, month - 1, 1);
    to = new Date(year, month, 0, 23, 59, 59, 999);
    periodLabel = `${String(month).padStart(2, '0')}/${year}`;
  } else if (annual) {
    from = new Date(year, 0, 1);
    to = new Date(year, 11, 31, 23, 59, 59, 999);
    periodLabel = `${year}`;
  } else if (quarterParam) {
    const quarter = parseInt(quarterParam, 10);
    if (![1, 2, 3, 4].includes(quarter)) {
      return NextResponse.json({ message: 'quarter must be 1-4 or "annual"' }, { status: 400 });
    }
    const info = getFiscalQuarterInfo(year, quarter as FiscalQuarter);
    from = info.period_start;
    to = info.period_end;
    periodLabel = `Q${quarter} ${year}`;
  } else {
    return NextResponse.json({ message: 'one of month, quarter or annual is required' }, { status: 400 });
  }

  const summary = await buildEconomicSummary(companyId, from, to, periodLabel);
  return NextResponse.json(summary);
}
