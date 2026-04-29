import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { getWebhookInfo } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Allow internal calls with shared secret (no session needed)
    const internalSecret = request.headers.get('x-internal-secret');
    const isInternalCall =
      internalSecret &&
      process.env.TELEGRAM_WEBHOOK_SECRET &&
      internalSecret === process.env.TELEGRAM_WEBHOOK_SECRET;

    if (!isInternalCall) {
      const session = await getServerSession(authOptions);
      if (!session?.user) {
        return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
      }
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const hasBotToken = Boolean(botToken);
    const hasWebhookSecret = Boolean(process.env.TELEGRAM_WEBHOOK_SECRET);

    const expectedWebhookUrl =
      process.env.TELEGRAM_WEBHOOK_URL ??
      (process.env.NEXTAUTH_URL
        ? `${process.env.NEXTAUTH_URL}/api/webhooks/telegram`
        : process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}/api/webhooks/telegram`
          : null);

    if (!botToken) {
      return NextResponse.json({
        ok: false,
        error: 'TELEGRAM_BOT_TOKEN not set',
        has_bot_token: false,
        has_webhook_secret: hasWebhookSecret,
        expected_webhook_url: expectedWebhookUrl,
      });
    }

    const result = await getWebhookInfo(botToken);

    if (!result.ok) {
      return NextResponse.json({
        ok: false,
        error: result.description ?? 'Telegram API error',
        has_bot_token: hasBotToken,
        has_webhook_secret: hasWebhookSecret,
        expected_webhook_url: expectedWebhookUrl,
        full_raw_telegram_response: result,
      });
    }

    const w = result.result;
    const webhookUrl: string | null = w?.url ?? null;
    const urlMatchesExpected = expectedWebhookUrl
      ? webhookUrl === expectedWebhookUrl
      : null;

    return NextResponse.json({
      ok: true,
      webhook_url: webhookUrl,
      pending_update_count: w?.pending_update_count ?? 0,
      last_error_message: w?.last_error_message ?? null,
      last_error_date: w?.last_error_date ?? null,
      has_custom_certificate: w?.has_custom_certificate ?? false,
      ip_address: w?.ip_address ?? null,
      max_connections: w?.max_connections ?? null,
      allowed_updates: w?.allowed_updates ?? [],
      has_bot_token: hasBotToken,
      has_webhook_secret: hasWebhookSecret,
      expected_webhook_url: expectedWebhookUrl,
      url_matches_expected: urlMatchesExpected,
      full_raw_telegram_response: result,
    });
  } catch (error: any) {
    console.error('[Telegram] webhook-info error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
