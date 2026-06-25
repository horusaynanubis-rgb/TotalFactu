import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // Use companyId already stored in the JWT — avoids a redundant DB query
    // and ensures consistency with the same company used across all API routes.
    const companyId = session.user.companyId;
    if (!companyId) {
      // Fallback: user exists but has no membership yet (edge case on first signup)
      const membership = await prisma.membership.findFirst({
        where: { user_id: session.user.id },
        orderBy: { created_at: 'asc' },
      });
      if (!membership) {
        return NextResponse.json({ message: 'No company found' }, { status: 400 });
      }
      // Redirect to the same handler with the resolved companyId
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
  const status = searchParams.get('status');
  const channel = searchParams.get('channel');

  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);

  const where: any = { company_id: companyId };
  if (status && status !== 'all') where.processing_status = status;
  if (channel && channel !== 'all') where.source_channel = channel;

  const documents = await prisma.document.findMany({
    where,
    orderBy: { upload_timestamp: 'desc' },
    take: limit + 1,
    skip: offset,
  });

  const hasMore = documents.length > limit;
  if (hasMore) documents.pop();

  return NextResponse.json({ documents, hasMore });
}
