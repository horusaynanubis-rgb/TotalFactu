import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { resolveActiveCompanyId } from '@/lib/active-company';
import { getFiscalQuarterInfo, FiscalQuarter } from '@/lib/fiscal-calendar';

export const dynamic = 'force-dynamic';

// Read-only counts of Invoice.fiscal_status for a period — backs the
// "Clasificación fiscal" widget on the exports page. The actual
// reclassification action (Gemini VAT-only micro pass) only exists on the
// gestoria side — see app/api/gestoria/clients/[clientCompanyId]/vat-reclassify.
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

  const grouped = await prisma.invoice.groupBy({
    by: ['fiscal_status'],
    where: { company_id: companyId, issue_date: { gte: start, lte: end } },
    _count: true,
  });

  const counts = { classified: 0, pendingClassification: 0, mixedVat: 0, manualReview: 0 };
  for (const g of grouped) {
    if (g.fiscal_status === 'classified') counts.classified = g._count;
    else if (g.fiscal_status === 'pending_classification') counts.pendingClassification = g._count;
    else if (g.fiscal_status === 'mixed_vat') counts.mixedVat = g._count;
    else if (g.fiscal_status === 'manual_review') counts.manualReview = g._count;
  }
  const total = counts.classified + counts.pendingClassification + counts.mixedVat + counts.manualReview;

  return NextResponse.json({ ...counts, total });
}
