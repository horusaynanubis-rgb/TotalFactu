import { NextRequest, NextResponse } from 'next/server';
import { getStripeKeys, isStripeConfigured, GESTORIA_PACKS, SUBSCRIPTION_PLANS } from '@/lib/stripe-helpers';

export async function POST(request: NextRequest) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: 'Stripe no está configurado. Añade las claves API de Stripe a las variables de entorno.' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { type, pack_size, plan, contact } = body;

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(getStripeKeys().secretKey, { apiVersion: '2024-06-20' as any });

    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    let lineItems: any[];
    let metadata: Record<string, string> = {};

    if (type === 'gestoria_pack') {
      const packInfo = GESTORIA_PACKS[pack_size as keyof typeof GESTORIA_PACKS];
      if (!packInfo) {
        return NextResponse.json({ error: 'Pack no válido' }, { status: 400 });
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
        contact_name: contact?.name || '',
        contact_email: contact?.email || '',
        contact_company: contact?.company || '',
        contact_message: contact?.message || '',
      };
    } else if (type === 'plan' && plan === 'profesional') {
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
      metadata = { type: 'plan', plan: 'profesional' };
    } else {
      return NextResponse.json({ error: 'Tipo de checkout no válido' }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: lineItems,
      metadata,
      success_url: `${baseUrl}/dashboard?checkout=success&plan=${type === 'gestoria_pack' ? 'gestoria' : plan}`,
      cancel_url: `${baseUrl}/#pricing`,
      customer_email: contact?.email || undefined,
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe checkout error:', error);
    return NextResponse.json({ error: 'Error al crear la sesión de pago' }, { status: 500 });
  }
}
