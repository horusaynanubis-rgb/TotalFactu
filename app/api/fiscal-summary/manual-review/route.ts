import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { resolveActiveCompanyId } from '@/lib/active-company';
import { getFiscalQuarterInfo, FiscalQuarter } from '@/lib/fiscal-calendar';
import { buildManualReviewList, generateManualReviewCSV } from '@/lib/fiscal-manual-review';

export const dynamic = 'force-dynamic';

// Standalone "Facturas pendientes de revisión manual" download — same data
// as manual_review.csv inside the paquete trimestral (mode 'complete').
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

  const { start, end } = quarter === 'annual'
    ? { start: new Date(year, 0, 1), end: new Date(year, 11, 31, 23, 59, 59, 999) }
    : (() => {
        const info = getFiscalQuarterInfo(year, quarter as FiscalQuarter);
        return { start: info.period_start, end: info.period_end };
      })();

  const fiscalPeriodTag = quarter === 'annual' ? 'annual' : `Q${quarter}`;
  const rows = await buildManualReviewList(companyId, start, end);
  const csv = generateManualReviewCSV(rows);

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="manual_review_${fiscalPeriodTag}_${year}.csv"`,
    },
  });
}
