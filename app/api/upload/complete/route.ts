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
      return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
    }

    // Use companyId from JWT (consistent with /api/documents and /api/invoices).
    // Fall back to the earliest membership only if the JWT is stale (edge case).
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

    console.log(`[upload/complete] user=${session.user.id} email=${session.user.email} companyId=${companyId} file=${fileName} mime=${mimeType}`);

    // Enforce Demo plan invoice limit
    const subscription = await prisma.subscription.findFirst({
      where: { company_id: companyId },
    });
    if (subscription?.plan_name === 'demo') {
      const invoiceCount = await prisma.invoice.count({ where: { company_id: companyId } });
      if (invoiceCount >= 5) {
        return NextResponse.json(
          { message: 'Demo plan limit reached. Upgrade to Profesional to upload more invoices.', code: 'DEMO_LIMIT_REACHED' },
          { status: 403 }
        );
      }
    }

    const document = await prisma.document.create({
      data: {
        company_id: companyId,
        user_id: session.user.id,
        source_channel: sourceChannel || 'web',
        original_filename: fileName,
        mime_type: mimeType,
        processing_status: 'processing',
        cloud_storage_path,
        is_public: isPublic ?? false,
      },
    });

    console.log(`[upload/complete] Document created: id=${document.id} company_id=${document.company_id}`);

    // Fire-and-forget — the process endpoint updates the document status async
    fetch(`${request.nextUrl.origin}/api/documents/${document.id}/process`, {
      method: 'POST',
    }).catch((err: any) => console.error('[upload/complete] Process trigger error:', err));

    return NextResponse.json({ document });
  } catch (error: any) {
    console.error('[upload/complete] Error:', error);
    return NextResponse.json({ message: 'Failed to complete upload' }, { status: 500 });
  }
}
