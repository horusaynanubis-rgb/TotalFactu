import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { getFileUrl } from '@/lib/s3';

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

    const exportRecord = await prisma.export.findUnique({
      where: { id: params.id },
    });

    if (!exportRecord) {
      return NextResponse.json({ message: 'Export not found' }, { status: 404 });
    }

    const downloadUrl = await getFileUrl(exportRecord.cloud_storage_path, exportRecord.is_public);

    return NextResponse.json({ downloadUrl });
  } catch (error: any) {
    console.error('Download export error:', error);
    return NextResponse.json(
      { message: 'Failed to get download URL' },
      { status: 500 }
    );
  }
}
