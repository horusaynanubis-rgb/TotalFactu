import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { getMe, getWebhookInfo } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

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
