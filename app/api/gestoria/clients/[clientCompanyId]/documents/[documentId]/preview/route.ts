import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { getSignedDownloadUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: { clientCompanyId: string; documentId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user_id: session.user.id },
    select: { company_id: true, company: { select: { company_type: true } } },
  });

  if (!membership || membership.company.company_type !== 'gestoria') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const license = await prisma.license.findFirst({
    where: {
      client_company_id: params.clientCompanyId,
      status: 'assigned',
      pack: { gestoria_company_id: membership.company_id },
    },
  });

  if (!license) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const document = await prisma.document.findUnique({
    where: { id: params.documentId },
    select: {
      id: true,
      company_id: true,
      original_filename: true,
      mime_type: true,
      cloud_storage_path: true,
    },
  });

  if (!document || document.company_id !== params.clientCompanyId) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  const url = await getSignedDownloadUrl(document.cloud_storage_path, 300);

  return NextResponse.json({
    url,
    mime_type: document.mime_type,
    original_filename: document.original_filename,
  });
}
