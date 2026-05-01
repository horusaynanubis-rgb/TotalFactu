import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { deleteFile } from '@/lib/storage';

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

    return NextResponse.json({ invoice });
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

    const invoice = await prisma.invoice.update({
      where: { id: params.id },
      data: updateData,
    });

    // Log audit trail for all edits
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
