import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const INACTIVE_THRESHOLDS = {
  days30: 30,
  days60: 60,
  days90: 90,
} as const;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user_id: session.user.id },
    select: { company_id: true, company: { select: { company_type: true } } },
  });

  if (!membership || membership.company.company_type !== 'gestoria') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const gestoriaCompanyId = membership.company_id;

  // Get all assigned client IDs for this gestoria
  const licenses = await prisma.license.findMany({
    where: {
      pack: { gestoria_company_id: gestoriaCompanyId },
      status: 'assigned',
      client_company_id: { not: null },
    },
    select: {
      client_company_id: true,
      client_company: { select: { id: true, name: true, tax_id: true } },
    },
  });

  const clientIds = licenses.map((l) => l.client_company_id).filter(Boolean) as string[];

  if (clientIds.length === 0) {
    return NextResponse.json({
      summary: {
        totalPendingReviews: 0,
        totalWaitingClient: 0,
        totalNewDocs: 0,
        totalUnreadMessages: 0,
        totalInvoicesThisMonth: 0,
      },
      clients: [],
    });
  }

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  // All queries in parallel — no N+1
  const [
    pendingGestoriaReviews,
    waitingClientReviews,
    reviewedIssueReviews,
    invoicesThisMonth,
    recentDocs,
    lastDocPerClient,
    unreadMessages,
  ] = await Promise.all([
    // Invoices gestoria has NOT reviewed yet (null = never touched)
    prisma.invoice.groupBy({
      by: ['company_id'],
      where: {
        company_id: { in: clientIds },
        gestoria_review_status: null,
      },
      _count: { id: true },
    }),

    // Invoices waiting for client action
    prisma.invoice.groupBy({
      by: ['company_id'],
      where: {
        company_id: { in: clientIds },
        gestoria_review_status: 'waiting_client',
      },
      _count: { id: true },
    }),

    // Invoices marked with issues (reviewed_issue)
    prisma.invoice.groupBy({
      by: ['company_id'],
      where: {
        company_id: { in: clientIds },
        gestoria_review_status: 'reviewed_issue',
      },
      _count: { id: true },
    }),

    // Invoices uploaded this month (across all clients)
    prisma.invoice.groupBy({
      by: ['company_id'],
      where: {
        company_id: { in: clientIds },
        issue_date: { gte: monthStart, lte: monthEnd },
      },
      _count: { id: true },
    }),

    // Documents uploaded in last 7 days (new activity indicator)
    prisma.document.groupBy({
      by: ['company_id'],
      where: {
        company_id: { in: clientIds },
        upload_timestamp: { gte: sevenDaysAgo },
        processing_status: { not: 'failed' },
      },
      _count: { id: true },
    }),

    // Last document upload per client (for activity tracking)
    prisma.document.findMany({
      where: { company_id: { in: clientIds } },
      orderBy: { upload_timestamp: 'desc' },
      distinct: ['company_id'],
      select: { company_id: true, upload_timestamp: true },
    }),

    // Messages sent by gestoria to client that have NOT been read (read_at is null)
    prisma.gestoriaMessage.groupBy({
      by: ['client_company_id'],
      where: {
        gestoria_company_id: gestoriaCompanyId,
        client_company_id: { in: clientIds },
        read_at: null,
      },
      _count: { id: true },
    }),
  ]);

  // Build lookup maps
  const pendingMap = new Map(pendingGestoriaReviews.map((r) => [r.company_id, r._count.id]));
  const waitingMap = new Map(waitingClientReviews.map((r) => [r.company_id, r._count.id]));
  const issueMap = new Map(reviewedIssueReviews.map((r) => [r.company_id, r._count.id]));
  const invoicesMonthMap = new Map(invoicesThisMonth.map((r) => [r.company_id, r._count.id]));
  const newDocsMap = new Map(recentDocs.map((r) => [r.company_id, r._count.id]));
  const lastDocMap = new Map(lastDocPerClient.map((d) => [d.company_id, d.upload_timestamp]));
  const unreadMap = new Map(unreadMessages.map((m) => [m.client_company_id, m._count.id]));

  // Build per-client data
  const clients = licenses.map((license) => {
    const cid = license.client_company_id!;
    const lastActivity = lastDocMap.get(cid) ?? null;
    const pendingReviews = pendingMap.get(cid) ?? 0;
    const waitingClient = waitingMap.get(cid) ?? 0;
    const reviewedIssues = issueMap.get(cid) ?? 0;
    const newDocs = newDocsMap.get(cid) ?? 0;
    const unreadMsgs = unreadMap.get(cid) ?? 0;

    // Calculate inactive days
    let inactiveDays: number | null = null;
    if (lastActivity) {
      inactiveDays = Math.floor((now.getTime() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24));
    }

    // Primary status (priority order: issue > waiting > pending > new_docs > inactive > ok)
    let primaryStatus: string;
    if (reviewedIssues > 0) {
      primaryStatus = 'reviewed_issue';
    } else if (waitingClient > 0) {
      primaryStatus = 'waiting_client';
    } else if (pendingReviews > 0) {
      primaryStatus = 'pending_review';
    } else if (newDocs > 0) {
      primaryStatus = 'new_docs';
    } else if (inactiveDays === null || inactiveDays >= INACTIVE_THRESHOLDS.days90) {
      primaryStatus = 'inactive_90';
    } else if (inactiveDays >= INACTIVE_THRESHOLDS.days60) {
      primaryStatus = 'inactive_60';
    } else if (inactiveDays >= INACTIVE_THRESHOLDS.days30) {
      primaryStatus = 'inactive_30';
    } else {
      primaryStatus = 'all_ok';
    }

    return {
      companyId: cid,
      companyName: license.client_company?.name ?? '',
      taxId: license.client_company?.tax_id ?? '',
      primaryStatus,
      pendingReviews,
      waitingClient,
      reviewedIssues,
      newDocs,
      unreadMessages: unreadMsgs,
      invoicesThisMonth: invoicesMonthMap.get(cid) ?? 0,
      lastActivity: lastActivity?.toISOString() ?? null,
      inactiveDays,
    };
  });

  // Sort: most urgent first (reviewed_issue → waiting_client → pending_review → new_docs → all_ok → inactive)
  const STATUS_ORDER: Record<string, number> = {
    reviewed_issue: 0,
    waiting_client: 1,
    pending_review: 2,
    new_docs: 3,
    all_ok: 4,
    inactive_30: 5,
    inactive_60: 6,
    inactive_90: 7,
  };
  clients.sort((a, b) => (STATUS_ORDER[a.primaryStatus] ?? 9) - (STATUS_ORDER[b.primaryStatus] ?? 9));

  // Global summary totals
  const totalPendingReviews = [...pendingMap.values()].reduce((s, n) => s + n, 0);
  const totalWaitingClient = [...waitingMap.values()].reduce((s, n) => s + n, 0);
  const totalNewDocs = [...newDocsMap.values()].reduce((s, n) => s + n, 0);
  const totalUnreadMessages = [...unreadMap.values()].reduce((s, n) => s + n, 0);
  const totalInvoicesThisMonth = [...invoicesMonthMap.values()].reduce((s, n) => s + n, 0);

  return NextResponse.json({
    summary: {
      totalPendingReviews,
      totalWaitingClient,
      totalNewDocs,
      totalUnreadMessages,
      totalInvoicesThisMonth,
    },
    clients,
  });
}
