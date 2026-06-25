import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { createBatchToken } from '@/lib/batch-token';
import { buildDocumentWhere } from '@/lib/gestoria-document-where';

export const dynamic = 'force-dynamic';

// Tuneable limits
const MAX_DOCS_PER_BATCH = 300;
const MAX_ESTIMATED_SIZE_MB = 80;
const MAX_DOCS_TOTAL = 5000;
const AVG_DOC_SIZE_BYTES = 200 * 1024; // 200 KB per document (conservative estimate)

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

  let body: { from?: string; to?: string; type?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { from, to, type = 'all', status = 'processed' } = body;

  if (!from || !to) {
    return NextResponse.json({ error: 'from and to are required' }, { status: 400 });
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  toDate.setUTCHours(23, 59, 59, 999);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
  }
  if (fromDate > toDate) {
    return NextResponse.json({ error: 'from must be before to' }, { status: 400 });
  }

  const validTypes = ['all', 'received', 'issued'];
  const validStatuses = ['processed', 'approved_only'];
  if (!validTypes.includes(type) || !validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid type or status' }, { status: 400 });
  }

  const where = buildDocumentWhere(params.clientCompanyId, fromDate, toDate, type, status);

  // Count total matching documents
  const total = await prisma.document.count({ where });

  if (total === 0) {
    return NextResponse.json({ totalDocuments: 0, batches: [] });
  }

  if (total > MAX_DOCS_TOTAL) {
    return NextResponse.json(
      { error: 'TOO_MANY_DOCUMENTS', totalDocuments: total },
      { status: 422 },
    );
  }

  // Respect both doc-count and size-per-batch limits
  const docsPerBatch = Math.min(
    MAX_DOCS_PER_BATCH,
    Math.floor((MAX_ESTIMATED_SIZE_MB * 1024 * 1024) / AVG_DOC_SIZE_BYTES),
  );

  const batchCount = Math.ceil(total / docsPerBatch);
  const fromStr = from.slice(0, 10);
  const toStr = to.slice(0, 10);

  const batches = Array.from({ length: batchCount }, (_, i) => {
    const offset = i * docsPerBatch;
    const count = Math.min(docsPerBatch, total - offset);
    const token = createBatchToken(
      params.clientCompanyId, fromStr, toStr, type, status, i, offset, count,
    );
    return {
      batchIndex: i,
      fromItem: offset + 1,
      toItem: offset + count,
      documentCount: count,
      estimatedSizeMB: Math.round((count * AVG_DOC_SIZE_BYTES) / (1024 * 1024)),
      token,
    };
  });

  return NextResponse.json({
    totalDocuments: total,
    totalEstimatedSizeMB: Math.round((total * AVG_DOC_SIZE_BYTES) / (1024 * 1024)),
    batchCount,
    batches,
  });
}

