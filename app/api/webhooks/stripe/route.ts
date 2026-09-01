import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';
import {
  extractSubscriptionPeriod,
  extractSubscriptionTrial,
  extractSubscriptionPrice,
  extractInvoiceSubscriptionId,
  extractInvoicePaymentIntentId,
  extractInvoicePeriod,
} from '@/lib/stripe-helpers';
import { sendPaymentAlertEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

// Stripe requires the raw body for webhook signature verification —
// Next.js must NOT parse it as JSON beforehand.
export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' as any });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    console.error('[stripe/webhook] Signature verification failed:', err.message);
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, stripe);
        break;

      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      // Stripe sends both invoice.payment_succeeded (legacy) and invoice.paid
      // (current) for a successfully collected invoice — handle identically.
      case 'invoice.payment_succeeded':
      case 'invoice.paid':
        await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        break;
    }
  } catch (err: any) {
    console.error(`[stripe/webhook] Error processing ${event.type}:`, err);
    // Return 200 so Stripe doesn't keep retrying for business logic errors
    return NextResponse.json({ error: 'Internal processing error' }, { status: 200 });
  }

  return NextResponse.json({ received: true });
}

// ─── Email confirmation ───────────────────────────────────────────────────────

async function sendConfirmationEmail(to: string, plan: string, packSize?: number) {
  try {
    const subject = plan === 'gestoria'
      ? `TotalFactu — Pack de ${packSize} licencias activado`
      : 'TotalFactu — Plan Profesional activado';
    const text = plan === 'gestoria'
      ? `Tu pack de ${packSize} licencias está activo. Accede a tu portal en https://totalfactu.com/dashboard/gestoria`
      : 'Tu plan Profesional está activo. Ya puedes subir facturas ilimitadas en https://totalfactu.com/dashboard';

    console.log(`[stripe/webhook] Email confirmation — To: ${to} | Subject: ${subject} | ${text}`);
  } catch (err) {
    console.error('[stripe/webhook] Failed to send confirmation email:', err);
  }
}

// ─── checkout.session.completed ──────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, stripe: Stripe) {
  const { metadata, customer, subscription: subscriptionId, customer_email } = session;

  // Prefer metadata.user_email (set when user is logged in); fall back to Stripe customer_email
  const email = metadata?.user_email || customer_email || metadata?.contact_email || '';
  // company_id in metadata lets us activate without an email lookup
  const companyId = metadata?.company_id || undefined;
  const type = metadata?.type;

  console.log(`[stripe/webhook] checkout.session.completed type=${type} email=${email} companyId=${companyId}`);

  if (type === 'plan' && metadata?.plan === 'profesional') {
    await activateProfesionalPlan(email, customer as string, subscriptionId as string, stripe, companyId);
  } else if (type === 'gestoria_pack') {
    const packSize = parseInt(metadata?.pack_size || '0', 10);
    await activateGestoriaPack(email, packSize, customer as string, subscriptionId as string, stripe, companyId);
  } else {
    console.warn('[stripe/webhook] checkout.session.completed: unknown metadata type', metadata);
  }
}

// ─── Resolve company_id from email when not in metadata ──────────────────────

async function resolveCompanyId(email: string, companyId?: string): Promise<string | null> {
  if (companyId) return companyId;
  if (!email) return null;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`[stripe/webhook] resolveCompanyId: no user found for email "${email}"`);
    return null;
  }
  const membership = await prisma.membership.findFirst({ where: { user_id: user.id } });
  if (!membership) {
    console.error(`[stripe/webhook] resolveCompanyId: no membership for user ${user.id}`);
    return null;
  }
  return membership.company_id;
}

// ─── activateProfesionalPlan ──────────────────────────────────────────────────

