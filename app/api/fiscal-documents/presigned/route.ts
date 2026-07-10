import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { createSignedUploadUrl, buildFiscalDocumentPath } from '@/lib/storage';
import { ALLOWED_MIME_TYPES } from '@/lib/fiscal-document-types';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { fileName, contentType, fiscalYear, fiscalPeriod } = body;

    if (!fileName || !contentType || !fiscalYear || !fiscalPeriod) {
      return NextResponse.json(
        { message: 'fileName, contentType, fiscalYear and fiscalPeriod are required' },
        { status: 400 },
      );
    }

    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
      return NextResponse.json({ message: 'Unsupported file type' }, { status: 400 });
    }

    let companyId = session.user.companyId ?? null;
    if (!companyId) {
      const membership = await prisma.membership.findFirst({
        where: { user_id: session.user.id },
        orderBy: { created_at: 'asc' },
      });
      if (!membership) {
        return NextResponse.json({ message: 'User not associated with any company' }, { status: 400 });
      }
      companyId = membership.company_id;
    }

    const path = buildFiscalDocumentPath(companyId, Number(fiscalYear), String(fiscalPeriod), fileName);
    const { uploadUrl, cloud_storage_path } = await createSignedUploadUrl(path);

    return NextResponse.json({ uploadUrl, cloud_storage_path });
  } catch (error: any) {
    console.error('[fiscal-documents/presigned] error:', error);
    return NextResponse.json({ message: 'Failed to generate upload URL' }, { status: 500 });
  }
}
