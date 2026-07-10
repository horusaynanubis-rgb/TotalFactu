import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    let companyId = session.user.companyId ?? null;
    if (!companyId) {
      const membership = await prisma.membership.findFirst({
        where: { user_id: session.user.id },
        orderBy: { created_at: 'asc' },
      });
      if (!membership) {
        return NextResponse.json({ message: 'No company found' }, { status: 400 });
      }
      companyId = membership.company_id;
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    const where: Prisma.FiscalDocumentWhereInput = { company_id: companyId };
    const year = searchParams.get('year');
    const period = searchParams.get('period');
    const type = searchParams.get('type');
    const status = searchParams.get('status');
    if (year) where.fiscal_year = parseInt(year, 10);
    if (period) where.fiscal_period = period;
    if (type) where.document_type = type;
    if (status) where.status = status;

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
  } catch (error: any) {
    console.error('[fiscal-documents] GET error:', error);
    return NextResponse.json({ message: 'Failed to fetch fiscal documents' }, { status: 500 });
  }
}
