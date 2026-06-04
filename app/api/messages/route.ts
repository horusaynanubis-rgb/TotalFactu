import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user_id: session.user.id },
    select: { company_id: true },
  });

  if (!membership) {
    return NextResponse.json({ error: 'No company found' }, { status: 400 });
  }

  const messages = await prisma.gestoriaMessage.findMany({
    where: { client_company_id: membership.company_id },
    include: {
      gestoria_company: { select: { id: true, name: true } },
    },
    orderBy: { created_at: 'desc' },
    take: 100,
  });

  const unreadCount = messages.filter((m) => !m.read_at).length;

  return NextResponse.json({ messages, unreadCount });
}
