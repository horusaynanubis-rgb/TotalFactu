import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { resolveActiveCompanyId } from '@/lib/active-company';
import { getFiscalQuarterInfo, FiscalQuarter } from '@/lib/fiscal-calendar';
import { buildIvaDetalle, generateIvaDetalleCSV } from '@/lib/iva-detalle';

export const dynamic = 'force-dynamic';

// Standalone "Detalle IVA" download — one row per invoice for the period,
// with the IVA rate bucket it was classified into (4%/10%/21%/sin
// clasificar), so gestoría can filter/group without opening each invoice.
// Same classification logic (lib/iva-classification.ts) as resumen_fiscal.csv
// and the copy bundled inside the paquete trimestral — never duplicated.
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
  const rows = await buildIvaDetalle(companyId, start, end);
  const csv = generateIvaDetalleCSV(rows);

  prisma.exportLog.create({
    data: {
      company_id: companyId,
      user_id: session.user.id,
      export_type: 'detalle_iva',
      format: 'csv',
      period_label: label,
      fiscal_year: year,
      fiscal_quarter: fiscalPeriodTag,
      record_count: rows.length,
    },
  }).catch((err) => console.error('[fiscal-summary/detalle-iva] ExportLog write failed:', err?.message));

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="detalle_iva_${fiscalPeriodTag}_${year}.csv"`,
    },
  });
}
