import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { deleteFile } from '@/lib/storage';
import { getDeductibleInputVat, getExpenseAmount, getEffectiveFiscalPeriod } from '@/lib/invoice-fiscal-treatment';
import {
  isValidDocumentTypeValue,
  isValidFiscalPeriodValue,
  buildFiscalOverrideUpdate,
} from '@/lib/invoice-fiscal-override';

export const dynamic = 'force-dynamic';

// Get a single invoice by ID
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: params.id },
      include: { document: true },
    });

    if (!invoice) {
      return NextResponse.json({ message: 'Invoice not found' }, { status: 404 });
    }

    // Verify user has access to this invoice
    const membership = await prisma.membership.findFirst({
      where: { user_id: session.user.id, company_id: invoice.company_id },
    });

    if (!membership) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 403 });
    }

    // Fiscal treatment resulting from document_type/fiscal_period today —
    // computed via the same central helpers fiscal-summary.ts/economic-summary.ts
    // use, so the UI never re-derives this logic independently. NULL
    // document_type (legacy/unconfirmed) resolves exactly like FULL_INVOICE.
    const effectivePeriod = getEffectiveFiscalPeriod({
      fiscal_period_year: invoice.fiscal_period_year,
      fiscal_period_quarter: invoice.fiscal_period_quarter,
      issue_date: invoice.issue_date,
    });
    const fiscalTreatment = invoice.invoice_type === 'received'
      ? {
          deductible_input_vat: getDeductibleInputVat(invoice),
          expense_amount: getExpenseAmount(invoice),
          effective_fiscal_period: effectivePeriod,
        }
      : { effective_fiscal_period: effectivePeriod };

    return NextResponse.json({ invoice, fiscal_treatment: fiscalTreatment });
  } catch (error: any) {
    console.error('Get invoice error:', error);
    return NextResponse.json(
      { message: 'Failed to fetch invoice' },
      { status: 500 }
    );
  }
}

// Update an invoice (review queue editing, approve/reject)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Fetch existing invoice for audit log
    const existingInvoice = await prisma.invoice.findUnique({
      where: { id: params.id },
    });

    if (!existingInvoice) {
      return NextResponse.json({ message: 'Invoice not found' }, { status: 404 });
    }

    // Verify user has access
    const membership = await prisma.membership.findFirst({
      where: { user_id: session.user.id, company_id: existingInvoice.company_id },
    });

    if (!membership) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 403 });
    }

    // Whitelist editable fields
    const editableFields = [
      'invoice_type', 'invoice_number', 'issue_date', 'due_date',
      'supplier_name', 'supplier_tax_id', 'customer_name', 'customer_tax_id',
      'subtotal', 'tax_amount', 'total_amount', 'currency',
      'tax_rate', 'payment_method', 'category', 'notes', 'review_status',
    ];

    const updateData: Record<string, any> = {};
    for (const key of editableFields) {
      if (key in body) {
        let val = body[key];
        // Type coercion for numeric fields
        if (['subtotal', 'tax_amount', 'total_amount', 'tax_rate'].includes(key) && val !== null) {
          val = Number(val);
          if (isNaN(val)) continue;
        }
        // Date coercion
        if (['issue_date', 'due_date'].includes(key) && val) {
          val = new Date(val);
          if (isNaN(val.getTime())) continue;
        }
        if (key === 'due_date' && !val) {
          val = null;
        }
        updateData[key] = val;
      }
    }

    // document_type / fiscal_period_year / fiscal_period_quarter (Fase
    // Gascón, 2026-09) are handled separately from the whitelist above —
    // never trust a client-supplied document_type_classified_by/at or
    // fiscal_period_set_by/at; those are always server-derived here. Kept
    // out of `updateData`'s generic audit diff so each gets its own
    // dedicated, more specific AuditLog action instead of being folded into
    // the generic 'update' entry. See lib/invoice-fiscal-override.ts.
    if ('document_type' in body && !isValidDocumentTypeValue(body.document_type)) {
      return NextResponse.json({ message: 'Invalid document_type' }, { status: 400 });
    }
    if (
      ('fiscal_period_year' in body || 'fiscal_period_quarter' in body) &&
      !isValidFiscalPeriodValue(body.fiscal_period_year ?? null, body.fiscal_period_quarter ?? null)
    ) {
      return NextResponse.json({ message: 'Invalid fiscal_period_year/fiscal_period_quarter' }, { status: 400 });
    }

    const { updateData: fiscalOverrideUpdate, auditEntries: fiscalAuditEntries } = buildFiscalOverrideUpdate(
      {
        document_type: existingInvoice.document_type,
        fiscal_period_year: existingInvoice.fiscal_period_year,
        fiscal_period_quarter: existingInvoice.fiscal_period_quarter,
      },
      {
        ...('document_type' in body ? { document_type: body.document_type } : {}),
        ...('fiscal_period_year' in body || 'fiscal_period_quarter' in body
          ? { fiscal_period_year: body.fiscal_period_year ?? null, fiscal_period_quarter: body.fiscal_period_quarter ?? null }
          : {}),
      },
      session.user.id,
    );

    const invoice = await prisma.invoice.update({
      where: { id: params.id },
      data: { ...updateData, ...fiscalOverrideUpdate },
    });

    // Log audit trail for all edits
    if (Object.keys(updateData).length > 0) {
      await prisma.auditLog.create({
        data: {
          company_id: membership.company_id,
          user_id: session.user.id,
          entity_type: 'invoice',
          entity_id: params.id,
          action: 'update',
          old_values: JSON.stringify(
            Object.fromEntries(
              Object.keys(updateData).map((k) => [k, (existingInvoice as any)[k]])
            )
          ),
          new_values: JSON.stringify(updateData),
        },
      });
    }

    for (const entry of fiscalAuditEntries) {
      await prisma.auditLog.create({
        data: {
          company_id: membership.company_id,
          user_id: session.user.id,
          entity_type: 'invoice',
          entity_id: params.id,
          action: entry.action,
          old_values: entry.old_values,
          new_values: entry.new_values,
        },
      });
    }

    return NextResponse.json({ invoice });
  } catch (error: any) {
    console.error('Update invoice error:', error);
    return NextResponse.json(
      { message: 'Failed to update invoice' },
      { status: 500 }
    );
  }
}

