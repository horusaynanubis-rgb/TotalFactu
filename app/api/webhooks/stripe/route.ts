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
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' as any });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, stripe);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      default:
        // Ignore other events
        break;
    }
  } catch (err: any) {
    console.error(`Error processing webhook event ${event.type}:`, err);
    // Return 200 so Stripe doesn't keep retrying for business logic errors
    return NextResponse.json({ error: 'Internal processing error' }, { status: 200 });
  }

  return NextResponse.json({ received: true });
}

// ─── checkout.session.completed ──────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, stripe: Stripe) {
  const { metadata, customer, subscription: subscriptionId, customer_email } = session;

  const email = customer_email || metadata?.contact_email || '';
  const type = metadata?.type;

  if (type === 'plan' && metadata?.plan === 'profesional') {
    await activateProfesionalPlan(email, customer as string, subscriptionId as string, stripe);
  } else if (type === 'gestoria_pack') {
    const packSize = parseInt(metadata?.pack_size || '0', 10);
    await activateGestoriaPack(email, packSize, customer as string, subscriptionId as string, stripe);
  } else {
    console.warn('checkout.session.completed: unknown metadata type', metadata);
  }
}

async function activateProfesionalPlan(
  email: string,
  stripeCustomerId: string,
  stripeSubscriptionId: string,
  stripe: Stripe
) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`activateProfesionalPlan: no user found for email ${email}`);
    return;
  }

  const membership = await prisma.membership.findFirst({ where: { user_id: user.id } });
  if (!membership) {
    console.error(`activateProfesionalPlan: no company membership for user ${user.id}`);
    return;
  }

  // Get subscription period from Stripe
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;
  if (stripeSubscriptionId) {
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId) as any;
    periodStart = new Date(sub.current_period_start * 1000);
    periodEnd = new Date(sub.current_period_end * 1000);
  }

  const existing = await prisma.subscription.findFirst({
    where: { company_id: membership.company_id },
  });

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
        company_id: membership.company_id,
        plan_name: 'profesional',
        status: 'active',
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
        current_period_start: periodStart,
        current_period_end: periodEnd,
      },
    });
  }

  console.log(`Profesional plan activated for company ${membership.company_id}`);
}

async function activateGestoriaPack(
  email: string,
  packSize: number,
  stripeCustomerId: string,
  stripeSubscriptionId: string,
  stripe: Stripe
) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`activateGestoriaPack: no user found for email ${email}. Manual activation needed.`);
    // TODO: send activation email to the contact so they can register
    return;
  }

  const membership = await prisma.membership.findFirst({ where: { user_id: user.id } });
  if (!membership) {
    console.error(`activateGestoriaPack: no company for user ${user.id}`);
    return;
  }

  // Get period from Stripe
  let periodEnd: Date | null = null;
  if (stripeSubscriptionId) {
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId) as any;
    periodEnd = new Date(sub.current_period_end * 1000);
  }

  // Create pack and generate individual license slots
  await prisma.$transaction(async (tx: any) => {
    const pack = await tx.licensePack.create({
      data: {
        gestoria_company_id: membership.company_id,
        pack_size: packSize,
        licenses_used: 0,
        stripe_subscription_id: stripeSubscriptionId,
        status: 'active',
        period_end: periodEnd,
      },
    });

    // Create one License record per slot
    const licenseData = Array.from({ length: packSize }, () => ({
      pack_id: pack.id,
      status: 'available',
    }));
    await tx.license.createMany({ data: licenseData });

    // Mark company subscription as gestoria/active
    const existingSub = await tx.subscription.findFirst({
      where: { company_id: membership.company_id },
    });
    if (existingSub) {
      await tx.subscription.update({
        where: { id: existingSub.id },
        data: { plan_name: 'gestoria', status: 'active', stripe_customer_id: stripeCustomerId },
      });
    } else {
      await tx.subscription.create({
        data: {
          company_id: membership.company_id,
          plan_name: 'gestoria',
          status: 'active',
          stripe_customer_id: stripeCustomerId,
        },
      });
    }
  });

  console.log(`Gestoria pack of ${packSize} licenses activated for company ${membership.company_id}`);
}

// ─── customer.subscription.updated ───────────────────────────────────────────

async function handleSubscriptionUpdated(stripeSubscription: Stripe.Subscription) {
  const stripeStatus = stripeSubscription.status;

  // Map Stripe status to our internal status
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
  const internalStatus = statusMap[stripeStatus] || 'inactive';

  const sub = stripeSubscription as any;
  const periodStart = new Date(sub.current_period_start * 1000);
  const periodEnd = new Date(sub.current_period_end * 1000);

  // Try to update by stripe_subscription_id on Subscription table
  const updated = await prisma.subscription.updateMany({
    where: { stripe_subscription_id: stripeSubscription.id },
    data: {
      status: internalStatus,
      current_period_start: periodStart,
      current_period_end: periodEnd,
    },
  });

  // Also update LicensePack if it belongs to a gestoria subscription
  await prisma.licensePack.updateMany({
    where: { stripe_subscription_id: stripeSubscription.id },
    data: {
      status: internalStatus === 'active' ? 'active' : 'cancelled',
      period_end: periodEnd,
    },
  });

  if (updated.count === 0) {
    console.warn(`subscription.updated: no subscription found for ${stripeSubscription.id}`);
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

  console.log(`Subscription ${stripeSubscription.id} cancelled`);
}
