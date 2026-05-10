import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

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

  const licenses = await prisma.license.findMany({
    where: {
      pack: { gestoria_company_id: gestoriaCompanyId },
      status: 'assigned',
      client_company_id: { not: null },
    },
    include: {
      client_company: {
        select: { id: true, name: true, tax_id: true, created_at: true, export_email: true },
      },
      invitation: { select: { email: true, accepted_at: true } },
    },
    orderBy: { assigned_at: 'desc' },
  });

  const clientIds = licenses
    .map((l) => l.client_company_id)
    .filter(Boolean) as string[];

  if (clientIds.length === 0) {
    return NextResponse.json({ clients: [] });
  }

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const [telegramLinks, invoicesThisMonth, pendingInvoices, lastDocuments, lastExports] =
    await Promise.all([
      prisma.telegramLink.findMany({
        where: { company_id: { in: clientIds } },
        select: { company_id: true },
      }),
      prisma.invoice.groupBy({
        by: ['company_id'],
        where: { company_id: { in: clientIds }, issue_date: { gte: monthStart, lte: monthEnd } },
        _count: { id: true },
      }),
      prisma.invoice.groupBy({
        by: ['company_id'],
        where: { company_id: { in: clientIds }, review_status: 'pending' },
        _count: { id: true },
      }),
      prisma.document.findMany({
        where: { company_id: { in: clientIds } },
        orderBy: { upload_timestamp: 'desc' },
        distinct: ['company_id'],
        select: { company_id: true, upload_timestamp: true, processing_status: true },
      }),
      prisma.export.findMany({
        where: { company_id: { in: clientIds } },
        orderBy: { created_at: 'desc' },
        distinct: ['company_id'],
        select: {
          company_id: true,
          id: true,
          created_at: true,
          export_type: true,
          period_start: true,
          period_end: true,
        },
      }),
    ]);

  const telegramSet = new Set(telegramLinks.map((t) => t.company_id));
  const invoicesMap = new Map(invoicesThisMonth.map((i) => [i.company_id, i._count.id]));
  const pendingMap = new Map(pendingInvoices.map((i) => [i.company_id, i._count.id]));
  const lastDocMap = new Map(lastDocuments.map((d) => [d.company_id, d]));
  const lastExportMap = new Map(lastExports.map((e) => [e.company_id, e]));

  const clients = licenses.map((license) => {
    const cid = license.client_company_id!;
    return {
      licenseId: license.id,
      licenseStatus: license.status,
      assignedAt: license.assigned_at,
      company: license.client_company,
      email: license.invitation?.email,
      acceptedAt: license.invitation?.accepted_at,
      telegramLinked: telegramSet.has(cid),
      invoicesThisMonth: invoicesMap.get(cid) ?? 0,
      pendingReviews: pendingMap.get(cid) ?? 0,
      lastActivity: lastDocMap.get(cid)?.upload_timestamp ?? null,
      lastExport: lastExportMap.get(cid) ?? null,
    };
  });

  return NextResponse.json({ clients });
}
