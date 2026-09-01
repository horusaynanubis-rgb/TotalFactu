import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/admin/platform-admin";
import { prisma } from "@/lib/prisma";
import {
  EXCLUDE_INTERNAL_WHERE,
  EXCLUDE_NON_REVENUE_WHERE,
  getGroupCompanyIds,
  getLatestSubscriptionMap,
} from "@/lib/admin/company-metrics";
import { classifyCompanyBucket, getPaymentStatusLabel, CompanyBucket } from "@/lib/admin/company-classification";
import { mrrContributionCents } from "@/lib/admin/billing-status";

export const dynamic = "force-dynamic";

const MONTHS_BACK = 12;

function monthKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function lastNMonthKeys(n: number): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(monthKey(d));
  }
  return keys;
}

// GET /api/admin/overview — KPI cards + chart series for the Admin Control
// dashboard home. Platform-admin only (see lib/admin/platform-admin.ts +
// middleware.ts). Read-only, no Stripe calls — Subscription is already
// synced locally by app/api/webhooks/stripe/route.ts.
export async function GET(_request: NextRequest) {
  const admin = await requirePlatformAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const twelveMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS_BACK - 1), 1));

  const [
    companies,
    groupCompanyIds,
    newCompaniesWindow,
    documentsWindow,
    invoicesWindow,
    documentsThisMonth,
    invoicesThisMonth,
    paidThisMonthAgg,
    paidThisYearAgg,
    paidAllTimeAgg,
    failedThisMonthCount,
    revenueWindow,
  ] = await Promise.all([
    prisma.company.findMany({
      where: EXCLUDE_INTERNAL_WHERE,
      select: { id: true, company_type: true, is_beta: true, created_at: true },
    }),
    getGroupCompanyIds(),
    prisma.company.findMany({
      where: { ...EXCLUDE_INTERNAL_WHERE, created_at: { gte: twelveMonthsAgo } },
      select: { created_at: true },
    }),
    prisma.document.findMany({
      where: { created_at: { gte: twelveMonthsAgo }, company: EXCLUDE_INTERNAL_WHERE },
      select: { created_at: true },
    }),
    prisma.invoice.findMany({
      where: { created_at: { gte: twelveMonthsAgo }, company: EXCLUDE_INTERNAL_WHERE },
      select: { created_at: true },
    }),
    prisma.document.count({ where: { created_at: { gte: startOfMonth }, company: EXCLUDE_INTERNAL_WHERE } }),
    prisma.invoice.count({ where: { created_at: { gte: startOfMonth }, company: EXCLUDE_INTERNAL_WHERE } }),
    // Revenue KPIs always use EXCLUDE_NON_REVENUE_WHERE (excludes beta too,
    // not just internal) — see plan section 19, "beta excluido de MRR" /
    // "demo excluida de ingresos". Amounts come only from PaymentRecord rows
    // written by confirmed Stripe invoice.paid/invoice.payment_failed
    // events — never client-count × list-price.
    prisma.paymentRecord.aggregate({
      where: { status: "paid", paid_at: { gte: startOfMonth }, company: EXCLUDE_NON_REVENUE_WHERE },
      _sum: { amount_cents: true },
    }),
    prisma.paymentRecord.aggregate({
      where: { status: "paid", paid_at: { gte: startOfYear }, company: EXCLUDE_NON_REVENUE_WHERE },
      _sum: { amount_cents: true },
    }),
    prisma.paymentRecord.aggregate({
      where: { status: "paid", company: EXCLUDE_NON_REVENUE_WHERE },
      _sum: { amount_cents: true },
    }),
    prisma.paymentRecord.count({
      where: { status: "failed", failed_at: { gte: startOfMonth }, company: EXCLUDE_NON_REVENUE_WHERE },
    }),
    prisma.paymentRecord.findMany({
      where: { status: "paid", paid_at: { gte: twelveMonthsAgo }, company: EXCLUDE_NON_REVENUE_WHERE },
      select: { amount_cents: true, paid_at: true },
    }),
  ]);

  const subscriptionMap = await getLatestSubscriptionMap(companies.map((c) => c.id));

  const distribution: Record<CompanyBucket, number> = { interna: 0, beta: 0, gestoria: 0, grupo: 0, pago: 0 };
  let activeCompanies = 0;
  let payingCustomers = 0;
  let incidentSubscriptions = 0;
  let newThisMonth = 0;
  let mrrCents = 0;
  let trialCount = 0;

  for (const company of companies) {
    const bucket = classifyCompanyBucket(company, groupCompanyIds.has(company.id));
    distribution[bucket]++;
    const subscription = subscriptionMap.get(company.id) ?? null;
    const label = getPaymentStatusLabel(company, subscription);
    if (label === "Activa" || label === "Beta") activeCompanies++;
    if (label === "Activa") payingCustomers++;
    if (label === "Pago pendiente") incidentSubscriptions++;
    if (company.created_at >= startOfMonth) newThisMonth++;

    if (!company.is_beta && subscription) {
      const stillInTrial = subscription.trial_end ? subscription.trial_end.getTime() > now.getTime() : false;
      if (subscription.status === "active" && stillInTrial) trialCount++;
      mrrCents += mrrContributionCents(
        {
          isBeta: company.is_beta,
          status: subscription.status,
          trialEnd: subscription.trial_end,
          unitAmountCents: subscription.unit_amount_cents,
        },
        now,
      );
    }
  }

  const revenueByMonthMap = new Map(lastNMonthKeys(MONTHS_BACK).map((k) => [k, 0]));
  for (const p of revenueWindow) {
    if (!p.paid_at) continue;
    const k = monthKey(p.paid_at);
    if (revenueByMonthMap.has(k)) revenueByMonthMap.set(k, revenueByMonthMap.get(k)! + p.amount_cents);
  }

  const monthKeys = lastNMonthKeys(MONTHS_BACK);
  const newCompaniesByMonth = new Map(monthKeys.map((k) => [k, 0]));
  for (const c of newCompaniesWindow) {
    const k = monthKey(c.created_at);
    if (newCompaniesByMonth.has(k)) newCompaniesByMonth.set(k, newCompaniesByMonth.get(k)! + 1);
  }

  const documentsByMonth = new Map(monthKeys.map((k) => [k, 0]));
  for (const d of documentsWindow) {
    const k = monthKey(d.created_at);
    if (documentsByMonth.has(k)) documentsByMonth.set(k, documentsByMonth.get(k)! + 1);
  }
  const invoicesByMonth = new Map(monthKeys.map((k) => [k, 0]));
  for (const inv of invoicesWindow) {
    const k = monthKey(inv.created_at);
    if (invoicesByMonth.has(k)) invoicesByMonth.set(k, invoicesByMonth.get(k)! + 1);
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    kpis: {
      totalCompanies: companies.length,
      activeCompanies,
      newThisMonth,
      payingCustomers,
      betaCount: distribution.beta,
      internalCount: distribution.interna, // always 0 here — EXCLUDE_INTERNAL_WHERE — kept for shape clarity
      incidentSubscriptions,
      documentsThisMonth,
      invoicesThisMonth,
      // Revenue KPIs — all from confirmed PaymentRecord rows, never
      // client-count × list-price (plan section 7).
      totalPaidThisMonthCents: paidThisMonthAgg._sum.amount_cents ?? 0,
      totalPaidThisYearCents: paidThisYearAgg._sum.amount_cents ?? 0,
      totalPaidAllTimeCents: paidAllTimeAgg._sum.amount_cents ?? 0,
      mrrCents,
      trialCount,
      paymentsFailedThisMonth: failedThisMonthCount,
    },
    charts: {
      newCompaniesByMonth: monthKeys.map((k) => ({ month: k, count: newCompaniesByMonth.get(k)! })),
      documentsInvoicesByMonth: monthKeys.map((k) => ({
        month: k,
        documents: documentsByMonth.get(k)!,
        invoices: invoicesByMonth.get(k)!,
      })),
      revenueByMonth: monthKeys.map((k) => ({ month: k, amountCents: revenueByMonthMap.get(k)! })),
      distribution: (Object.keys(distribution) as CompanyBucket[])
        .filter((b) => b !== "interna")
        .map((bucket) => ({ bucket, count: distribution[bucket] })),
    },
  });
}
