import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { deleteFile } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function DELETE(
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
      include: { invoice: true },
    });

    if (!document) {
      return NextResponse.json({ message: 'Document not found' }, { status: 404 });
    }

    // Multi-tenant guard: user must belong to this document's company
    const membership = await prisma.membership.findFirst({
      where: { user_id: session.user.id, company_id: document.company_id },
    });

    if (!membership) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 403 });
    }

    // Delete associated invoice first (Invoice has FK → Document)
    if (document.invoice) {
      await prisma.invoice.delete({ where: { id: document.invoice.id } });
    }

    // Delete document record
    await prisma.document.delete({ where: { id: params.id } });

    // Audit log before storage deletion so DB is always consistent
    await prisma.auditLog.create({
      data: {
        company_id: document.company_id,
        user_id: session.user.id,
        entity_type: 'document',
        entity_id: params.id,
        action: 'delete',
        old_values: JSON.stringify({
          original_filename: document.original_filename,
          processing_status: document.processing_status,
          source_channel: document.source_channel,
          cloud_storage_path: document.cloud_storage_path,
          invoice_id: document.invoice?.id ?? null,
        }),
      },
    });

    // Best-effort storage deletion: log error but don't return 500 since DB is already clean
    let storageWarning: string | undefined;
    if (document.cloud_storage_path) {
      try {
        await deleteFile(document.cloud_storage_path);
      } catch (err: any) {
        storageWarning = err?.message ?? 'Unknown error';
        console.error('[documents] Storage delete failed for', document.cloud_storage_path, storageWarning);
      }
    }

    return NextResponse.json({
      message: 'Document deleted successfully',
      ...(storageWarning ? { storageWarning: `File could not be deleted from storage: ${storageWarning}` } : {}),
    });
  } catch (error: any) {
    console.error('[documents] DELETE error:', error);
    return NextResponse.json({ message: 'Failed to delete document' }, { status: 500 });
  }
}
