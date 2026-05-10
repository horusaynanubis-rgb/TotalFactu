import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

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

export async function GET(
  _request: NextRequest,
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

  const cid = params.clientCompanyId;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  const [
    company,
    telegramLinks,
    invoicesThisMonth,
    pendingCount,
    totalExports,
    licenseWithInvitation,
    recentDocuments,
    recentExports,
  ] = await Promise.all([
    prisma.company.findUnique({
      where: { id: cid },
      select: { id: true, name: true, tax_id: true, created_at: true, export_email: true },
    }),
    prisma.telegramLink.findMany({
      where: { company_id: cid },
      select: { telegram_id: true, username: true, first_name: true, created_at: true },
    }),
    prisma.invoice.count({
      where: { company_id: cid, issue_date: { gte: monthStart, lte: monthEnd } },
    }),
    prisma.invoice.count({
      where: { company_id: cid, review_status: 'pending' },
    }),
    prisma.export.count({ where: { company_id: cid } }),
    prisma.license.findFirst({
      where: {
        client_company_id: cid,
        pack: { gestoria_company_id: access.gestoriaCompanyId },
      },
      include: {
        invitation: {
          select: { email: true, status: true, accepted_at: true, created_at: true },
        },
      },
    }),
    prisma.document.findMany({
      where: { company_id: cid },
      orderBy: { upload_timestamp: 'desc' },
      take: 10,
      select: {
        id: true,
        original_filename: true,
        processing_status: true,
        upload_timestamp: true,
        source_channel: true,
      },
    }),
    prisma.export.findMany({
      where: { company_id: cid },
      orderBy: { created_at: 'desc' },
      take: 20,
      select: {
        id: true,
        export_type: true,
        period_start: true,
        period_end: true,
        record_count: true,
        email_sent: true,
        email_sent_at: true,
        created_at: true,
        company: { select: { export_email: true } },
      },
    }),
  ]);

  if (!company) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  return NextResponse.json({
    company,
    license: licenseWithInvitation,
    telegramLinked: telegramLinks.length > 0,
    telegramDetails: telegramLinks,
    invoicesThisMonth,
    pendingReviews: pendingCount,
    totalExports,
    recentDocuments,
    recentExports,
  });
}
