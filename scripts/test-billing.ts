/**
 * Tests for the billing sync fix and resolver — no real database or Stripe
 * connection needed, matching the style of scripts/test-stuck-documents.ts.
 * Run with: npx tsx scripts/test-billing.ts
 *
 * Covers plan section 18:
 *   - cliente en trial / trial expirado
 *   - cálculo de "próximo cobro" (Stripe API v22 shape support)
 *   - cálculo totalPaid / meses pagados (summarizePayments)
 *   - beta excluido de MRR / demo excluida de ingresos (mrrContributionCents)
 *   - estados past_due / unpaid / cancelación / cobro próximo
 *
 * Webhook duplicate handling (upsert by stripe_invoice_id) and the
 * invoice.paid/invoice.payment_failed DB writes themselves are Prisma calls
 * against the real `Subscription`/`PaymentRecord` tables — not covered here
 * (this repo's test scripts don't mock Prisma), see the "cómo probar"
 * section of the diagnosis for how to exercise those against a real/staging
 * database with the Stripe CLI (`stripe trigger invoice.paid`, twice, to
 * confirm the second delivery doesn't double the total).
 */
import {
  extractSubscriptionPeriod,
  extractSubscriptionTrial,
  extractSubscriptionPrice,
  extractInvoiceSubscriptionId,
  extractInvoicePaymentIntentId,
  extractInvoicePeriod,
} from '../lib/stripe-helpers';
import {
  computeBillingRowStatus,
  summarizePayments,
  mrrContributionCents,
  PaymentRecordLike,
} from '../lib/admin/billing-status';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

const DAY = 24 * 60 * 60 * 1000;
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

