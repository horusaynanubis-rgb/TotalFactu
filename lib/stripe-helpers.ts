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
