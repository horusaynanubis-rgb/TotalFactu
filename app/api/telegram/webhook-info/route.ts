import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { getWebhookInfo } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Allow internal health-check calls with a shared secret (no session needed)
    const internalSecret = request.headers.get('x-internal-secret');
    const isInternalCall =
      internalSecret &&
      internalSecret === process.env.TELEGRAM_WEBHOOK_SECRET;

    if (!isInternalCall) {
      const session = await getServerSession(authOptions);
      if (!session?.user) {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      }
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({
        configured: false,
        error: 'TELEGRAM_BOT_TOKEN not set',
      });
    }

    const result = await getWebhookInfo(botToken);

    if (!result.ok) {
      return NextResponse.json({
        configured: false,
        error: result.description ?? 'Telegram API error',
      });
    }

    const w = result.result;
    const expectedUrl = process.env.TELEGRAM_WEBHOOK_URL ??
      (process.env.NEXTAUTH_URL
        ? `${process.env.NEXTAUTH_URL}/api/webhooks/telegram`
        : null);

    return NextResponse.json({
      configured: Boolean(w?.url),
      url_matches_expected: expectedUrl ? w?.url === expectedUrl : null,
      webhook_url: w?.url ?? null,
      has_custom_certificate: w?.has_custom_certificate ?? false,
      pending_update_count: w?.pending_update_count ?? 0,
      last_error_date: w?.last_error_date ?? null,
      last_error_message: w?.last_error_message ?? null,
      max_connections: w?.max_connections ?? null,
      allowed_updates: w?.allowed_updates ?? [],
      expected_url: expectedUrl,
    });
  } catch (error: any) {
    console.error('[Telegram] webhook-info error:', error);
    return NextResponse.json(
      { configured: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
