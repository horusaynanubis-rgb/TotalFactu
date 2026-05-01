import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { getSignedDownloadUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const document = await prisma.document.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        company_id: true,
        original_filename: true,
        mime_type: true,
        cloud_storage_path: true,
        processing_status: true,
        source_channel: true,
        upload_timestamp: true,
      },
    });

    if (!document) {
      return NextResponse.json({ message: 'Document not found' }, { status: 404 });
    }

    // Multi-tenant guard
    const membership = await prisma.membership.findFirst({
      where: { user_id: session.user.id, company_id: document.company_id },
    });

    if (!membership) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 403 });
    }

    const url = await getSignedDownloadUrl(document.cloud_storage_path, 300);

    return NextResponse.json({
      url,
      mime_type: document.mime_type,
      original_filename: document.original_filename,
      status: document.processing_status,
      source_channel: document.source_channel,
      upload_timestamp: document.upload_timestamp,
    });
  } catch (error: any) {
    console.error('[documents] preview GET error:', error);
    return NextResponse.json({ message: 'Could not generate preview URL' }, { status: 500 });
  }
}
