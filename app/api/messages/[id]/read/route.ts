import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { resolveActiveCompanyId } from '@/lib/active-company';

export const dynamic = 'force-dynamic';

export async function PATCH(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const companyId = await resolveActiveCompanyId(session);
  if (!companyId) {
    return NextResponse.json({ error: 'No company found' }, { status: 400 });
  }

  const message = await prisma.gestoriaMessage.findUnique({
    where: { id: params.id },
    select: { id: true, client_company_id: true, read_at: true },
  });

  if (!message || message.client_company_id !== companyId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (message.read_at) {
    return NextResponse.json({ ok: true });
  }

  await prisma.gestoriaMessage.update({
    where: { id: params.id },
    data: { read_at: new Date() },
  });

  return NextResponse.json({ ok: true });
}
