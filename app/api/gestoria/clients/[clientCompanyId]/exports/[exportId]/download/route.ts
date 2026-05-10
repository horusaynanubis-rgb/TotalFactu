import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { getFileUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: { clientCompanyId: string; exportId: string } },
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

  // Verify the gestoria actually holds a license for this client
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

  // Verify the export belongs to that client
  const exportRecord = await prisma.export.findUnique({
    where: { id: params.exportId },
  });

  if (!exportRecord || exportRecord.company_id !== params.clientCompanyId) {
    return NextResponse.json({ error: 'Export not found' }, { status: 404 });
  }

  const downloadUrl = await getFileUrl(exportRecord.cloud_storage_path, exportRecord.is_public);

  return NextResponse.json({ downloadUrl });
}
