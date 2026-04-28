import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { setWebhook, deleteWebhook } from '@/lib/telegram';
import { ensureTelegramWebhook } from '@/lib/ensure-telegram-webhook';

export const dynamic = 'force-dynamic';

function getBaseUrl(request: NextRequest): string {
  // Prefer explicit env override, then NEXTAUTH_URL, then request origin
  if (process.env.TELEGRAM_WEBHOOK_URL) {
    // Strip trailing path if full URL was given
    return process.env.TELEGRAM_WEBHOOK_URL.replace(/\/api\/webhooks\/telegram$/, '');
  }
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  return request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json(
        { ok: false, description: 'TELEGRAM_BOT_TOKEN not configured on server' },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { action, force } = body;

    // Delete webhook
    if (action === 'delete') {
      const result = await deleteWebhook(botToken);
      if (result.ok) console.log('[Telegram] Webhook deleted');
      return NextResponse.json(result);
    }

    // Ensure mode (check first, only update if needed) — default
    if (!force) {
      await ensureTelegramWebhook();
      return NextResponse.json({ ok: true, description: 'Webhook verified/updated (ensure mode)' });
    }

    // Force mode: always re-register regardless of current state
    const webhookUrl = body.webhookUrl ?? `${getBaseUrl(request)}/api/webhooks/telegram`;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

    console.log(`[Telegram] Force-registering webhook → ${webhookUrl}`);
    const result = await setWebhook(botToken, webhookUrl, secret);

    if (result.ok) {
      console.log('[Telegram] Webhook force-registered successfully ✓');
    } else {
      console.error('[Telegram] Force-register failed:', result.description);
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[Telegram] set-webhook error:', error);
    return NextResponse.json(
      { ok: false, description: 'Internal server error' },
      { status: 500 }
    );
  }
}
