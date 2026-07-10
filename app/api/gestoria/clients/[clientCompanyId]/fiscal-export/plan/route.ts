import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { createFiscalExportBatchToken } from '@/lib/batch-token';
import { getFiscalQuarterInfo, FiscalQuarter } from '@/lib/fiscal-calendar';

export const dynamic = 'force-dynamic';

// Same tuneable limits as the A3 export-plan route
const MAX_DOCS_PER_BATCH = 25;
const MAX_ESTIMATED_SIZE_MB = 80;
const MAX_DOCS_TOTAL = 5000;
const AVG_DOC_SIZE_BYTES = 200 * 1024;

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

function getPeriodRange(year: number, quarter: number | 'annual'): { start: Date; end: Date; label: string } {
  if (quarter === 'annual') {
    return {
      start: new Date(year, 0, 1),
      end: new Date(year, 11, 31, 23, 59, 59, 999),
      label: `Año ${year}`,
    };
  }
  const info = getFiscalQuarterInfo(year, quarter as FiscalQuarter);
  return { start: info.period_start, end: info.period_end, label: `Q${quarter} ${year}` };
}

// Docs tagged for a specific quarter of `year`, plus any doc tagged "annual"
// for that same year (applies to the whole year regardless of quarter picked).
function fiscalDocPeriodFilter(quarter: number | 'annual') {
  if (quarter === 'annual') return undefined; // no period filter — whole year
  return { in: [`Q${quarter}`, 'annual'] };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { clientCompanyId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { year?: number; quarter?: number | 'annual'; mode?: 'csv' | 'fiscal' | 'complete' };
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

  const { label: periodLabel } = getPeriodRange(year, quarter);

  const includesDocs = mode === 'fiscal' || mode === 'complete';
  const docsWhere = {
    company_id: params.clientCompanyId,
    fiscal_year: year,
    ...(fiscalDocPeriodFilter(quarter) ? { fiscal_period: fiscalDocPeriodFilter(quarter) } : {}),
  };

  const totalDocuments = includesDocs ? await prisma.fiscalDocument.count({ where: docsWhere }) : 0;

  if (totalDocuments > MAX_DOCS_TOTAL) {
    return NextResponse.json({ error: 'TOO_MANY_DOCUMENTS', totalDocuments }, { status: 422 });
  }

  const docsPerBatch = Math.min(
    MAX_DOCS_PER_BATCH,
    Math.floor((MAX_ESTIMATED_SIZE_MB * 1024 * 1024) / AVG_DOC_SIZE_BYTES),
  );

  // At least one batch always exists — batch 0 carries the CSVs even if there
  // are zero fiscal documents to attach.
  const batchCount = totalDocuments > 0 ? Math.ceil(totalDocuments / docsPerBatch) : 1;

  const batches = Array.from({ length: batchCount }, (_, i) => {
    const offset = i * docsPerBatch;
    const count = totalDocuments > 0 ? Math.min(docsPerBatch, totalDocuments - offset) : 0;
    const token = createFiscalExportBatchToken(params.clientCompanyId, mode, year, quarter, i, offset, count);
    return {
      batchIndex: i,
      fromItem: count > 0 ? offset + 1 : 0,
      toItem: offset + count,
      documentCount: count,
      estimatedSizeMB: Math.round((count * AVG_DOC_SIZE_BYTES) / (1024 * 1024)),
      token,
    };
  });

  return NextResponse.json({
    mode,
    year,
    quarter,
    periodLabel,
    totalDocuments,
    batchCount,
    batches,
  });
}