async function activateProfesionalPlan(
  email: string,
  stripeCustomerId: string,
  stripeSubscriptionId: string,
  stripe: Stripe,
  companyId?: string,
) {
  const resolvedCompanyId = await resolveCompanyId(email, companyId);
  if (!resolvedCompanyId) {
    console.error(`[stripe/webhook] activateProfesionalPlan: could not resolve company (email=${email} companyId=${companyId})`);
    return;
  }

  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  let trialStart: Date | null = null;
  let trialEnd: Date | null = null;
  let unitAmountCents: number | null = null;
  let currency = 'EUR';
  let cancelAtPeriodEnd = false;
  if (stripeSubscriptionId) {
    // Retrieved via the SDK client, which pins apiVersion explicitly (see
    // below) — unlike raw webhook payloads, this always returns the shape
    // matching that pinned version, but the helpers below still guard
    // defensively in case that pin ever changes.
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId) as any;
    ({ periodStart, periodEnd } = extractSubscriptionPeriod(sub));
    ({ trialStart, trialEnd } = extractSubscriptionTrial(sub));
    ({ unitAmountCents, currency } = extractSubscriptionPrice(sub));
    cancelAtPeriodEnd = !!sub.cancel_at_period_end;
  }

  const existing = await prisma.subscription.findFirst({ where: { company_id: resolvedCompanyId } });

  const data = {
    plan_name: 'profesional',
    status: 'active',
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: stripeSubscriptionId,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    trial_start: trialStart,
    trial_end: trialEnd,
    unit_amount_cents: unitAmountCents,
    currency,
    cancel_at_period_end: cancelAtPeriodEnd,
    payment_failure_count: 0,
  };

  if (existing) {
    await prisma.subscription.update({ where: { id: existing.id }, data });
  } else {
    await prisma.subscription.create({ data: { company_id: resolvedCompanyId, ...data } });
  }

  console.log(`[stripe/webhook] Profesional plan activated for company ${resolvedCompanyId}`);
  await sendConfirmationEmail(email, 'profesional');
}

// ─── activateGestoriaPack ─────────────────────────────────────────────────────

async function activateGestoriaPack(
  email: string,
  packSize: number,
  stripeCustomerId: string,
  stripeSubscriptionId: string,
  stripe: Stripe,
  companyId?: string,
) {
  const resolvedCompanyId = await resolveCompanyId(email, companyId);
  if (!resolvedCompanyId) {
    console.error(`[stripe/webhook] activateGestoriaPack: could not resolve company (email=${email} companyId=${companyId})`);
    return;
  }

  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  let trialStart: Date | null = null;
  let trialEnd: Date | null = null;
  let unitAmountCents: number | null = null;
  let currency = 'EUR';
  let cancelAtPeriodEnd = false;
  if (stripeSubscriptionId) {
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId) as any;
    ({ periodStart, periodEnd } = extractSubscriptionPeriod(sub));
    ({ trialStart, trialEnd } = extractSubscriptionTrial(sub));
    ({ unitAmountCents, currency } = extractSubscriptionPrice(sub));
    cancelAtPeriodEnd = !!sub.cancel_at_period_end;
  }

  await prisma.$transaction(async (tx: any) => {
    const pack = await tx.licensePack.create({
      data: {
        gestoria_company_id: resolvedCompanyId,
        pack_size: packSize,
        licenses_used: 0,
        stripe_subscription_id: stripeSubscriptionId,
        status: 'active',
        period_end: periodEnd,
      },
    });

    const licenseData = Array.from({ length: packSize }, () => ({
      pack_id: pack.id,
      status: 'available',
    }));
    await tx.license.createMany({ data: licenseData });

    const subData = {
      plan_name: 'gestoria',
      status: 'active',
      stripe_customer_id: stripeCustomerId,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      trial_start: trialStart,
      trial_end: trialEnd,
      unit_amount_cents: unitAmountCents,
      currency,
      cancel_at_period_end: cancelAtPeriodEnd,
      payment_failure_count: 0,
    };

    const existingSub = await tx.subscription.findFirst({
      where: { company_id: resolvedCompanyId },
    });
    if (existingSub) {
      await tx.subscription.update({ where: { id: existingSub.id }, data: subData });
    } else {
      await tx.subscription.create({ data: { company_id: resolvedCompanyId, ...subData } });
    }
  });

  console.log(`[stripe/webhook] Gestoria pack of ${packSize} licenses activated for company ${resolvedCompanyId}`);
  await sendConfirmationEmail(email, 'gestoria', packSize);
}

// ─── customer.subscription.updated ───────────────────────────────────────────

