import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

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

  const totalSpend = supplier.invoices.reduce((sum, inv) => sum + (inv.total_amount ?? 0), 0);

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

interface RawLine {
  id: string;
  description: string;
  normalized_description: string | null;
  quantity: number | null;
  unit_price: number | null;
  tax_rate: number | null;
  total_amount: number | null;
  currency: string | null;
  created_at: Date;
  invoice: { id: string; issue_date: Date; invoice_number: string };
}

function buildProductStats(lines: RawLine[]) {
  const grouped = new Map<string, RawLine[]>();

  for (const line of lines) {
    const key = line.normalized_description || line.description.toLowerCase().trim();
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(line);
  }

  const products = Array.from(grouped.entries()).map(([key, entries]) => {
    const sorted = [...entries].sort(
      (a, b) => new Date(a.invoice.issue_date).getTime() - new Date(b.invoice.issue_date).getTime(),
    );
    const withPrice = sorted.filter((e) => e.unit_price !== null);
    const firstPrice = withPrice[0]?.unit_price ?? null;
    const lastPrice = withPrice[withPrice.length - 1]?.unit_price ?? null;
    const variationPct =
      firstPrice !== null && lastPrice !== null && firstPrice > 0
        ? ((lastPrice - firstPrice) / firstPrice) * 100
        : null;

    return {
      normalized_description: key,
      last_description: sorted[sorted.length - 1]?.description ?? '',
      first_date: sorted[0]?.invoice.issue_date ?? null,
      last_date: sorted[sorted.length - 1]?.invoice.issue_date ?? null,
      first_price: firstPrice,
      last_price: lastPrice,
      variation_pct: variationPct !== null ? Math.round(variationPct * 10) / 10 : null,
      is_price_increase: variationPct !== null && variationPct > 5,
      total_quantity: sorted.reduce((sum, e) => sum + (e.quantity ?? 0), 0),
      appearances: sorted.length,
    };
  });

  return products.sort((a, b) => b.appearances - a.appearances);
}