async function run() {
  console.log('\n=== Stripe payload shape extraction (pre/post "Basil" API) ===\n');
  {
    const periodStart = new Date('2026-05-28T09:00:00Z');
    const periodEnd = new Date('2026-06-27T09:00:00Z');

    const oldShapeSub = { current_period_start: unix(periodStart), current_period_end: unix(periodEnd) };
    const r1 = extractSubscriptionPeriod(oldShapeSub);
    assert(r1.periodStart?.getTime() === periodStart.getTime(), 'extractSubscriptionPeriod: old top-level shape — periodStart');
    assert(r1.periodEnd?.getTime() === periodEnd.getTime(), 'extractSubscriptionPeriod: old top-level shape — periodEnd');

    const newShapeSub = { items: { data: [{ current_period_start: unix(periodStart), current_period_end: unix(periodEnd) }] } };
    const r2 = extractSubscriptionPeriod(newShapeSub);
    assert(r2.periodStart?.getTime() === periodStart.getTime(), 'extractSubscriptionPeriod: new items[0] shape — periodStart (this is the BYOU/Eliteclub/GASCON fix)');
    assert(r2.periodEnd?.getTime() === periodEnd.getTime(), 'extractSubscriptionPeriod: new items[0] shape — periodEnd');

    const brokenSub = {};
    const r3 = extractSubscriptionPeriod(brokenSub);
    assert(r3.periodStart === null && r3.periodEnd === null, 'extractSubscriptionPeriod: unknown shape degrades to null, not Invalid Date/throw');
  }

  {
    const trialEnd = new Date('2026-06-19T00:00:00Z');
    const r = extractSubscriptionTrial({ trial_start: null, trial_end: unix(trialEnd) });
    assert(r.trialStart === null, 'extractSubscriptionTrial: null trial_start stays null');
    assert(r.trialEnd?.getTime() === trialEnd.getTime(), 'extractSubscriptionTrial: trial_end parsed');
  }

  {
    const r1 = extractSubscriptionPrice({ items: { data: [{ price: { unit_amount: 1499, currency: 'eur' } }] } });
    assert(r1.unitAmountCents === 1499 && r1.currency === 'EUR', 'extractSubscriptionPrice: from items[0].price');
    const r2 = extractSubscriptionPrice({});
    assert(r2.unitAmountCents === null && r2.currency === 'EUR', 'extractSubscriptionPrice: missing price falls back to null/EUR default');
  }

  {
    const oldInvoice = { subscription: 'sub_old123' };
    assert(extractInvoiceSubscriptionId(oldInvoice) === 'sub_old123', 'extractInvoiceSubscriptionId: old top-level invoice.subscription');
    const newInvoice = { parent: { subscription_details: { subscription: 'sub_new456' } } };
    assert(extractInvoiceSubscriptionId(newInvoice) === 'sub_new456', 'extractInvoiceSubscriptionId: new invoice.parent.subscription_details.subscription');
    assert(extractInvoiceSubscriptionId({}) === null, 'extractInvoiceSubscriptionId: missing reference returns null, not throw');
  }

  {
    const oldInvoice = { payment_intent: 'pi_old' };
    assert(extractInvoicePaymentIntentId(oldInvoice) === 'pi_old', 'extractInvoicePaymentIntentId: old top-level string');
    const newInvoice = { payments: { data: [{ payment: { payment_intent: 'pi_new' } }] } };
    assert(extractInvoicePaymentIntentId(newInvoice) === 'pi_new', 'extractInvoicePaymentIntentId: new Invoice Payments API shape');
  }

  {
    const periodStart = new Date('2026-08-01T00:00:00Z');
    const periodEnd = new Date('2026-08-31T00:00:00Z');
    const oldInvoice = { period_start: unix(periodStart), period_end: unix(periodEnd) };
    const r1 = extractInvoicePeriod(oldInvoice);
    assert(r1.periodStart?.getTime() === periodStart.getTime(), 'extractInvoicePeriod: old top-level period');
    const newInvoice = { lines: { data: [{ period: { start: unix(periodStart), end: unix(periodEnd) } }] } };
    const r2 = extractInvoicePeriod(newInvoice);
    assert(r2.periodEnd?.getTime() === periodEnd.getTime(), 'extractInvoicePeriod: new lines[0].period shape');
  }

  console.log('\n=== computeBillingRowStatus (Admin Control status/color per plan section 12) ===\n');
  {
    const now = new Date('2026-09-01T00:00:00Z');

    const trialing = computeBillingRowStatus({
      status: 'active', trial_end: new Date('2026-09-15T00:00:00Z'),
      cancel_at_period_end: false, payment_failure_count: 0, current_period_end: new Date('2026-09-15T00:00:00Z'),
    });
    assert(trialing.label === 'En prueba', 'cliente en trial → "En prueba" (azul)');

    const trialExpiredFarNextPayment = computeBillingRowStatus({
      status: 'active', trial_end: new Date('2026-08-01T00:00:00Z'),
      cancel_at_period_end: false, payment_failure_count: 0, current_period_end: new Date('2026-10-01T00:00:00Z'),
    });
    assert(trialExpiredFarNextPayment.label === 'Activa / pagada', 'trial expirado, próximo cobro lejano → "Activa / pagada" (verde)');

    const upcomingCharge = computeBillingRowStatus({
      status: 'active', trial_end: null,
      cancel_at_period_end: false, payment_failure_count: 0, current_period_end: new Date(now.getTime() + 3 * DAY),
    });
    assert(upcomingCharge.label === 'Cobro próximo', 'cobro en 3 días → "Cobro próximo" (amarillo)');

    const oneBouncedAttempt = computeBillingRowStatus({
      status: 'past_due', trial_end: null,
      cancel_at_period_end: false, payment_failure_count: 1, current_period_end: new Date('2026-08-27T00:00:00Z'),
    });
    assert(oneBouncedAttempt.label === 'Pago pendiente', 'past_due con 1 fallo → "Pago pendiente" (rojo, no aún "Impagada")');

    const genuinelyUnpaid = computeBillingRowStatus({
      status: 'past_due', trial_end: null,
      cancel_at_period_end: false, payment_failure_count: 3, current_period_end: new Date('2026-08-27T00:00:00Z'),
    });
    assert(genuinelyUnpaid.label === 'Impagada', 'past_due con ≥2 fallos → "Impagada" (rojo)');

    const canceled = computeBillingRowStatus({
      status: 'cancelled', trial_end: null,
      cancel_at_period_end: false, payment_failure_count: 0, current_period_end: null,
    });
    assert(canceled.label === 'Cancelada', 'cancelación → "Cancelada" (gris)');

    const noSub = computeBillingRowStatus({
      status: 'inactive', trial_end: null,
      cancel_at_period_end: false, payment_failure_count: 0, current_period_end: null,
    });
    assert(noSub.label === 'Sin suscripción', 'sin suscripción activa → "Sin suscripción"');
  }

  console.log('\n=== summarizePayments (totalPaid / meses pagados / último pago) ===\n');
  {
    const payments: PaymentRecordLike[] = [
      { status: 'paid', amount_cents: 1499, paid_at: new Date('2026-08-27'), failed_at: null },
      { status: 'failed', amount_cents: 1499, paid_at: null, failed_at: new Date('2026-07-27') },
      { status: 'paid', amount_cents: 1499, paid_at: new Date('2026-07-27'), failed_at: null },
      { status: 'paid', amount_cents: 1499, paid_at: new Date('2026-06-27'), failed_at: null },
    ];
    const summary = summarizePayments(payments);
    assert(summary.totalPaidCents === 1499 * 3, 'totalPaidCents suma solo los pagos con status=paid');
    assert(summary.monthsPaid === 3, 'monthsPaid cuenta solo pagos exitosos');
    assert(summary.paymentFailures === 1, 'paymentFailures cuenta solo status=failed');
    assert(summary.lastPaymentDate?.getTime() === new Date('2026-08-27').getTime(), 'lastPaymentDate es el paid_at máximo, no el primero del array');
    assert(summary.lastPaymentAmountCents === 1499, 'lastPaymentAmountCents coincide con el último pago');

    // Regression test for the real bug found validating BYOU against live
    // Stripe: scripts/backfill-payment-records.ts inserts historical
    // invoices in a loop, so DB created_at order has no relationship to
    // paid_at chronology. This array is deliberately in $0-oldest-first /
    // real-payment-last order — the exact shape a batch backfill produces —
    // to prove summarizePayments doesn't trust array order.
    const outOfOrderPayments: PaymentRecordLike[] = [
      { status: 'paid', amount_cents: 0, paid_at: new Date('2026-05-28'), failed_at: null }, // trial-closing $0 invoice, inserted "first" chronologically but could land anywhere in the array
      { status: 'paid', amount_cents: 1499, paid_at: new Date('2026-08-27'), failed_at: null }, // the real, most recent payment
      { status: 'paid', amount_cents: 1499, paid_at: new Date('2026-06-27'), failed_at: null },
    ];
    const outOfOrderSummary = summarizePayments(outOfOrderPayments);
    assert(
      outOfOrderSummary.lastPaymentDate?.getTime() === new Date('2026-08-27').getTime(),
      'BYOU regression: con un array desordenado (como produce el backfill), lastPaymentDate sigue siendo el pago más reciente real, no el primero del array',
    );
    assert(outOfOrderSummary.lastPaymentAmountCents === 1499, 'BYOU regression: lastPaymentAmountCents es 14.99€, no el invoice de 0€ de cierre de trial');

    const noPayments = summarizePayments([]);
    assert(noPayments.totalPaidCents === 0 && noPayments.monthsPaid === 0, 'sin pagos → totales en cero, no crash');
  }

  console.log('\n=== mrrContributionCents (beta/demo excluidos de ingresos) ===\n');
  {
    const now = new Date('2026-09-01T00:00:00Z');

    const paidReal = mrrContributionCents({ isBeta: false, status: 'active', trialEnd: null, unitAmountCents: 1499 }, now);
    assert(paidReal === 1499, 'cliente real activo y sin trial suma su unit_amount_cents al MRR');

    const beta = mrrContributionCents({ isBeta: true, status: 'active', trialEnd: null, unitAmountCents: 1499 }, now);
    assert(beta === 0, 'cliente beta NUNCA contribuye a MRR aunque status=active y tenga unit_amount_cents');

    const stillTrialing = mrrContributionCents(
      { isBeta: false, status: 'active', trialEnd: new Date('2026-09-15T00:00:00Z'), unitAmountCents: 1499 }, now,
    );
    assert(stillTrialing === 0, 'cliente en trial (status=active pero trial_end futuro) no cuenta como MRR todavía');

    const canceled = mrrContributionCents({ isBeta: false, status: 'cancelled', trialEnd: null, unitAmountCents: 1499 }, now);
    assert(canceled === 0, 'suscripción cancelada no contribuye a MRR');

    const noPrice = mrrContributionCents({ isBeta: false, status: 'active', trialEnd: null, unitAmountCents: null }, now);
    assert(noPrice === 0, 'sin unit_amount_cents conocido (sync antiguo) contribuye 0, no NaN');
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run();