async function handleSubscriptionUpdated(stripeSubscription: Stripe.Subscription) {
  const statusMap: Record<string, string> = {
    active: 'active',
    past_due: 'past_due',
    canceled: 'cancelled',
    unpaid: 'past_due',
    paused: 'inactive',
    trialing: 'active',
    incomplete: 'inactive',
    incomplete_expired: 'cancelled',
  };
  const internalStatus = statusMap[stripeSubscription.status] || 'inactive';

  const sub = stripeSubscription as any;
  const { periodStart, periodEnd } = extractSubscriptionPeriod(sub);
  const { trialStart, trialEnd } = extractSubscriptionTrial(sub);
  const { unitAmountCents, currency } = extractSubscriptionPrice(sub);

  if (!periodEnd) {
    // Don't let a parsing miss (e.g. a future Stripe API shape change) wipe
    // out a previously-good current_period_end with null — log loudly
    // instead of silently degrading sync again (see stripe-helpers.ts).
    console.error(
      `[stripe/webhook] subscription.updated: could not extract current_period_end for ${stripeSubscription.id} ` +
      `(status=${stripeSubscription.status}) — period fields will be left untouched, only status/trial/price update.`
    );
  }

  const data: Record<string, any> = {
    status: internalStatus,
    trial_start: trialStart,
    trial_end: trialEnd,
    unit_amount_cents: unitAmountCents,
    currency,
    cancel_at_period_end: !!sub.cancel_at_period_end,
  };
  if (periodStart) data.current_period_start = periodStart;
  if (periodEnd) data.current_period_end = periodEnd;
  if (internalStatus === 'active') data.payment_failure_count = 0;

  const updated = await prisma.subscription.updateMany({
    where: { stripe_subscription_id: stripeSubscription.id },
    data,
  });

  await prisma.licensePack.updateMany({
    where: { stripe_subscription_id: stripeSubscription.id },
    data: {
      status: internalStatus === 'active' ? 'active' : 'cancelled',
      ...(periodEnd ? { period_end: periodEnd } : {}),
    },
  });

  if (updated.count === 0) {
    console.warn(`[stripe/webhook] subscription.updated: no subscription found for ${stripeSubscription.id}`);
    return;
  }

  if (internalStatus === 'past_due') {
    // statusMap collapses both raw 'past_due' and 'unpaid' into 'past_due'
    // internally, but the alert type (and its dedup key) keeps them distinct.
    const subscriptionRow = await prisma.subscription.findFirst({
      where: { stripe_subscription_id: stripeSubscription.id },
      include: { company: true },
    });
    if (subscriptionRow) {
      await maybeSendPaymentAlert({
        company: subscriptionRow.company,
        subscription: subscriptionRow,
        alertType: stripeSubscription.status === 'unpaid' ? 'unpaid' : 'past_due',
        stripeInvoiceId: '',
      });
    }
  }
}

// ─── customer.subscription.deleted ───────────────────────────────────────────

async function handleSubscriptionDeleted(stripeSubscription: Stripe.Subscription) {
  await prisma.subscription.updateMany({
    where: { stripe_subscription_id: stripeSubscription.id },
    data: { status: 'cancelled' },
  });

  await prisma.licensePack.updateMany({
    where: { stripe_subscription_id: stripeSubscription.id },
    data: { status: 'cancelled' },
  });

  console.log(`[stripe/webhook] Subscription ${stripeSubscription.id} cancelled`);
}

// ─── customer.subscription.created ───────────────────────────────────────────
// checkout.session.completed handles plan activation; this is a safety-net log.

async function handleSubscriptionCreated(stripeSubscription: Stripe.Subscription) {
  console.log(`[stripe/webhook] customer.subscription.created: ${stripeSubscription.id} status=${stripeSubscription.status}`);
}

// ─── shared: upsert PaymentRecord + payment alert dedup ──────────────────────

/**
 * Idempotent by stripe_invoice_id — a duplicate webhook delivery (Stripe
 * retries until it gets a 200, and can also send the same event twice)
 * upserts the same row instead of creating a duplicate payment.
 */
