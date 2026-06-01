import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { getStripeKeys, isStripeConfigured, GESTORIA_PACKS, SUBSCRIPTION_PLANS } from '@/lib/stripe-helpers';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user for customer_email and company_id in metadata
    const session = await getServerSession(authOptions);
    const userEmail = session?.user?.email ?? undefined;
    const companyId = (session?.user as any)?.companyId ?? undefined;

    if (!isStripeConfigured()) {
      console.error('[stripe/checkout] Stripe not configured — STRIPE_SECRET_KEY missing or is placeholder');
      return NextResponse.json(
        { error: 'Stripe no está configurado. Contacta con soporte.' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { type, pack_size, plan, contact } = body;

    const effectiveEmail = userEmail || contact?.email || undefined;

    console.log(`[stripe/checkout] type=${type} pack_size=${pack_size} plan=${plan} userEmail=${effectiveEmail} companyId=${companyId}`);

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(getStripeKeys().secretKey, { apiVersion: '2024-06-20' as any });

    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    let lineItems: any[];
    let metadata: Record<string, string> = {};
    let successPath: string;
    let cancelPath: string;
    let subscriptionData: { trial_period_days: number } | undefined;

    if (type === 'gestoria_pack') {
      const packInfo = GESTORIA_PACKS[pack_size as keyof typeof GESTORIA_PACKS];
      if (!packInfo) {
        const validKeys = Object.keys(GESTORIA_PACKS).join(', ');
        console.error(`[stripe/checkout] Pack no válido: pack_size=${pack_size}. Claves válidas: ${validKeys}`);
        return NextResponse.json(
          { error: `Pack no válido (tamaño ${pack_size}). Recarga la página e inténtalo de nuevo.` },
          { status: 400 }
        );
      }
      lineItems = [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `TotalFactu ${packInfo.name}`,
            description: `Pack de ${pack_size} licencias para gestorías`,
          },
          unit_amount: packInfo.price * 100,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }];
      metadata = {
        type: 'gestoria_pack',
        pack_size: String(pack_size),
        // Include both so webhook can activate without depending solely on customer_email
        company_id: companyId || '',
        user_email: effectiveEmail || '',
      };
      successPath = '/dashboard/gestoria?checkout=success';
      cancelPath = '/dashboard/billing';

      // Offer 60-day trial only if company has never had a Stripe subscription
      if (companyId) {
        const existingGestoriaSub = await prisma.subscription.findFirst({
          where: { company_id: companyId },
          select: { stripe_subscription_id: true },
        });
        if (!existingGestoriaSub?.stripe_subscription_id) {
          subscriptionData = { trial_period_days: 60 };
        }
      }

    } else if (type === 'plan' && plan === 'profesional') {
      if (!session || !companyId) {
        return NextResponse.json({ error: 'Debes estar autenticado para mejorar tu plan' }, { status: 401 });
      }

      const planInfo = SUBSCRIPTION_PLANS.profesional;
      lineItems = [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: 'TotalFactu Profesional',
            description: 'Facturas ilimitadas con IA · 1 usuario',
          },
          unit_amount: Math.round(planInfo.price * 100),
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }];
      metadata = {
        type: 'plan',
        plan: 'profesional',
        company_id: companyId || '',
        user_email: effectiveEmail || '',
      };
      successPath = '/dashboard?checkout=success&plan=profesional';
      cancelPath = '/dashboard/billing';

      // Offer 30-day trial only if company has never had a Stripe subscription
      const existingSub = await prisma.subscription.findFirst({
        where: { company_id: companyId },
        select: { stripe_subscription_id: true },
      });
      if (!existingSub?.stripe_subscription_id) {
        subscriptionData = { trial_period_days: 30 };
      }

    } else {
      return NextResponse.json({ error: 'Tipo de checkout no válido' }, { status: 400 });
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: lineItems,
      metadata,
      success_url: `${baseUrl}${successPath}`,
      cancel_url: `${baseUrl}${cancelPath}`,
      customer_email: effectiveEmail,
      ...(subscriptionData && { subscription_data: subscriptionData }),
    });

    console.log(`[stripe/checkout] Session creada: ${checkoutSession.id} para ${effectiveEmail}`);
    return NextResponse.json({ url: checkoutSession.url });

  } catch (error: any) {
    // Extract Stripe-specific error info for useful logs
    const errType    = error?.type    ?? 'unknown_type';
    const errCode    = error?.code    ?? 'unknown_code';
    const errMessage = error?.message ?? 'Sin mensaje';

    console.error(`[stripe/checkout] Error — type=${errType} code=${errCode} message=${errMessage}`);

    if (errType === 'StripeAuthenticationError') {
      return NextResponse.json(
        { error: 'Error de autenticación con Stripe. Verifica que STRIPE_SECRET_KEY esté configurada correctamente en Vercel.' },
        { status: 500 }
      );
    }

    if (errType === 'StripeInvalidRequestError') {
      return NextResponse.json(
        { error: `Solicitud inválida a Stripe: ${errMessage}` },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: `Error al crear la sesión de pago: ${errMessage}` },
      { status: 500 }
    );
  }
}
