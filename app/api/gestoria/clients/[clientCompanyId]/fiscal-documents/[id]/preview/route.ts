import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { getSignedDownloadUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

async function resolveGestoriaAccess(userId: string, clientCompanyId: string) {
  const membership = await prisma.membership.findFirst({
    where: { user_id: userId },
    select: { company_id: true, company: { select: { company_type: true } } },
  });
  if (!membership || membership.company.company_type !== 'gestoria') return null;

  const license = await prisma.license.findFirst({
    where: {
      client_company_id: clientCompanyId,
      status: 'assigned',
      pack: { gestoria_company_id: membership.company_id },
    },
  });
  if (!license) return null;

  return { gestoriaCompanyId: membership.company_id };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { clientCompanyId: string; id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  const doc = await prisma.fiscalDocument.findUnique({ where: { id: params.id } });
  if (!doc || doc.company_id !== params.clientCompanyId) {
    return NextResponse.json({ message: 'Document not found' }, { status: 404 });
  }

  const url = await getSignedDownloadUrl(doc.cloud_storage_path, 300);

  return NextResponse.json({
    url,
    mime_type: doc.mime_type,
    original_filename: doc.original_filename,
    status: doc.status,
    upload_timestamp: doc.created_at,
  });
}
