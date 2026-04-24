// Stripe integration helpers
// Production-ready with environment variables

export function getStripeKeys() {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  };
}

export function isStripeConfigured(): boolean {
  const { secretKey, publishableKey } = getStripeKeys();
  return !!secretKey && !!publishableKey;
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

export const GESTORIA_PACKS = {
  10: { name: 'Pack Básico', price: 89, stripePriceId: process.env.STRIPE_PRICE_GESTORIA_10 || '' },
  30: { name: 'Pack Profesional', price: 229, stripePriceId: process.env.STRIPE_PRICE_GESTORIA_30 || '' },
  50: { name: 'Pack Business', price: 349, stripePriceId: process.env.STRIPE_PRICE_GESTORIA_50 || '' },
};
