import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { buildDocumentWhere } from '@/lib/document-filters';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const companyId = session.user.companyId;
    if (!companyId) {
      const membership = await prisma.membership.findFirst({
        where: { user_id: session.user.id },
        orderBy: { created_at: 'asc' },
      });
      if (!membership) {
        return NextResponse.json({ message: 'No company found' }, { status: 400 });
      }
      return fetchDocuments(request, membership.company_id);
    }

    return fetchDocuments(request, companyId);
  } catch (error: any) {
    console.error('[documents] GET error:', error);
    return NextResponse.json({ message: 'Failed to fetch documents' }, { status: 500 });
  }
}

async function fetchDocuments(request: NextRequest, companyId: string) {
  const { searchParams } = new URL(request.url);

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);

  const where = buildDocumentWhere(companyId, {
    status: searchParams.get('status'),
    channel: searchParams.get('channel'),
    q: searchParams.get('q'),
    from: searchParams.get('from'),
    to: searchParams.get('to'),
  });

  const documents = await prisma.document.findMany({
    where,
    orderBy: { upload_timestamp: 'desc' },
    take: limit + 1,
    skip: offset,
    include: {
      invoice: {
        select: {
          id: true,
          invoice_number: true,
          supplier_name: true,
          issue_date: true,
          total_amount: true,
          currency: true,
          review_status: true,
          gestoria_review_status: true,
        },
      },
    },
  });

  const hasMore = documents.length > limit;
  if (hasMore) documents.pop();

  return NextResponse.json({ documents, hasMore });
}
