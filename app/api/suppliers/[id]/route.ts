import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { buildProductStats } from '@/lib/supplier-analysis';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  const companyId = (session?.user as any)?.companyId;
  if (!session || !companyId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supplier = await prisma.supplier.findFirst({
    where: { id: params.id, company_id: companyId },
    include: {
      invoices: {
        select: {
          id: true,
          invoice_number: true,
          issue_date: true,
          total_amount: true,
          currency: true,
          review_status: true,
        },
        orderBy: { issue_date: 'desc' },
      },
      invoice_lines: {
        select: {
          id: true,
          description: true,
          normalized_description: true,
          quantity: true,
          unit_price: true,
          tax_rate: true,
          total_amount: true,
          currency: true,
          created_at: true,
          invoice: { select: { id: true, issue_date: true, invoice_number: true } },
        },
        orderBy: { created_at: 'asc' },
      },
    },
  });

  if (!supplier) {
    return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });
  }

  const totalSpend = supplier.invoices.reduce(
    (sum, inv) => sum + (inv.total_amount ?? 0),
    0,
  );

  const products = buildProductStats(supplier.invoice_lines);

  return NextResponse.json({
    supplier: {
      id: supplier.id,
      name: supplier.name,
      tax_id: supplier.tax_id,
      created_at: supplier.created_at,
    },
    invoice_count: supplier.invoices.length,
    total_spend: totalSpend,
    invoices: supplier.invoices,
    products,
  });
}
