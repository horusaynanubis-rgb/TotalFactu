/**
 * ONE-OFF BACKFILL — NOT run as part of this diagnosis (no real Stripe key
 * available in this environment). Pulls each company's historical Stripe
 * invoices into PaymentRecord so "Total pagado" / "Histórico de pagos" isn't
 * empty for subscriptions that existed before the webhook fix in
 * app/api/webhooks/stripe/route.ts started writing PaymentRecord rows going
 * forward (see prisma/migrations/add_payment_records_and_billing_fields.sql).
 *
 * Stripe access is READ-ONLY (invoices.list only) — never modifies, cancels,
 * or charges anything in Stripe. Reuses the same shape-defensive extractors
 * as the webhook (lib/stripe-helpers.ts) so a historical invoice is parsed
 * identically to a live one.
 *
 * Safety, matching scripts/resolve-confirmed-duplicates.ts:
 *   - Dry run by default — prints what it would upsert, writes nothing.
 *   - --confirm required to actually write PaymentRecord rows.
 *   - Upserts by stripe_invoice_id (same unique constraint the webhook
 *     relies on), so running this after the webhook has already recorded
 *     some invoices is safe — no duplicates.
 *   - Only touches PaymentRecord. Never writes to Subscription, Company, or
 *     Stripe itself.
 *
 * Uso:
 *   cd nextjs_space
 *   npx tsx --require dotenv/config scripts/backfill-payment-records.ts                # dry run, all companies with a stripe_customer_id
 *   npx tsx --require dotenv/config scripts/backfill-payment-records.ts --companyId=cmpdsqnow0001l204mmzpqd79   # single company, dry run
 *   npx tsx --require dotenv/config scripts/backfill-payment-records.ts --confirm       # actually write
 */
import { PrismaClient } from '@prisma/client';
import { isStripeConfigured } from '../lib/stripe-helpers';
import {
  extractInvoiceSubscriptionId,
  extractInvoicePaymentIntentId,
  extractInvoicePeriod,
} from '../lib/stripe-helpers';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const onlyCompanyId = arg('companyId');

  if (!isStripeConfigured()) {
    console.error('ERROR: STRIPE_SECRET_KEY is not set or is a placeholder. This script needs real Stripe credentials to list historical invoices — run it from an environment that has them (e.g. Vercel prod / a machine with the real .env), not this local checkout.');
    process.exit(1);
  }

  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' as any });

  const subscriptions = await prisma.subscription.findMany({
    where: {
      stripe_customer_id: { not: null },
      ...(onlyCompanyId ? { company_id: onlyCompanyId } : {}),
    },
    include: { company: { select: { name: true, tax_id: true } } },
  });

  console.log(`\n${confirm ? 'LIVE RUN — writing PaymentRecord rows' : 'DRY RUN — no writes (pass --confirm to write)'}`);
  console.log(`Found ${subscriptions.length} subscription(s) with a stripe_customer_id.\n`);

  let totalFound = 0;
  let totalUpserted = 0;

  for (const sub of subscriptions) {
    console.log(`--- ${sub.company.name} (${sub.company.tax_id}) — customer ${sub.stripe_customer_id} ---`);
    const invoices = await stripe.invoices.list({ customer: sub.stripe_customer_id!, limit: 100 });

    for (const invoice of invoices.data as any[]) {
      if (invoice.status !== 'paid' && invoice.status !== 'uncollectible' && invoice.status !== 'void') continue;
      const status = invoice.status === 'paid' ? 'paid' : 'failed';
      const subscriptionId = extractInvoiceSubscriptionId(invoice) ?? sub.stripe_subscription_id;
      const { periodStart, periodEnd } = extractInvoicePeriod(invoice);
      const paidAtUnix = invoice.status_transitions?.paid_at;

      totalFound++;
      console.log(
        `  invoice ${invoice.id}: status=${invoice.status} amount=${(invoice.amount_paid ?? invoice.amount_due) / 100} ${String(invoice.currency).toUpperCase()} ` +
        `period=[${periodStart?.toISOString().slice(0, 10) ?? '—'} → ${periodEnd?.toISOString().slice(0, 10) ?? '—'}]`
      );

      if (!confirm) continue;

      await prisma.paymentRecord.upsert({
        where: { stripe_invoice_id: invoice.id },
        create: {
          company_id: sub.company_id,
          stripe_invoice_id: invoice.id,
          stripe_payment_intent_id: extractInvoicePaymentIntentId(invoice),
          stripe_subscription_id: subscriptionId,
          amount_cents: status === 'paid' ? (invoice.amount_paid ?? 0) : (invoice.amount_due ?? 0),
          currency: String(invoice.currency ?? 'eur').toUpperCase(),
          status,
          period_start: periodStart,
          period_end: periodEnd,
          paid_at: status === 'paid' ? (typeof paidAtUnix === 'number' ? new Date(paidAtUnix * 1000) : new Date(invoice.created * 1000)) : null,
          failed_at: status === 'failed' ? new Date(invoice.created * 1000) : null,
        },
        update: {}, // already recorded (likely by the live webhook) — don't overwrite
      });
      totalUpserted++;
    }
  }

  console.log(`\n${totalFound} invoice(s) found across ${subscriptions.length} subscription(s).`);
  console.log(confirm ? `${totalUpserted} PaymentRecord row(s) upserted.` : 'Dry run — nothing written. Re-run with --confirm to write.');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
