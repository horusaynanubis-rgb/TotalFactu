import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/admin/platform-admin";
import { prisma } from "@/lib/prisma";
import { EXCLUDE_INTERNAL_WHERE, EXCLUDE_NON_REVENUE_WHERE, getLatestSubscriptionMap } from "@/lib/admin/company-metrics";
import { getPaymentStatusLabel } from "@/lib/admin/company-classification";
import { mrrContributionCents } from "@/lib/admin/billing-status";

export const dynamic = "force-dynamic";

// GET /api/admin/reports?month=1-12&year=YYYY
//
// Flow metrics (altas, cancelaciones, documentos, facturas, exportaciones)
// are reliable for any past month — they come straight from timestamped
// rows. "Clientes activos/pago/beta" are a live snapshot, not a historical
// series (no event log records subscription status changes over time), so
// they're only returned when the requested month is the current one —
// otherwise omitted rather than reconstructed/invented (plan section 10,
// "no inventar").
export async function GET(request: NextRequest) {
  const admin = await requirePlatformAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const now = new Date();
  const year = Number(request.nextUrl.searchParams.get("year") ?? now.getUTCFullYear());
  const month = Number(request.nextUrl.searchParams.get("month") ?? now.getUTCMonth() + 1); // 1-12

  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  const periodEnd = new Date(Date.UTC(year, month, 1));
  const isCurrentMonth = year === now.getUTCFullYear() && month === now.getUTCMonth() + 1;

  const [
    newCompanies,
    cancellations,
    documentsProcessed,
    invoicesProcessed,
    exportsPerformed,
    paidAgg,
    failedPayments,
    trialsEnded,
    firstPayments,
  ] = await Promise.all([
    prisma.company.count({ where: { ...EXCLUDE_INTERNAL_WHERE, created_at: { gte: periodStart, lt: periodEnd } } }),
    prisma.subscription.count({ where: { status: "cancelled", updated_at: { gte: periodStart, lt: periodEnd } } }),
    prisma.document.count({ where: { created_at: { gte: periodStart, lt: periodEnd }, company: EXCLUDE_INTERNAL_WHERE } }),
    prisma.invoice.count({ where: { created_at: { gte: periodStart, lt: periodEnd }, company: EXCLUDE_INTERNAL_WHERE } }),
    prisma.exportLog.count({ where: { created_at: { gte: periodStart, lt: periodEnd }, company: EXCLUDE_INTERNAL_WHERE } }),
    // Billing metrics: always from PaymentRecord (confirmed Stripe events),
    // always excluding beta/internal — never client-count × list-price.
    prisma.paymentRecord.aggregate({
      where: { status: "paid", paid_at: { gte: periodStart, lt: periodEnd }, company: EXCLUDE_NON_REVENUE_WHERE },
      _sum: { amount_cents: true },
    }),
    prisma.paymentRecord.count({
      where: { status: "failed", failed_at: { gte: periodStart, lt: periodEnd }, company: EXCLUDE_NON_REVENUE_WHERE },
    }),
    prisma.subscription.count({
      where: { trial_end: { gte: periodStart, lt: periodEnd }, company: EXCLUDE_NON_REVENUE_WHERE },
    }),
    // "Clientes que empezaron a pagar este mes" = whose first-ever paid
    // invoice landed in this period — not just any payment in the period.
    prisma.paymentRecord.groupBy({
      by: ["company_id"],
      where: { status: "paid", company: EXCLUDE_NON_REVENUE_WHERE },
      _min: { paid_at: true },
    }),
  ]);

  const startedPayingCount = firstPayments.filter(
    (f) => f._min.paid_at && f._min.paid_at >= periodStart && f._min.paid_at < periodEnd,
  ).length;

  let snapshot: { activeCompanies: number; payingCustomers: number; betaCompanies: number; mrrCents: number } | null = null;
  if (isCurrentMonth) {
    const companies = await prisma.company.findMany({
      where: EXCLUDE_INTERNAL_WHERE,
      select: { id: true, company_type: true, is_beta: true },
    });
    const subscriptionMap = await getLatestSubscriptionMap(companies.map((c) => c.id));
    let activeCompanies = 0;
    let payingCustomers = 0;
    let betaCompanies = 0;
    let mrrCents = 0;
    const nowTime = Date.now();
    for (const company of companies) {
      const subscription = subscriptionMap.get(company.id) ?? null;
      const label = getPaymentStatusLabel(company, subscription);
      if (label === "Activa" || label === "Beta") activeCompanies++;
      if (label === "Activa") payingCustomers++;
      if (label === "Beta") betaCompanies++;
      if (subscription) {
        mrrCents += mrrContributionCents(
          {
            isBeta: company.is_beta,
            status: subscription.status,
            trialEnd: subscription.trial_end,
            unitAmountCents: subscription.unit_amount_cents,
          },
          new Date(nowTime),
        );
      }
    }
    snapshot = { activeCompanies, payingCustomers, betaCompanies, mrrCents };
  }

  return NextResponse.json({
    period: { year, month, label: periodStart.toLocaleString("es-ES", { month: "long", year: "numeric", timeZone: "UTC" }) },
    isCurrentMonth,
    flow: {
      newCompanies,
      cancellations,
      documentsProcessed,
      invoicesProcessed,
      exportsPerformed,
      startedPayingCount,
      trialsEnded,
      totalPaidCents: paidAgg._sum.amount_cents ?? 0,
      paymentsFailed: failedPayments,
    },
    snapshot,
  });
}
