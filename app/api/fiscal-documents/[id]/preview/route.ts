import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { getSignedDownloadUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const doc = await prisma.fiscalDocument.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        company_id: true,
        original_filename: true,
        mime_type: true,
        cloud_storage_path: true,
        status: true,
        created_at: true,
      },
    });

    if (!doc) {
      return NextResponse.json({ message: 'Document not found' }, { status: 404 });
    }

    const membership = await prisma.membership.findFirst({
      where: { user_id: session.user.id, company_id: doc.company_id },
    });
    if (!membership) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 403 });
    }

    const url = await getSignedDownloadUrl(doc.cloud_storage_path, 300);

    return NextResponse.json({
      url,
      mime_type: doc.mime_type,
      original_filename: doc.original_filename,
      status: doc.status,
      upload_timestamp: doc.created_at,
    });
  } catch (error: any) {
    console.error('[fiscal-documents] preview GET error:', error);
    return NextResponse.json({ message: 'Could not generate preview URL' }, { status: 500 });
  }
}
