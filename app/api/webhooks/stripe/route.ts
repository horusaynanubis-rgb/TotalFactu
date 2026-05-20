import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { prisma } from '@/lib/prisma';

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

      case 'invoice.payment_succeeded':
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
  if (stripeSubscriptionId) {
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId) as any;
    periodStart = new Date(sub.current_period_start * 1000);
    periodEnd = new Date(sub.current_period_end * 1000);
  }

  const existing = await prisma.subscription.findFirst({ where: { company_id: resolvedCompanyId } });

  if (existing) {
    await prisma.subscription.update({
      where: { id: existing.id },
      data: {
        plan_name: 'profesional',
        status: 'active',
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
        current_period_start: periodStart,
        current_period_end: periodEnd,
      },
    });
  } else {
    await prisma.subscription.create({
      data: {
        company_id: resolvedCompanyId,
        plan_name: 'profesional',
        status: 'active',
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
        current_period_start: periodStart,
        current_period_end: periodEnd,
      },
    });
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

  let periodEnd: Date | null = null;
  if (stripeSubscriptionId) {
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId) as any;
    periodEnd = new Date(sub.current_period_end * 1000);
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

    const existingSub = await tx.subscription.findFirst({
      where: { company_id: resolvedCompanyId },
    });
    if (existingSub) {
      await tx.subscription.update({
        where: { id: existingSub.id },
        data: { plan_name: 'gestoria', status: 'active', stripe_customer_id: stripeCustomerId },
      });
    } else {
      await tx.subscription.create({
        data: {
          company_id: resolvedCompanyId,
          plan_name: 'gestoria',
          status: 'active',
          stripe_customer_id: stripeCustomerId,
        },
      });
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
  const periodStart = new Date(sub.current_period_start * 1000);
  const periodEnd = new Date(sub.current_period_end * 1000);

  const updated = await prisma.subscription.updateMany({
    where: { stripe_subscription_id: stripeSubscription.id },
    data: { status: internalStatus, current_period_start: periodStart, current_period_end: periodEnd },
  });

  await prisma.licensePack.updateMany({
    where: { stripe_subscription_id: stripeSubscription.id },
    data: {
      status: internalStatus === 'active' ? 'active' : 'cancelled',
      period_end: periodEnd,
    },
  });

  if (updated.count === 0) {
    console.warn(`[stripe/webhook] subscription.updated: no subscription found for ${stripeSubscription.id}`);
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

// ─── invoice.payment_succeeded ────────────────────────────────────────────────

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  // In Stripe v22 the subscription reference moved to invoice.parent.subscription_details.subscription
  const subRef = invoice.parent?.subscription_details?.subscription;
  const subscriptionId = typeof subRef === 'string' ? subRef : subRef?.id;
  if (!subscriptionId) return;

  await prisma.subscription.updateMany({
    where: { stripe_subscription_id: subscriptionId },
    data: { status: 'active' },
  });

  console.log(`[stripe/webhook] invoice.payment_succeeded: subscription ${subscriptionId} set to active`);
}

// ─── invoice.payment_failed ───────────────────────────────────────────────────

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  // In Stripe v22 the subscription reference moved to invoice.parent.subscription_details.subscription
  const subRef = invoice.parent?.subscription_details?.subscription;
  const subscriptionId = typeof subRef === 'string' ? subRef : subRef?.id;
  if (!subscriptionId) return;

  await prisma.subscription.updateMany({
    where: { stripe_subscription_id: subscriptionId },
    data: { status: 'past_due' },
  });

  console.log(`[stripe/webhook] invoice.payment_failed: subscription ${subscriptionId} set to past_due`);
}
