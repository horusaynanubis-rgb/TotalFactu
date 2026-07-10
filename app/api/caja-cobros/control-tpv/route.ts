import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { resolveActiveCompanyId } from '@/lib/active-company';
import { getFiscalQuarterInfo, FiscalQuarter } from '@/lib/fiscal-calendar';
import { buildTpvControlReport, generateTpvControlCSV } from '@/lib/tpv-control';

export const dynamic = 'force-dynamic';

// "Control TPV vs facturación" — purely informational, never auto-corrects
// or creates invoices (see lib/tpv-control.ts).
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
  const quarter = parseInt(searchParams.get('quarter') ?? '', 10);

  if (!year || ![1, 2, 3, 4].includes(quarter)) {
    return NextResponse.json({ message: 'year and quarter are required' }, { status: 400 });
  }

  const info = getFiscalQuarterInfo(year, quarter as FiscalQuarter);
  const label = `Q${quarter} ${year}`;
  const report = await buildTpvControlReport(companyId, info.period_start, info.period_end, label);
  const csv = generateTpvControlCSV(report);

  prisma.exportLog.create({
    data: {
      company_id: companyId,
      user_id: session.user.id,
      export_type: 'control_tpv',
      format: 'csv',
      period_label: label,
      fiscal_year: year,
      fiscal_quarter: `Q${quarter}`,
      record_count: report.rows.length,
    },
  }).catch((err) => console.error('[caja-cobros/control-tpv] ExportLog write failed:', err?.message));

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="control_tpv_vs_facturacion_Q${quarter}_${year}.csv"`,
    },
  });
}
