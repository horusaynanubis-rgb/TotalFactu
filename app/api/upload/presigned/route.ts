import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { generatePresignedUploadUrl } from '@/lib/s3';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { fileName, contentType, isPublic } = body;

    if (!fileName || !contentType) {
      return NextResponse.json(
        { message: 'fileName and contentType are required' },
        { status: 400 }
      );
    }

    const { uploadUrl, cloud_storage_path } = await generatePresignedUploadUrl(
      fileName,
      contentType,
      isPublic ?? false
    );

    return NextResponse.json({ uploadUrl, cloud_storage_path });
  } catch (error: any) {
    console.error('Presigned URL error:', error);
    return NextResponse.json(
      { message: 'Failed to generate upload URL' },
      { status: 500 }
    );
  }
}
