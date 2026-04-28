import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { setWebhook, deleteWebhook } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

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

    const body = await request.json();
    const { webhookUrl, action } = body;

    if (action === 'delete') {
      return NextResponse.json(await deleteWebhook(botToken));
    }

    if (!webhookUrl) {
      return NextResponse.json(
        { ok: false, description: 'webhookUrl is required' },
        { status: 400 }
      );
    }

    const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;
    return NextResponse.json(await setWebhook(botToken, webhookUrl, secretToken));
  } catch (error: any) {
    console.error('Set webhook error:', error);
    return NextResponse.json(
      { ok: false, description: 'Failed to set webhook' },
      { status: 500 }
    );
  }
}
