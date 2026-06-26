import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

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

const VALID_GESTORIA_STATUSES = new Set([
  'reviewed_ok',
  'reviewed_issue',
  'waiting_client',
  'pending_review',
  'corrected',
  'ignored',
]);

const VALID_SORT_FIELDS: Record<string, string> = {
  issue_date: 'issue_date',
  supplier_name: 'supplier_name',
  total_amount: 'total_amount',
  extraction_confidence: 'extraction_confidence',
  review_status: 'review_status',
};

export async function GET(
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

  const { searchParams } = new URL(request.url);

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);
  const q = searchParams.get('q')?.trim() ?? '';
  const type = searchParams.get('type') ?? 'all';
  const status = searchParams.get('status') ?? 'all';
  const gestoriaStatus = searchParams.get('gestoriaStatus') ?? 'all';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const sortByRaw = searchParams.get('sortBy') ?? 'issue_date';
  const sortDir = searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc';
  const sortBy = VALID_SORT_FIELDS[sortByRaw] ?? 'issue_date';

  // Build where clause
  const where: Prisma.InvoiceWhereInput = {
    company_id: params.clientCompanyId,
  };

  // Type filter
  if (type === 'received' || type === 'issued') {
    where.invoice_type = type;
  }

  // Status filter (individual review_status)
  if (status === 'approved') {
    where.review_status = 'approved';
  } else if (status === 'pending') {
    where.review_status = 'pending';
  } else if (status === 'needs_review') {
    where.review_status = { notIn: ['approved', 'rejected'] };
  }

  // Gestoria review status filter — collected separately to avoid OR conflicts with text search
  let gestoriaOrConditions: Prisma.InvoiceWhereInput[] | null = null;
  if (gestoriaStatus === 'pending') {
    gestoriaOrConditions = [
      { gestoria_review_status: null },
      { gestoria_review_status: 'pending_review' },
    ];
  } else if (VALID_GESTORIA_STATUSES.has(gestoriaStatus)) {
    where.gestoria_review_status = gestoriaStatus;
  }

  // Date range filter
  if (from || to) {
    where.issue_date = {};
    if (from) (where.issue_date as any).gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setUTCHours(23, 59, 59, 999);
      (where.issue_date as any).lte = toDate;
    }
  }

  // Full-text search
  if (q) {
    const searchConditions: Prisma.InvoiceWhereInput[] = [
      { invoice_number: { contains: q, mode: 'insensitive' } },
      { supplier_name: { contains: q, mode: 'insensitive' } },
      { customer_name: { contains: q, mode: 'insensitive' } },
      { supplier_tax_id: { contains: q, mode: 'insensitive' } },
    ];
    const qNum = parseFloat(q);
    if (!isNaN(qNum) && qNum > 0) {
      searchConditions.push({ total_amount: qNum });
    }
    where.OR = searchConditions;
  }

  // Combine gestoriaStatus OR with text search using AND if both are active
  if (gestoriaOrConditions) {
    if (where.OR) {
      where.AND = [{ OR: gestoriaOrConditions }, { OR: where.OR as Prisma.InvoiceWhereInput[] }];
      delete where.OR;
    } else {
      where.OR = gestoriaOrConditions;
    }
  }

  // Build orderBy
  const orderBy: Prisma.InvoiceOrderByWithRelationInput[] = [
    { [sortBy]: sortDir },
    // Secondary sort for determinism
    ...(sortBy !== 'issue_date' ? [{ issue_date: 'desc' as const }] : []),
    { id: 'asc' },
  ];

  const invoices = await prisma.invoice.findMany({
    where,
    orderBy,
    take: limit + 1,
    skip: offset,
    select: {
      id: true,
      document_id: true,
      invoice_number: true,
      invoice_type: true,
      supplier_name: true,
      supplier_tax_id: true,
      customer_name: true,
      issue_date: true,
      subtotal: true,
      tax_amount: true,
      total_amount: true,
      currency: true,
      extraction_confidence: true,
      review_status: true,
      gestoria_review_status: true,
      gestoria_reviewed_at: true,
      gestoria_reviewed_by: true,
      gestoria_review_notes: true,
      gestoria_issue_types: true,
      document: { select: { original_filename: true } },
    },
  });

  const hasMore = invoices.length > limit;
  if (hasMore) invoices.pop();

  return NextResponse.json({ invoices, hasMore });
}
