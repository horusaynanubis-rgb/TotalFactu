import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { setWebhook, deleteWebhook } from '@/lib/telegram';
import { ensureTelegramWebhook } from '@/lib/ensure-telegram-webhook';

export const dynamic = 'force-dynamic';

function getBaseUrl(request: NextRequest): string {
  if (process.env.TELEGRAM_WEBHOOK_URL) {
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
      console.log('[Telegram set-webhook] Deleting webhook...');
      const result = await deleteWebhook(botToken);
      console.log('[Telegram set-webhook] Delete result:', JSON.stringify(result));
      return NextResponse.json(result);
    }

    // Ensure mode (check first, only update if needed) — default
    if (!force) {
      console.log('[Telegram set-webhook] Running ensure mode...');
      await ensureTelegramWebhook();
      return NextResponse.json({ ok: true, description: 'Webhook verified/updated (ensure mode)' });
    }

    // Force mode: delete first, then re-register with current secret
    const webhookUrl = body.webhookUrl ?? `${getBaseUrl(request)}/api/webhooks/telegram`;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

    console.log(`[Telegram set-webhook] Force mode — deleting old webhook first...`);
    const deleteResult = await deleteWebhook(botToken);
    console.log('[Telegram set-webhook] Delete result:', JSON.stringify(deleteResult));

    console.log(`[Telegram set-webhook] Registering new webhook → ${webhookUrl}`);
    console.log(`[Telegram set-webhook] secret_token configured: ${Boolean(secret)}`);

    const setResult = await setWebhook(botToken, webhookUrl, secret);
    console.log('[Telegram set-webhook] Telegram full response:', JSON.stringify(setResult));

    if (setResult.ok) {
      console.log('[Telegram set-webhook] ✅ Webhook registered successfully');
    } else {
      console.error('[Telegram set-webhook] ❌ Registration failed:', setResult.description);
    }

    return NextResponse.json({
      ...setResult,
      registered_url: webhookUrl,
      secret_used: Boolean(secret),
    });
  } catch (error: any) {
    console.error('[Telegram set-webhook] ❌ Unexpected error:', error);
    return NextResponse.json(
      { ok: false, description: 'Internal server error' },
      { status: 500 }
    );
  }
}
