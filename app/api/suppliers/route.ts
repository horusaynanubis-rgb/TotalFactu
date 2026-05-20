import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { computeSupplierSummary } from '@/lib/supplier-analysis';

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
          normalized_description: true,
          unit_price: true,
          invoice: { select: { issue_date: true } },
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  let globalProducts = 0;
  let globalAlerts = 0;
  let globalSpend = 0;

  const result = suppliers.map((s) => {
    const invoiceCount = s.invoices.length;
    const totalSpend = s.invoices.reduce((sum, inv) => sum + (inv.total_amount ?? 0), 0);
    const lastActivity = s.invoices.length
      ? s.invoices.reduce(
          (latest, inv) => (inv.issue_date > latest ? inv.issue_date : latest),
          s.invoices[0].issue_date,
        )
      : null;

    const summary = computeSupplierSummary(s.invoice_lines);

    globalProducts += summary.product_count;
    globalAlerts   += summary.alerts_count;
    globalSpend    += totalSpend;

    return {
      id: s.id,
      name: s.name,
      tax_id: s.tax_id,
      created_at: s.created_at,
      invoice_count: invoiceCount,
      total_spend: totalSpend,
      product_count: summary.product_count,
      alerts_count: summary.alerts_count,
      max_variation: summary.max_variation,
      last_activity: lastActivity,
    };
  });

  return NextResponse.json({
    kpis: {
      supplier_count: suppliers.length,
      product_count: globalProducts,
      alerts_count: globalAlerts,
      total_spend: globalSpend,
    },
    suppliers: result,
  });
}
