import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { cloud_storage_path, isPublic, fileName, mimeType, sourceChannel } = body;

    if (!cloud_storage_path || !fileName || !mimeType) {
      return NextResponse.json(
        { message: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Get user's company
    const membership = await prisma.membership.findFirst({
      where: { user_id: session.user.id },
    });

    if (!membership) {
      return NextResponse.json(
        { message: 'User not associated with any company' },
        { status: 400 }
      );
    }

    // Create document record
    const document = await prisma.document.create({
      data: {
        company_id: membership.company_id,
        user_id: session.user.id,
        source_channel: sourceChannel || 'web',
        original_filename: fileName,
        mime_type: mimeType,
        processing_status: 'processing',
        cloud_storage_path,
        is_public: isPublic ?? false,
      },
    });

    // Trigger AI extraction asynchronously (in real app, this would be a queue job)
    // For now, we'll trigger it via a separate API call
    fetch(`${request.nextUrl.origin}/api/documents/${document.id}/process`, {
      method: 'POST',
    }).catch((err: any) => console.error('Process trigger error:', err));

    return NextResponse.json({ document });
  } catch (error: any) {
    console.error('Upload complete error:', error);
    return NextResponse.json(
      { message: 'Failed to complete upload' },
      { status: 500 }
    );
  }
}