async function upsertPaymentRecordFromInvoice(invoice: any, status: 'paid' | 'failed') {
  const subscriptionId = extractInvoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    console.warn(`[stripe/webhook] invoice ${invoice.id}: no subscription reference found, skipping PaymentRecord`);
    return null;
  }

  const subscriptionRow = await prisma.subscription.findFirst({
    where: { stripe_subscription_id: subscriptionId },
    include: { company: true },
  });
  if (!subscriptionRow) {
    console.warn(`[stripe/webhook] invoice ${invoice.id}: no local Subscription for stripe_subscription_id=${subscriptionId}, skipping PaymentRecord`);
    return null;
  }

  const { periodStart, periodEnd } = extractInvoicePeriod(invoice);
  const amountCents = status === 'paid'
    ? (invoice.amount_paid ?? 0)
    : (invoice.amount_due ?? invoice.amount_remaining ?? 0);
  const paidAtUnix = invoice.status_transitions?.paid_at;
  const paidAt = status === 'paid'
    ? (typeof paidAtUnix === 'number' ? new Date(paidAtUnix * 1000) : new Date())
    : null;

  await prisma.paymentRecord.upsert({
    where: { stripe_invoice_id: invoice.id },
    create: {
      company_id: subscriptionRow.company_id,
      stripe_invoice_id: invoice.id,
      stripe_payment_intent_id: extractInvoicePaymentIntentId(invoice),
      stripe_subscription_id: subscriptionId,
      amount_cents: amountCents,
      currency: String(invoice.currency ?? subscriptionRow.currency ?? 'eur').toUpperCase(),
      status,
      period_start: periodStart,
      period_end: periodEnd,
      paid_at: paidAt,
      failed_at: status === 'failed' ? new Date() : null,
    },
    update: {
      status,
      amount_cents: amountCents,
      period_start: periodStart,
      period_end: periodEnd,
      ...(status === 'paid' ? { paid_at: paidAt } : { failed_at: new Date() }),
    },
  });

  return subscriptionRow;
}

/**
 * Sends the internal impago email at most once per concrete incident (plan
 * section 11) — dedup key is (company, alertType, stripeInvoiceId). Relies
 * on PaymentAlertLog's unique constraint: if the insert hits a P2002
 * conflict, an alert was already sent for this exact incident, so skip.
 */
async function maybeSendPaymentAlert({
  company,
  subscription,
  alertType,
  stripeInvoiceId,
}: {
  company: { id: string; name: string; tax_id: string };
  subscription: { plan_name: string; status: string; unit_amount_cents: number | null; currency: string; current_period_end: Date | null; stripe_customer_id: string | null };
  alertType: 'payment_failed' | 'past_due' | 'unpaid';
  stripeInvoiceId: string;
}) {
  try {
    await prisma.paymentAlertLog.create({
      data: { company_id: company.id, alert_type: alertType, stripe_invoice_id: stripeInvoiceId },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      // Already alerted for this exact incident — no repeat send.
      return;
    }
    throw err;
  }

  await sendPaymentAlertEmail({
    companyName: company.name,
    taxId: company.tax_id,
    plan: subscription.plan_name,
    amountCents: subscription.unit_amount_cents,
    currency: subscription.currency,
    expectedDate: subscription.current_period_end,
    stripeStatus: subscription.status,
    lastAttempt: new Date(),
    stripeCustomerId: subscription.stripe_customer_id,
    alertType,
  });
}

// ─── invoice.payment_succeeded / invoice.paid ────────────────────────────────

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  const subscriptionId = extractInvoiceSubscriptionId(invoice);
  if (!subscriptionId) return;

  await upsertPaymentRecordFromInvoice(invoice, 'paid');

  await prisma.subscription.updateMany({
    where: { stripe_subscription_id: subscriptionId },
    data: { status: 'active', payment_failure_count: 0 },
  });

  console.log(`[stripe/webhook] invoice.payment_succeeded: subscription ${subscriptionId} set to active`);
}

// ─── invoice.payment_failed ───────────────────────────────────────────────────

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId = extractInvoiceSubscriptionId(invoice);
  if (!subscriptionId) return;

  const subscriptionRow = await upsertPaymentRecordFromInvoice(invoice, 'failed');

  await prisma.subscription.updateMany({
    where: { stripe_subscription_id: subscriptionId },
    data: { status: 'past_due', payment_failure_count: { increment: 1 } },
  });

  console.log(`[stripe/webhook] invoice.payment_failed: subscription ${subscriptionId} set to past_due`);

  if (subscriptionRow) {
    await maybeSendPaymentAlert({
      company: subscriptionRow.company,
      subscription: subscriptionRow,
      alertType: 'payment_failed',
      stripeInvoiceId: (invoice as any).id,
    });
  }
}
