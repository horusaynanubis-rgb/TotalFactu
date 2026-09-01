import { prisma } from "@/lib/prisma";

// Central billing resolver for Admin Control (plan section 4 — "fuente de
// verdad"). Two different origins feed this, documented per-field below:
//
//   - Subscription.* (plan, status, trial/period dates, price, failure
//     count): a DB MIRROR kept in sync by the Stripe webhook
//     (app/api/webhooks/stripe/route.ts). Never calls Stripe directly — if a
//     webhook delivery is ever missed, these fields go stale until the next
//     one arrives. This was the root cause of the frozen "próximo cobro"
//     bug; the webhook fix (extractSubscriptionPeriod et al. in
//     lib/stripe-helpers.ts) keeps this mirror current going forward, but it
//     is still a mirror, not a live Stripe read.
//   - PaymentRecord.* (last payment, total paid, months paid, failures):
//     authoritative DB history, but only complete from the moment
//     PaymentRecord started being written (see the migration in
//     prisma/migrations/add_payment_records_and_billing_fields.sql) —
//     invoices from before that are not backfilled automatically. See
//     scripts/backfill-payment-records.ts to pull historical invoices from
//     Stripe once, manually, with real Stripe keys.
export interface BillingStatus {
  plan: string;
  subscriptionStatus: string;
  trialStart: Date | null;
  trialEnd: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  nextPaymentDate: Date | null;
  lastPaymentDate: Date | null;
  lastPaymentAmountCents: number | null;
  totalPaidCents: number;
  monthsPaid: number;
  currency: string;
  pastDue: boolean;
  unpaid: boolean;
  canceled: boolean;
  cancelAtPeriodEnd: boolean;
  paymentFailures: number;
  daysUntilTrialEnd: number | null;
  daysOverdue: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  dataSource: {
    periodDates: "stripe-webhook-sync" | "license-pack-sync";
    payments: "db-payment-records";
  };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PaymentRecordLike {
  status: string;
  amount_cents: number;
  paid_at: Date | null;
  failed_at: Date | null;
}

/**
 * Pure aggregation over a company's PaymentRecord rows — factored out of
 * getBillingStatus so it's testable without a database (see
 * scripts/test-billing.ts).
 *
 * Deliberately does NOT trust the caller's array order to find the "last"
 * payment — it finds the max paid_at itself. An earlier version assumed
 * `payments[0]` was newest (relying on the caller's `orderBy: created_at
 * desc`), which is only true when rows are inserted in real time by the
 * webhook. A one-off historical backfill (scripts/backfill-payment-records.ts)
 * inserts several rows in one loop — DB insertion order there has no
 * relationship to invoice chronology, e.g. BYOU's trial-closing $0 invoice
 * (paid_at 2026-05-28) got created_at-ordered ahead of its real 14.99€
 * payment from 2026-08-27, making "último pago" show the wrong one. Fixed by
 * computing max(paid_at) directly instead of trusting row order.
 */
export function summarizePayments(payments: PaymentRecordLike[]) {
  const paidPayments = payments.filter((p) => p.status === "paid");
  const failedPayments = payments.filter((p) => p.status === "failed");
  const lastPaid = paidPayments.reduce<PaymentRecordLike | null>((latest, p) => {
    if (!p.paid_at) return latest;
    if (!latest || !latest.paid_at || p.paid_at.getTime() > latest.paid_at.getTime()) return p;
    return latest;
  }, null);
  const totalPaidCents = paidPayments.reduce((sum, p) => sum + p.amount_cents, 0);
  return {
    totalPaidCents,
    monthsPaid: paidPayments.length,
    lastPaymentDate: lastPaid?.paid_at ?? null,
    lastPaymentAmountCents: lastPaid?.amount_cents ?? null,
    paymentFailures: failedPayments.length,
  };
}

export interface MrrEligibilityInput {
  isBeta: boolean;
  status: string;
  trialEnd: Date | null;
  unitAmountCents: number | null;
}

/**
 * Cents a single subscription contributes to MRR right now — 0 for beta
 * companies (plan section 19, "beta excluido de MRR"), non-active
 * subscriptions, or subscriptions still inside their trial window (Stripe
 * maps 'trialing' to our internal 'active' status, so trial_end is the only
 * signal that distinguishes "active and paying" from "active but trialing").
 * Shared by the overview and reports endpoints so MRR is computed exactly
 * one way.
 */
export function mrrContributionCents(input: MrrEligibilityInput, now: Date = new Date()): number {
  if (input.isBeta) return 0;
  if (input.status !== "active") return 0;
  if (input.trialEnd && input.trialEnd.getTime() > now.getTime()) return 0;
  return input.unitAmountCents ?? 0;
}

export async function getBillingStatus(companyId: string): Promise<BillingStatus | null> {
  const subscription = await prisma.subscription.findFirst({
    where: { company_id: companyId },
    orderBy: { created_at: "desc" },
  });
  if (!subscription) return null;

  // Order doesn't affect correctness anymore (summarizePayments computes
  // max(paid_at) itself), but period_end desc keeps this query's result set
  // meaningfully ordered for any future direct consumer.
  const payments = await prisma.paymentRecord.findMany({
    where: { company_id: companyId },
    orderBy: [{ period_end: { sort: "desc", nulls: "last" } }, { created_at: "desc" }],
  });

  const { totalPaidCents, monthsPaid, lastPaymentDate, lastPaymentAmountCents, paymentFailures } =
    summarizePayments(payments);

  // Gestoria plans leave Subscription.current_period_end null by design —
  // LicensePack.period_end is the source of truth there (see
  // app/api/stripe/checkout/route.ts). Fall back to it so "próximo cobro"
  // isn't blank for gestorías; costs one extra query, only for this plan.
  let effectivePeriodEnd = subscription.current_period_end;
  let periodDatesSource: "stripe-webhook-sync" | "license-pack-sync" = "stripe-webhook-sync";
  if (!effectivePeriodEnd && subscription.plan_name === "gestoria") {
    const pack = await prisma.licensePack.findFirst({
      where: { gestoria_company_id: companyId, status: "active" },
      orderBy: { created_at: "desc" },
      select: { period_end: true },
    });
    if (pack?.period_end) {
      effectivePeriodEnd = pack.period_end;
      periodDatesSource = "license-pack-sync";
    }
  }

  const now = new Date();
  const pastDue = subscription.status === "past_due";
  const canceled = subscription.status === "cancelled";
  // Our internal status collapses Stripe's raw 'past_due' and 'unpaid' into
  // the same 'past_due' string (see statusMap in the webhook) — a nonzero
  // payment_failure_count while past_due is the closest signal we persist
  // for "genuinely unpaid" vs. "one bounced attempt, may still recover".
  const unpaid = pastDue && subscription.payment_failure_count >= 2;

  const nextPaymentDate =
    subscription.status === "active" && !subscription.cancel_at_period_end
      ? effectivePeriodEnd
      : null;

  const daysUntilTrialEnd = subscription.trial_end
    ? Math.ceil((subscription.trial_end.getTime() - now.getTime()) / MS_PER_DAY)
    : null;

  const daysOverdue =
    effectivePeriodEnd &&
    effectivePeriodEnd.getTime() < now.getTime() &&
    subscription.status === "active"
      ? Math.floor((now.getTime() - effectivePeriodEnd.getTime()) / MS_PER_DAY)
      : null;

  return {
    plan: subscription.plan_name,
    subscriptionStatus: subscription.status,
    trialStart: subscription.trial_start,
    trialEnd: subscription.trial_end,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: effectivePeriodEnd,
    nextPaymentDate,
    lastPaymentDate,
    lastPaymentAmountCents,
    totalPaidCents,
    monthsPaid,
    currency: subscription.currency,
    pastDue,
    unpaid,
    canceled,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    paymentFailures,
    daysUntilTrialEnd,
    daysOverdue,
    stripeCustomerId: subscription.stripe_customer_id,
    stripeSubscriptionId: subscription.stripe_subscription_id,
    dataSource: {
      periodDates: periodDatesSource,
      payments: "db-payment-records",
    },
  };
}

export type BillingStatusLabel =
  | "En prueba"
  | "Cobro próximo"
  | "Activa / pagada"
  | "Pago pendiente"
  | "Impagada"
  | "Cancelada"
  | "Sin suscripción";

/**
 * Richer, trial-aware status for the company detail page (plan section 3).
 * Distinct from getPaymentStatusLabel in company-classification.ts, which
 * stays intentionally coarse for the companies list/overview KPIs — this one
 * adds the trial/upcoming-payment states that only make sense once you're
 * looking at a single company's timeline.
 */
export function getBillingStatusLabel(billing: BillingStatus): BillingStatusLabel {
  return computeBillingRowStatus({
    status: billing.subscriptionStatus,
    trial_end: billing.trialEnd,
    cancel_at_period_end: billing.cancelAtPeriodEnd,
    payment_failure_count: billing.unpaid ? 2 : billing.pastDue ? 1 : 0,
    current_period_end: billing.currentPeriodEnd,
  }).label;
}

export interface BillingRowInput {
  status: string;
  trial_end: Date | null;
  cancel_at_period_end: boolean;
  payment_failure_count: number;
  current_period_end: Date | null;
}

/**
 * Bulk-safe variant of the same status logic — used by the companies list
 * (lib/admin/company-metrics.ts) and Admin Control overview, which fetch
 * many Subscription rows at once and can't afford an N+1 getBillingStatus()
 * call (that one also pulls PaymentRecord history) per row.
 */
export function computeBillingRowStatus(sub: BillingRowInput): { label: BillingStatusLabel; nextPaymentDate: Date | null } {
  const canceled = sub.status === "cancelled";
  const pastDue = sub.status === "past_due";
  const unpaid = pastDue && sub.payment_failure_count >= 2;
  const nextPaymentDate = sub.status === "active" && !sub.cancel_at_period_end ? sub.current_period_end : null;

  if (canceled) return { label: "Cancelada", nextPaymentDate };
  if (unpaid) return { label: "Impagada", nextPaymentDate };
  if (pastDue) return { label: "Pago pendiente", nextPaymentDate };
  const now = Date.now();
  if (sub.trial_end && sub.trial_end.getTime() > now) return { label: "En prueba", nextPaymentDate };
  if (nextPaymentDate) {
    const daysToPay = Math.ceil((nextPaymentDate.getTime() - now) / MS_PER_DAY);
    if (daysToPay >= 0 && daysToPay <= 7) return { label: "Cobro próximo", nextPaymentDate };
  }
  if (sub.status === "active") return { label: "Activa / pagada", nextPaymentDate };
  return { label: "Sin suscripción", nextPaymentDate };
}
