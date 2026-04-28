import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Unambiguous chars
  let code = 'TF-';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function POST() {
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

    // Invalidate any existing unused codes for this user/company
    await prisma.telegramLinkCode.updateMany({
      where: {
        user_id: session.user.id,
        company_id: membership.company_id,
        used_at: null,
      },
      data: { expires_at: new Date() }, // Expire immediately
    });

    // Generate a unique code
    let code: string;
    let attempts = 0;
    do {
      code = generateCode();
      attempts++;
      if (attempts > 10) {
        return NextResponse.json({ message: 'Failed to generate unique code' }, { status: 500 });
      }
    } while (await prisma.telegramLinkCode.findUnique({ where: { code } }));

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    const linkCode = await prisma.telegramLinkCode.create({
      data: {
        code,
        user_id: session.user.id,
        company_id: membership.company_id,
        expires_at: expiresAt,
      },
    });

    return NextResponse.json({
      code: linkCode.code,
      expiresAt: linkCode.expires_at,
    });
  } catch (error: any) {
    console.error('Generate code error:', error);
    return NextResponse.json({ message: 'Failed to generate code' }, { status: 500 });
  }
}
