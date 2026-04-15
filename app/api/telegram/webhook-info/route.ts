import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { getWebhookInfo } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
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
      return NextResponse.json({ configured: false });
    }

    const result = await getWebhookInfo(membership.company.telegram_bot_token);

    return NextResponse.json({
      configured: true,
      webhook: result.ok ? result.result : null,
    });
  } catch (error: any) {
    console.error('Webhook info error:', error);
    return NextResponse.json(
      { configured: false, message: 'Failed to get webhook info' },
      { status: 500 }
    );
  }
}
