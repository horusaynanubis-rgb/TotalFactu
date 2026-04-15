import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { setWebhook, deleteWebhook } from '@/lib/telegram';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const membership = await prisma.membership.findFirst({
      where: { user_id: session.user.id },
      include: { company: true },
    });

    if (!membership?.company?.telegram_bot_token) {
      return NextResponse.json(
        { message: 'No Telegram bot token configured' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { webhookUrl, action } = body;

    const botToken = membership.company.telegram_bot_token;

    if (action === 'delete') {
      const result = await deleteWebhook(botToken);
      if (result.ok) {
        await prisma.company.update({
          where: { id: membership.company_id },
          data: { telegram_webhook_secret: null },
        });
      }
      return NextResponse.json(result);
    }

    if (!webhookUrl) {
      return NextResponse.json(
        { message: 'Webhook URL is required' },
        { status: 400 }
      );
    }

    // Generate a secret token for webhook verification
    const secretToken = crypto.randomBytes(32).toString('hex');

    const result = await setWebhook(botToken, webhookUrl, secretToken);

    if (result.ok) {
      // Save the secret token to the company
      await prisma.company.update({
        where: { id: membership.company_id },
        data: { telegram_webhook_secret: secretToken },
      });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Set webhook error:', error);
    return NextResponse.json(
      { ok: false, description: 'Failed to set webhook' },
      { status: 500 }
    );
  }
}
