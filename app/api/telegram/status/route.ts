import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const membership = await prisma.membership.findFirst({
      where: { user_id: session.user.id },
    });

    if (!membership) {
      return NextResponse.json({ message: 'No company found' }, { status: 400 });
    }

    const link = await prisma.telegramLink.findFirst({
      where: {
        user_id: session.user.id,
        company_id: membership.company_id,
      },
    });

    return NextResponse.json({
      linked: Boolean(link),
      username: link?.username ?? null,
      firstName: link?.first_name ?? null,
      linkedAt: link?.created_at ?? null,
    });
  } catch (error: any) {
    console.error('Telegram status error:', error);
    return NextResponse.json({ message: 'Failed to get status' }, { status: 500 });
  }
}
