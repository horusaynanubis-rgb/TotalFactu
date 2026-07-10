import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { deleteFile } from '@/lib/storage';
import { FISCAL_DOCUMENT_TYPES, FISCAL_PERIODS } from '@/lib/fiscal-document-types';

export const dynamic = 'force-dynamic';

async function requireOwnerCompanyDoc(userId: string, id: string) {
  const doc = await prisma.fiscalDocument.findUnique({ where: { id } });
  if (!doc) return { error: NextResponse.json({ message: 'Document not found' }, { status: 404 }) };

  const membership = await prisma.membership.findFirst({
    where: { user_id: userId, company_id: doc.company_id },
  });
  if (!membership) return { error: NextResponse.json({ message: 'Unauthorized' }, { status: 403 }) };

  return { doc };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { doc, error } = await requireOwnerCompanyDoc(session.user.id, params.id);
    if (error) return error;

    const body = await request.json();
    const { documentType, fiscalYear, fiscalPeriod, description } = body;

    const data: Record<string, any> = {};
    if (documentType !== undefined) {
      if (!FISCAL_DOCUMENT_TYPES.includes(documentType)) {
        return NextResponse.json({ message: 'Invalid documentType' }, { status: 400 });
      }
      data.document_type = documentType;
    }
    if (fiscalPeriod !== undefined) {
      if (!FISCAL_PERIODS.includes(fiscalPeriod)) {
        return NextResponse.json({ message: 'Invalid fiscalPeriod' }, { status: 400 });
      }
      data.fiscal_period = fiscalPeriod;
    }
    if (fiscalYear !== undefined) {
      const yearNum = Number(fiscalYear);
      if (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 2100) {
        return NextResponse.json({ message: 'Invalid fiscalYear' }, { status: 400 });
      }
      data.fiscal_year = yearNum;
    }
    if (description !== undefined) data.description = description || null;

    const updated = await prisma.fiscalDocument.update({ where: { id: params.id }, data });

    await prisma.auditLog.create({
      data: {
        company_id: doc!.company_id,
        user_id: session.user.id,
        entity_type: 'fiscal_document',
        entity_id: params.id,
        action: 'update',
        old_values: JSON.stringify({
          document_type: doc!.document_type,
          fiscal_year: doc!.fiscal_year,
          fiscal_period: doc!.fiscal_period,
          description: doc!.description,
        }),
        new_values: JSON.stringify(data),
      },
    });

    return NextResponse.json({ document: updated });
  } catch (error: any) {
    console.error('[fiscal-documents] PATCH error:', error);
    return NextResponse.json({ message: 'Failed to update document' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { doc, error } = await requireOwnerCompanyDoc(session.user.id, params.id);
    if (error) return error;

    await prisma.fiscalDocument.delete({ where: { id: params.id } });

    await prisma.auditLog.create({
      data: {
        company_id: doc!.company_id,
        user_id: session.user.id,
        entity_type: 'fiscal_document',
        entity_id: params.id,
        action: 'delete',
        old_values: JSON.stringify({
          original_filename: doc!.original_filename,
          document_type: doc!.document_type,
          fiscal_year: doc!.fiscal_year,
          fiscal_period: doc!.fiscal_period,
          cloud_storage_path: doc!.cloud_storage_path,
        }),
      },
    });

    let storageWarning: string | undefined;
    if (doc!.cloud_storage_path) {
      try {
        await deleteFile(doc!.cloud_storage_path);
      } catch (err: any) {
        storageWarning = err?.message ?? 'Unknown error';
        console.error('[fiscal-documents] Storage delete failed for', doc!.cloud_storage_path, storageWarning);
      }
    }

    return NextResponse.json({
      message: 'Document deleted successfully',
      ...(storageWarning ? { storageWarning: `File could not be deleted from storage: ${storageWarning}` } : {}),
    });
  } catch (error: any) {
    console.error('[fiscal-documents] DELETE error:', error);
    return NextResponse.json({ message: 'Failed to delete document' }, { status: 500 });
  }
}