// Delete an invoice (and optionally its source document)
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    // Default: also delete the linked document and its file
    const deleteDocument = searchParams.get('deleteDocument') !== 'false';

    const invoice = await prisma.invoice.findUnique({
      where: { id: params.id },
      include: { document: true },
    });

    if (!invoice) {
      return NextResponse.json({ message: 'Invoice not found' }, { status: 404 });
    }

    // Multi-tenant guard
    const membership = await prisma.membership.findFirst({
      where: { user_id: session.user.id, company_id: invoice.company_id },
    });

    if (!membership) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 403 });
    }

    // Delete invoice first so the FK (invoice.document_id → document.id) is removed
    await prisma.invoice.delete({ where: { id: params.id } });

    // Optionally delete the linked document record
    let storageWarning: string | undefined;
    if (deleteDocument && invoice.document) {
      await prisma.document.delete({ where: { id: invoice.document.id } });

      if (invoice.document.cloud_storage_path) {
        try {
          await deleteFile(invoice.document.cloud_storage_path);
        } catch (err: any) {
          storageWarning = err?.message ?? 'Unknown error';
          console.error('[invoices] Storage delete failed:', storageWarning);
        }
      }
    }

    await prisma.auditLog.create({
      data: {
        company_id: invoice.company_id,
        user_id: session.user.id,
        entity_type: 'invoice',
        entity_id: params.id,
        action: 'delete',
        old_values: JSON.stringify({
          invoice_number: invoice.invoice_number,
          supplier_name: invoice.supplier_name,
          total_amount: invoice.total_amount,
          issue_date: invoice.issue_date,
          document_also_deleted: deleteDocument && !!invoice.document,
        }),
      },
    });

    return NextResponse.json({
      message: 'Invoice deleted successfully',
      ...(storageWarning ? { storageWarning: `File could not be deleted from storage: ${storageWarning}` } : {}),
    });
  } catch (error: any) {
    console.error('[invoices] DELETE error:', error);
    return NextResponse.json({ message: 'Failed to delete invoice' }, { status: 500 });
  }
}
