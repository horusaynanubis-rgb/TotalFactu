import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// POST /api/delivery-notes/[id]/match  — manually link a delivery note to an invoice
// Body: { invoice_id: string } or { invoice_id: null } to unmatch
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    const companyId = (session.user as any).companyId;

    const dn = await prisma.deliveryNote.findFirst({
      where: { id: params.id, company_id: companyId },
    });
    if (!dn) return NextResponse.json({ message: 'Not found' }, { status: 404 });

    const { invoice_id } = await request.json();

    if (invoice_id) {
      // Verify invoice belongs to same company
      const invoice = await prisma.invoice.findFirst({
        where: { id: invoice_id, company_id: companyId },
      });
      if (!invoice) return NextResponse.json({ message: 'Invoice not found' }, { status: 404 });

      const updated = await prisma.deliveryNote.update({
        where: { id: params.id },
        data: { matched_invoice_id: invoice_id, status: 'matched' },
        include: {
          matched_invoice: { select: { id: true, invoice_number: true, total_amount: true, currency: true } },
        },
      });

      await prisma.auditLog.create({
        data: {
          company_id: companyId,
          user_id: session.user.id,
          entity_type: 'delivery_note',
          entity_id: params.id,
          action: 'match',
          old_values: JSON.stringify({ matched_invoice_id: dn.matched_invoice_id }),
          new_values: JSON.stringify({ matched_invoice_id: invoice_id }),
        },
      });

      return NextResponse.json({ delivery_note: updated });
    } else {
      // Unmatch
      const updated = await prisma.deliveryNote.update({
        where: { id: params.id },
        data: { matched_invoice_id: null, status: 'pending' },
      });

      return NextResponse.json({ delivery_note: updated });
    }
  } catch (error: any) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
