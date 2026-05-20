import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  const session = await getServerSession(authOptions);
  const companyId = (session?.user as any)?.companyId;
  if (!session || !companyId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const suppliers = await prisma.supplier.findMany({
    where: { company_id: companyId },
    include: {
      invoices: {
        select: { id: true, total_amount: true, issue_date: true },
      },
      invoice_lines: {
        select: {
          invoice_id: true,
          normalized_description: true,
          unit_price: true,
          invoice: { select: { issue_date: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  const result = suppliers.map((s) => {
    const invoiceCount = s.invoices.length;
    const totalSpend = s.invoices.reduce((sum, inv) => sum + (inv.total_amount ?? 0), 0);
    const lastInvoiceDate = s.invoices.length
      ? s.invoices.reduce((latest, inv) =>
          inv.issue_date > latest ? inv.issue_date : latest,
          s.invoices[0].issue_date,
        )
      : null;

    const productDescriptions = new Set(
      s.invoice_lines.map((l) => l.normalized_description ?? '').filter(Boolean),
    );
    const productCount = productDescriptions.size;

    const maxVariation = computeMaxVariation(s.invoice_lines);

    return {
      id: s.id,
      name: s.name,
      tax_id: s.tax_id,
      created_at: s.created_at,
      invoice_count: invoiceCount,
      total_spend: totalSpend,
      product_count: productCount,
      last_invoice_date: lastInvoiceDate,
      max_variation: maxVariation,
    };
  });

  return NextResponse.json({ suppliers: result });
}

function computeMaxVariation(lines: { normalized_description: string | null; unit_price: number | null; invoice: { issue_date: Date } }[]): number | null {
  const grouped = new Map<string, { price: number; date: Date }[]>();
  for (const line of lines) {
    if (line.unit_price === null || !line.normalized_description) continue;
    const key = line.normalized_description;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push({ price: line.unit_price, date: new Date(line.invoice.issue_date) });
  }

  let maxVariation: number | null = null;
  for (const entries of grouped.values()) {
    if (entries.length < 2) continue;
    entries.sort((a, b) => a.date.getTime() - b.date.getTime());
    const firstPrice = entries[0].price;
    const lastPrice = entries[entries.length - 1].price;
    if (firstPrice > 0) {
      const variation = ((lastPrice - firstPrice) / firstPrice) * 100;
      if (maxVariation === null || Math.abs(variation) > Math.abs(maxVariation)) {
        maxVariation = variation;
      }
    }
  }
  return maxVariation;
}
