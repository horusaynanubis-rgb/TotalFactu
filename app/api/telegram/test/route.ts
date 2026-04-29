import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { getMe, getWebhookInfo } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

// GET — quick health check, no auth required (returns only safe non-sensitive info)
export async function GET() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const hasWebhookSecret = Boolean(process.env.TELEGRAM_WEBHOOK_SECRET);
  const hasBotToken = Boolean(botToken);

  const expectedWebhookUrl =
    process.env.TELEGRAM_WEBHOOK_URL ??
    (process.env.NEXTAUTH_URL
      ? `${process.env.NEXTAUTH_URL}/api/webhooks/telegram`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}/api/webhooks/telegram`
        : null);

  return NextResponse.json({
    ok: true,
    bot_token_exists: hasBotToken,
    webhook_secret_exists: hasWebhookSecret,
    expected_webhook_url: expectedWebhookUrl,
    timestamp: new Date().toISOString(),
    runtime: process.env.NEXT_RUNTIME ?? 'unknown',
    node_env: process.env.NODE_ENV ?? 'unknown',
  });
}

// POST — full connection test (requires auth session)
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json(
        { connected: false, message: 'TELEGRAM_BOT_TOKEN not configured on server' },
        { status: 500 }
      );
    }

    const meResult = await getMe(botToken);
    if (!meResult.ok) {
      return NextResponse.json(
        { connected: false, message: meResult.description || 'Invalid token' },
        { status: 400 }
      );
    }

    const webhookResult = await getWebhookInfo(botToken);

    return NextResponse.json({
      connected: true,
      bot: meResult.result,
      webhook: webhookResult.ok ? webhookResult.result : null,
      message: `Connected to @${meResult.result.username}`,
    });
  } catch (error: any) {
    console.error('Telegram test error:', error);
    return NextResponse.json(
      { connected: false, message: 'Connection test failed' },
      { status: 500 }
    );
  }
}
