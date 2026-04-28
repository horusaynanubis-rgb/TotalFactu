import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { getWebhookInfo } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return NextResponse.json({ configured: false });
    }

    const result = await getWebhookInfo(botToken);

    return NextResponse.json({
      configured: Boolean(result.ok && result.result?.url),
      webhook: result.ok ? result.result : null,
    });
  } catch (error: any) {
    console.error('Webhook info error:', error);
    return NextResponse.json({ configured: false });
  }
}
