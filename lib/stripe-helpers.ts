export function getStripeKeys() {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  };
}

export function isStripeConfigured(): boolean {
  const { secretKey, publishableKey } = getStripeKeys();
  if (!secretKey || !publishableKey) return false;
  // Reject placeholder values
  if (secretKey.includes('placeholder') || publishableKey.includes('placeholder')) return false;
  // Must look like a real Stripe key
  if (!secretKey.startsWith('sk_')) return false;
  return true;
}

export const SUBSCRIPTION_PLANS = {
  demo: {
    name: 'Demo',
    price: 0,
    currency: 'EUR',
    interval: 'month',
    features: [
      'Up to 5 invoices total',
      'Basic AI extraction',
      'Monthly CSV export',
      'Email support',
      '1 user',
    ],
  },
  profesional: {
    name: 'Profesional',
    price: 14.99,
    currency: 'EUR',
    interval: 'month',
    stripePriceId: process.env.STRIPE_PRICE_PROFESIONAL || '',
    features: [
      'Unlimited invoices',
      'Advanced AI extraction',
      'Monthly & Quarterly exports',
      'Priority email support',
      '1 user',
      'Telegram & Email integration',
    ],
  },
};

// Pack sizes must match the values defined in billing/page.tsx GESTORIA_PACKS array
export const GESTORIA_PACKS = {
  10: { name: 'Pack Básico',      price: 89,  stripePriceId: process.env.STRIPE_PRICE_GESTORIA_10 || '' },
  20: { name: 'Pack Profesional', price: 159, stripePriceId: process.env.STRIPE_PRICE_GESTORIA_20 || '' },
  50: { name: 'Pack Business',    price: 349, stripePriceId: process.env.STRIPE_PRICE_GESTORIA_50 || '' },
};

// ─── Stripe payload shape helpers ──────────────────────────────────────────
//
// Stripe's "Basil" API revision (2025-03-31+, matches the installed `stripe`
// npm SDK ^22) moved several fields that used to live on the top-level
// Subscription/Invoice objects:
//   - current_period_start/end  → subscription.items.data[].current_period_start/end
//   - invoice.subscription      → invoice.parent.subscription_details.subscription
//   - invoice.payment_intent    → invoice.payments (Invoice Payments API)
//
// A webhook endpoint's payload shape is fixed by whichever API version it
// was configured with in the Stripe Dashboard at creation time — completely
// independent of the `apiVersion` passed when constructing the SDK client in
// this codebase. That mismatch is the confirmed root cause of the frozen
// "próximo cobro" dates on BYOU/Eliteclub/GASCON: the old top-level fields
// silently stopped being present, `new Date(undefined * 1000)` produced an
// Invalid Date, and Prisma's write threw — caught by the webhook's top-level
// try/catch and swallowed as a 200 response (see route.ts).
//
// These helpers read every field defensively across both shapes so a future
// API version bump degrades gracefully (skips the write, logs a warning)
// instead of silently corrupting sync again.

function toDateFromUnix(value: unknown): Date | null {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value * 1000) : null;
}

export function extractSubscriptionPeriod(sub: any): { periodStart: Date | null; periodEnd: Date | null } {
  const item = sub?.items?.data?.[0];
  return {
    periodStart: toDateFromUnix(sub?.current_period_start ?? item?.current_period_start),
    periodEnd: toDateFromUnix(sub?.current_period_end ?? item?.current_period_end),
  };
}

export function extractSubscriptionTrial(sub: any): { trialStart: Date | null; trialEnd: Date | null } {
  return {
    trialStart: toDateFromUnix(sub?.trial_start),
    trialEnd: toDateFromUnix(sub?.trial_end),
  };
}

export function extractSubscriptionPrice(sub: any): { unitAmountCents: number | null; currency: string } {
  const item = sub?.items?.data?.[0];
  const price = item?.price ?? sub?.plan ?? null;
  const unitAmountCents = typeof price?.unit_amount === 'number' ? price.unit_amount : null;
  const currency = String(price?.currency ?? sub?.currency ?? 'eur').toUpperCase();
  return { unitAmountCents, currency };
}

/** invoice.parent.subscription_details.subscription (new) vs invoice.subscription (old). */
export function extractInvoiceSubscriptionId(invoice: any): string | null {
  const subRef = invoice?.parent?.subscription_details?.subscription ?? invoice?.subscription;
  return typeof subRef === 'string' ? subRef : subRef?.id ?? null;
}

/** invoice.payment_intent (old) vs the Invoice Payments API (new). */
export function extractInvoicePaymentIntentId(invoice: any): string | null {
  const direct = invoice?.payment_intent;
  if (typeof direct === 'string') return direct;
  if (direct?.id) return direct.id;
  const viaPayments = invoice?.payments?.data?.[0]?.payment?.payment_intent;
  return typeof viaPayments === 'string' ? viaPayments : viaPayments?.id ?? null;
}

/** invoice.period_start/end (old) vs invoice.lines.data[0].period (new). */
export function extractInvoicePeriod(invoice: any): { periodStart: Date | null; periodEnd: Date | null } {
  const line = invoice?.lines?.data?.[0];
  return {
    periodStart: toDateFromUnix(invoice?.period_start ?? line?.period?.start),
    periodEnd: toDateFromUnix(invoice?.period_end ?? line?.period?.end),
  };
}
