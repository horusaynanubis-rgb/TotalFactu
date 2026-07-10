import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { ALLOWED_MIME_TYPES, FISCAL_DOCUMENT_TYPES, FISCAL_PERIODS } from '@/lib/fiscal-document-types';

// NOTE: unlike /api/upload/complete, this route does NOT call /process — these
// files are never sent to Gemini/OCR and never create an Invoice/Supplier/InvoiceLine.
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      cloud_storage_path,
      fileName,
      mimeType,
      sizeBytes,
      documentType,
      fiscalYear,
      fiscalPeriod,
      description,
    } = body;

    if (!cloud_storage_path || !fileName || !mimeType || !documentType || !fiscalYear || !fiscalPeriod) {
      return NextResponse.json({ message: 'Missing required fields' }, { status: 400 });
    }
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json({ message: 'Unsupported file type' }, { status: 400 });
    }
    if (!FISCAL_DOCUMENT_TYPES.includes(documentType)) {
      return NextResponse.json({ message: 'Invalid documentType' }, { status: 400 });
    }
    if (!FISCAL_PERIODS.includes(fiscalPeriod)) {
      return NextResponse.json({ message: 'Invalid fiscalPeriod' }, { status: 400 });
    }
    const yearNum = Number(fiscalYear);
    if (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 2100) {
      return NextResponse.json({ message: 'Invalid fiscalYear' }, { status: 400 });
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

    const doc = await prisma.fiscalDocument.create({
      data: {
        company_id: companyId,
        uploaded_by_user_id: session.user.id,
        original_filename: fileName,
        mime_type: mimeType,
        size_bytes: Number(sizeBytes) || 0,
        cloud_storage_path,
        document_type: documentType,
        fiscal_year: yearNum,
        fiscal_period: fiscalPeriod,
        description: description || null,
      },
    });

    await prisma.auditLog.create({
      data: {
        company_id: companyId,
        user_id: session.user.id,
        entity_type: 'fiscal_document',
        entity_id: doc.id,
        action: 'create',
        new_values: JSON.stringify({
          original_filename: doc.original_filename,
          document_type: doc.document_type,
          fiscal_year: doc.fiscal_year,
          fiscal_period: doc.fiscal_period,
        }),
      },
    });

    return NextResponse.json({ document: doc });
  } catch (error: any) {
    console.error('[fiscal-documents/complete] Error:', error);
    return NextResponse.json({ message: 'Failed to complete upload' }, { status: 500 });
  }
}
