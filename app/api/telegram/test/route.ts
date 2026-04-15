import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { getMe, getWebhookInfo } from '@/lib/telegram';

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
        { message: 'No Telegram bot token configured', connected: false },
        { status: 400 }
      );
    }

    const botToken = membership.company.telegram_bot_token;

    // Test bot connection
    const meResult = await getMe(botToken);
    if (!meResult.ok) {
      return NextResponse.json(
        {
          message: `Bot connection failed: ${meResult.description || 'Invalid token'}`,
          connected: false,
        },
        { status: 400 }
      );
    }

    // Get webhook info
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
      { message: 'Connection test failed', connected: false },
      { status: 500 }
    );
  }
}
