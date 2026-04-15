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

    const membership = await prisma.membership.findFirst({
      where: { user_id: session.user.id },
    });

    if (!membership) {
      return NextResponse.json({ message: 'No company found' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const channel = searchParams.get('channel');

    const where: any = { company_id: membership.company_id };
    if (status && status !== 'all') {
      where.processing_status = status;
    }
    if (channel && channel !== 'all') {
      where.source_channel = channel;
    }

    const documents = await prisma.document.findMany({
      where,
      orderBy: { upload_timestamp: 'desc' },
      take: 100,
    });

    return NextResponse.json({ documents });
  } catch (error: any) {
    console.error('Get documents error:', error);
    return NextResponse.json(
      { message: 'Failed to fetch documents' },
      { status: 500 }
    );
  }
}
