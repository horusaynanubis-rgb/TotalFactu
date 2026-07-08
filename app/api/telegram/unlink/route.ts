import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { resolveActiveCompanyId } from '@/lib/active-company';

export const dynamic = 'force-dynamic';

export async function DELETE() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const companyId = await resolveActiveCompanyId(session);
    if (!companyId) {
      return NextResponse.json({ message: 'No company found' }, { status: 400 });
    }

    await prisma.telegramLink.deleteMany({
      where: {
        user_id: session.user.id,
        company_id: companyId,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error('Telegram unlink error:', error);
    return NextResponse.json({ message: 'Failed to unlink' }, { status: 500 });
  }
}
