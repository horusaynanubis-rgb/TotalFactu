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
  starter: {
    name: 'Starter',
    price: 29,
    currency: 'EUR',
    interval: 'month',
    features: [
      'Up to 50 invoices/month',
      'Basic AI extraction',
      'Monthly CSV exports',
      'Email support',
      '1 user'
    ]
  },
  professional: {
    name: 'Professional',
    price: 79,
    currency: 'EUR',
    interval: 'month',
    features: [
      'Up to 200 invoices/month',
      'Advanced AI extraction',
      'Monthly & Quarterly exports',
      'Priority email support',
      'Up to 5 users',
      'Telegram & Email integration'
    ]
  },
  enterprise: {
    name: 'Enterprise',
    price: 199,
    currency: 'EUR',
    interval: 'month',
    features: [
      'Unlimited invoices',
      'Premium AI extraction',
      'Custom export schedules',
      '24/7 priority support',
      'Unlimited users',
      'All integrations',
      'Custom API access',
      'Dedicated account manager'
    ]
  }
};
