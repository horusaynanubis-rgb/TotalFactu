/**
 * Ensures the Telegram bot webhook is registered and points to the correct URL.
 * Safe to call multiple times — checks before setting (idempotent).
 * Called automatically on server startup via instrumentation.ts.
 */

const TELEGRAM_API = 'https://api.telegram.org';

function getExpectedWebhookUrl(): string | null {
  // Explicit override takes priority
  if (process.env.TELEGRAM_WEBHOOK_URL) {
    return process.env.TELEGRAM_WEBHOOK_URL;
  }
  // Derive from app base URL
  const base =
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

  return base ? `${base}/api/webhooks/telegram` : null;
}

export async function ensureTelegramWebhook(): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN not set — skipping webhook setup');
    return;
  }

  const expectedUrl = getExpectedWebhookUrl();
  if (!expectedUrl) {
    console.warn('[Telegram] Cannot determine webhook URL (set NEXTAUTH_URL or TELEGRAM_WEBHOOK_URL) — skipping');
    return;
  }

  try {
    // 1. Get current webhook state
    const infoRes = await fetch(`${TELEGRAM_API}/bot${botToken}/getWebhookInfo`);
    const info = await infoRes.json();

    if (!info.ok) {
      console.error('[Telegram] getWebhookInfo failed:', info.description);
      return;
    }

    const currentUrl: string = info.result?.url ?? '';
    const pendingCount: number = info.result?.pending_update_count ?? 0;
    const lastError: string | undefined = info.result?.last_error_message;

    // 2. Already correct — nothing to do
    if (currentUrl === expectedUrl) {
      console.log(`[Telegram] Webhook already registered ✓ (pending: ${pendingCount})`);
      if (lastError) {
        console.warn(`[Telegram] Last error from Telegram: ${lastError}`);
      }
      return;
    }

    // 3. Missing or wrong URL — register
    console.log(`[Telegram] Registering webhook → ${expectedUrl}`);
    if (currentUrl) {
      console.log(`[Telegram] Replacing old webhook: ${currentUrl}`);
    }

    const body: Record<string, unknown> = {
      url: expectedUrl,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    };

    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret) body.secret_token = secret;

    const setRes = await fetch(`${TELEGRAM_API}/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const setData = await setRes.json();

    if (setData.ok) {
      console.log('[Telegram] Webhook registered successfully ✓');
    } else {
      console.error('[Telegram] Failed to register webhook:', setData.description);
    }
  } catch (err) {
    // Never crash the server over this
    console.error('[Telegram] Unexpected error during webhook setup:', err);
  }
}
