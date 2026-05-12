import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const companyId = (session.user as any).companyId;
    if (!companyId) {
      return NextResponse.json({ message: 'No company found' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // pending|matched|expired|archived

    const deliveryNotes = await prisma.deliveryNote.findMany({
      where: {
        company_id: companyId,
        ...(status ? { status } : {}),
      },
      include: {
        document: {
          select: {
            id: true,
            source_channel: true,
            original_filename: true,
            processing_status: true,
            upload_timestamp: true,
          },
        },
        matched_invoice: {
          select: { id: true, invoice_number: true, total_amount: true, currency: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return NextResponse.json({ delivery_notes: deliveryNotes });
  } catch (error: any) {
    console.error('[delivery-notes GET]', error);
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
