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

export async function GET(
  request: NextRequest,
  { params }: { params: { clientCompanyId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);

  const where: Prisma.FiscalDocumentWhereInput = { company_id: params.clientCompanyId };
  const year = searchParams.get('year');
  const period = searchParams.get('period');
  const type = searchParams.get('type');
  const status = searchParams.get('status');
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (year) where.fiscal_year = parseInt(year, 10);
  if (period) where.fiscal_period = period;
  if (type) where.document_type = type;
  if (status) where.status = status;
  if (from || to) {
    where.created_at = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const [items, total] = await Promise.all([
    prisma.fiscalDocument.findMany({
      where,
      orderBy: { created_at: 'desc' },
      take: limit + 1,
      skip: offset,
    }),
    prisma.fiscalDocument.count({ where }),
  ]);

  const hasMore = items.length > limit;
  if (hasMore) items.pop();

  return NextResponse.json({ items, total, hasMore });
}
