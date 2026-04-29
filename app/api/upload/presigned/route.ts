import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { createSignedUploadUrl, buildUploadPath } from '@/lib/storage';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { fileName, contentType } = body;

    if (!fileName || !contentType) {
      return NextResponse.json(
        { message: 'fileName and contentType are required' },
        { status: 400 }
      );
    }

    // Use a per-user path so each company's files stay isolated
    const path = buildUploadPath(session.user.id, fileName);
    const { uploadUrl, cloud_storage_path } = await createSignedUploadUrl(path);

    return NextResponse.json({ uploadUrl, cloud_storage_path });
  } catch (error: any) {
    console.error('[upload/presigned] error:', error);
    return NextResponse.json(
      { message: 'Failed to generate upload URL' },
      { status: 500 }
    );
  }
}
