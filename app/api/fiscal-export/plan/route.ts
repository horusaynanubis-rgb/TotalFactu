import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { resolveActiveCompanyId } from '@/lib/active-company';
import { planFiscalExport, FiscalExportMode } from '@/lib/fiscal-export-builder';

export const dynamic = 'force-dynamic';

// Company self-service equivalent of the gestoría fiscal-export/plan route —
// same shared builder, no license check (it's the caller's own data).
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const companyId = await resolveActiveCompanyId(session);
  if (!companyId) {
    return NextResponse.json({ error: 'No company found' }, { status: 400 });
  }

  let body: { year?: number; quarter?: number | 'annual'; mode?: FiscalExportMode };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { year, quarter, mode } = body;
  if (!year || !quarter || !mode) {
    return NextResponse.json({ error: 'year, quarter and mode are required' }, { status: 400 });
  }
  if (!['csv', 'fiscal', 'complete'].includes(mode)) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  }
  if (quarter !== 'annual' && ![1, 2, 3, 4].includes(Number(quarter))) {
    return NextResponse.json({ error: 'Invalid quarter' }, { status: 400 });
  }

  const plan = await planFiscalExport(companyId, year, quarter, mode);
  if ('error' in plan) {
    return NextResponse.json(plan, { status: 422 });
  }

  const exportType = mode === 'complete' ? 'paquete_trimestral' : mode === 'fiscal' ? 'fiscal_documents_zip' : 'fiscal_summary';
  prisma.exportLog.create({
    data: {
      company_id: companyId,
      user_id: session.user.id,
      export_type: exportType,
      format: 'zip',
      period_label: plan.periodLabel,
      fiscal_year: year,
      fiscal_quarter: String(quarter),
      record_count: plan.totalDocuments,
    },
  }).catch((err) => console.error('[fiscal-export/plan] ExportLog write failed:', err?.message));

  return NextResponse.json(plan);
}
