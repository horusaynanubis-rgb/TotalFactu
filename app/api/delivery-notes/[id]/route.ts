import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { deleteFile } from '@/lib/storage';

export const dynamic = 'force-dynamic';

async function getDeliveryNoteForCompany(id: string, companyId: string) {
  return prisma.deliveryNote.findFirst({
    where: { id, company_id: companyId },
    include: {
      document: true,
      matched_invoice: {
        select: { id: true, invoice_number: true, total_amount: true, currency: true },
      },
    },
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    const companyId = (session.user as any).companyId;

    const dn = await getDeliveryNoteForCompany(params.id, companyId);
    if (!dn) return NextResponse.json({ message: 'Not found' }, { status: 404 });

    return NextResponse.json({ delivery_note: dn });
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    const companyId = (session.user as any).companyId;

    const dn = await getDeliveryNoteForCompany(params.id, companyId);
    if (!dn) return NextResponse.json({ message: 'Not found' }, { status: 404 });

    const body = await request.json();
    const allowed = ['status', 'notes', 'supplier_name', 'supplier_tax_id', 'delivery_note_number', 'issue_date', 'total_amount', 'currency'];
    const data: Record<string, any> = {};
    for (const key of allowed) {
      if (key in body) data[key] = body[key];
    }

    if (data.issue_date) data.issue_date = new Date(data.issue_date);

    const updated = await prisma.deliveryNote.update({
      where: { id: params.id },
      data,
    });

    await prisma.auditLog.create({
      data: {
        company_id: companyId,
        user_id: session.user.id,
        entity_type: 'delivery_note',
        entity_id: params.id,
        action: 'update',
        old_values: JSON.stringify(dn),
        new_values: JSON.stringify(data),
      },
    });

    return NextResponse.json({ delivery_note: updated });
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    const companyId = (session.user as any).companyId;

    const dn = await getDeliveryNoteForCompany(params.id, companyId);
    if (!dn) return NextResponse.json({ message: 'Not found' }, { status: 404 });

    const { searchParams } = new URL(request.url);
    const deleteDocument = searchParams.get('deleteDocument') === 'true';

    // FK order: delete DeliveryNote first, then optionally Document + file
    await prisma.deliveryNote.delete({ where: { id: params.id } });

    if (deleteDocument && dn.document) {
      await prisma.document.delete({ where: { id: dn.document_id } });
      try { await deleteFile(dn.document.cloud_storage_path); } catch {}
    }

    await prisma.auditLog.create({
      data: {
        company_id: companyId,
        user_id: session.user.id,
        entity_type: 'delivery_note',
        entity_id: params.id,
        action: 'delete',
        old_values: JSON.stringify({ id: params.id, deleteDocument }),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
