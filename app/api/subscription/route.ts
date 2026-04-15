import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
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

    const subscription = await prisma.subscription.findFirst({
      where: { company_id: membership.company_id },
    });

    return NextResponse.json({ subscription });
  } catch (error: any) {
    console.error('Get subscription error:', error);
    return NextResponse.json(
      { message: 'Failed to fetch subscription' },
      { status: 500 }
    );
  }
}
