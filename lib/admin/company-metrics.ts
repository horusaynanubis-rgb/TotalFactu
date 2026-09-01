import { prisma } from "@/lib/prisma";
import { INTERNAL_COMPANY_TYPE } from "./platform-admin";

// Bulk, aggregated queries for the Admin Control overview + companies list —
// each is O(1) queries regardless of company count (see plan section 15,
// "no N+1 queries"). Never call these per-row in a loop.

export interface SubscriptionSummary {
  id: string;
  status: string;
  plan_name: string;
  stripe_customer_id: string | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
  trial_end: Date | null;
  cancel_at_period_end: boolean;
  payment_failure_count: number;
  unit_amount_cents: number | null;
  created_at: Date;
}

/**
 * Latest Subscription per company (a company can accumulate more than one
 * row over its lifetime — e.g. plan changes — but only the most recent one
 * reflects current state). One bulk query, reduced in memory.
 */
export async function getLatestSubscriptionMap(
  companyIds?: string[],
): Promise<Map<string, SubscriptionSummary>> {
  const rows = await prisma.subscription.findMany({
    where: companyIds ? { company_id: { in: companyIds } } : undefined,
    orderBy: { created_at: "desc" },
    select: {
      id: true,
      company_id: true,
      status: true,
      plan_name: true,
      stripe_customer_id: true,
      current_period_start: true,
      current_period_end: true,
      trial_end: true,
      cancel_at_period_end: true,
      payment_failure_count: true,
      unit_amount_cents: true,
      created_at: true,
    },
  });
  const map = new Map<string, SubscriptionSummary>();
  for (const row of rows) {
    if (!map.has(row.company_id)) {
      map.set(row.company_id, {
        id: row.id,
        status: row.status,
        plan_name: row.plan_name,
        stripe_customer_id: row.stripe_customer_id,
        current_period_start: row.current_period_start,
        current_period_end: row.current_period_end,
        trial_end: row.trial_end,
        cancel_at_period_end: row.cancel_at_period_end,
        payment_failure_count: row.payment_failure_count,
        unit_amount_cents: row.unit_amount_cents,
        created_at: row.created_at,
      });
    }
  }
  return map;
}

export interface LastPaymentInfo {
  amountCents: number;
  currency: string;
  paidAt: Date;
}

/** Most recent *paid* PaymentRecord per company — used for the "Último pago" column. */
export async function getLastPaymentMap(companyIds?: string[]): Promise<Map<string, LastPaymentInfo>> {
  const rows = await prisma.paymentRecord.findMany({
    where: { status: "paid", ...(companyIds ? { company_id: { in: companyIds } } : {}) },
    orderBy: { paid_at: "desc" },
    select: { company_id: true, amount_cents: true, currency: true, paid_at: true },
  });
  const map = new Map<string, LastPaymentInfo>();
  for (const row of rows) {
    if (!map.has(row.company_id) && row.paid_at) {
      map.set(row.company_id, { amountCents: row.amount_cents, currency: row.currency, paidAt: row.paid_at });
    }
  }
  return map;
}

export async function getMembershipCountMap(companyIds?: string[]): Promise<Map<string, number>> {
  const rows = await prisma.membership.groupBy({
    by: ["company_id"],
    where: companyIds ? { company_id: { in: companyIds } } : undefined,
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.company_id, r._count._all]));
}

export interface DocumentStats {
  count: number;
  lastUploadAt: Date | null;
}

export async function getDocumentStatsMap(companyIds?: string[]): Promise<Map<string, DocumentStats>> {
  const rows = await prisma.document.groupBy({
    by: ["company_id"],
    where: companyIds ? { company_id: { in: companyIds } } : undefined,
    _count: { _all: true },
    _max: { upload_timestamp: true },
  });
  return new Map(
    rows.map((r) => [r.company_id, { count: r._count._all, lastUploadAt: r._max.upload_timestamp }]),
  );
}

export interface InvoiceStats {
  count: number;
  lastCreatedAt: Date | null;
}

export async function getInvoiceStatsMap(companyIds?: string[]): Promise<Map<string, InvoiceStats>> {
  const rows = await prisma.invoice.groupBy({
    by: ["company_id"],
    where: companyIds ? { company_id: { in: companyIds } } : undefined,
    _count: { _all: true },
    _max: { created_at: true },
  });
  return new Map(rows.map((r) => [r.company_id, { count: r._count._all, lastCreatedAt: r._max.created_at }]));
}

/**
 * Company ids whose owner (any Membership.user_id) also belongs to another
 * company — the same "multi-company owner" concept already used for
 * hasMultipleCompanies in components/dashboard-nav.tsx / Gestión de
 * empresas. Used to classify the "grupo empresarial" bucket without
 * double-counting (see lib/admin/company-classification.ts).
 */
export async function getGroupCompanyIds(): Promise<Set<string>> {
  const memberships = await prisma.membership.findMany({
    select: { user_id: true, company_id: true },
  });
  const companiesByUser = new Map<string, Set<string>>();
  for (const m of memberships) {
    if (!companiesByUser.has(m.user_id)) companiesByUser.set(m.user_id, new Set());
    companiesByUser.get(m.user_id)!.add(m.company_id);
  }
  const groupCompanyIds = new Set<string>();
  for (const companyIds of companiesByUser.values()) {
    if (companyIds.size > 1) {
      for (const id of companyIds) groupCompanyIds.add(id);
    }
  }
  return groupCompanyIds;
}

/** Excludes the internal TotalFactu company from a Company `where` clause. */
export const EXCLUDE_INTERNAL_WHERE = { company_type: { not: INTERNAL_COMPANY_TYPE } };

/**
 * Excludes internal AND beta companies — use this (not EXCLUDE_INTERNAL_WHERE)
 * for anything that touches money: MRR, "total cobrado", revenue charts.
 * Beta accounts have no real billing and must never inflate revenue KPIs
 * (plan section 19 — "beta excluido de MRR").
 */
export const EXCLUDE_NON_REVENUE_WHERE = { company_type: { not: INTERNAL_COMPANY_TYPE }, is_beta: false };
