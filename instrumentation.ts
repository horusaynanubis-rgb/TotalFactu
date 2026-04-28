export async function register() {
  // Only run in Node.js runtime (not edge workers)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { ensureTelegramWebhook } = await import('@/lib/ensure-telegram-webhook');
  await ensureTelegramWebhook();
}
