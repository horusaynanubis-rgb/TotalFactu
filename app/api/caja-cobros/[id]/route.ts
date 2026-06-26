import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

async function resolveRegister(id: string, userId: string) {
  const membership = await prisma.membership.findFirst({
    where: { user_id: userId },
    select: { company_id: true },
  });
  if (!membership) return null;

  const register = await prisma.dailyCashRegister.findUnique({ where: { id } });
  if (!register || register.company_id !== membership.company_id) return null;
  return register;
}

// PUT — update an existing register
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const register = await resolveRegister(params.id, session.user.id);
  if (!register) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: {
    date?: string;
    cash_amount?: number;
    card_amount?: number;
    bizum_amount?: number;
    transfer_amount?: number;
    other_amount?: number;
    notes?: string;
    status?: string; // 'confirmed' | 'pending_review' — for AI confirmation flow
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const cash     = Number(body.cash_amount     ?? register.cash_amount);
  const card     = Number(body.card_amount     ?? register.card_amount);
  const bizum    = Number(body.bizum_amount    ?? register.bizum_amount);
  const transfer = Number(body.transfer_amount ?? register.transfer_amount);
  const other    = Number(body.other_amount    ?? register.other_amount);
  const total    = cash + card + bizum + transfer + other;

  const dateObj = body.date ? new Date(body.date) : register.date;
  if (isNaN(dateObj.getTime())) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });

  try {
    const updated = await prisma.dailyCashRegister.update({
      where: { id: params.id },
      data: {
        date:            dateObj,
        cash_amount:     cash,
        card_amount:     card,
        bizum_amount:    bizum,
        transfer_amount: transfer,
        other_amount:    other,
        total_amount:    total,
        notes:           'notes' in body ? (body.notes?.trim() || null) : register.notes,
        ...(body.status === 'confirmed' || body.status === 'pending_review'
          ? { status: body.status }
          : {}),
      },
    });
    return NextResponse.json({ register: updated });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'Ya existe un registro para esa fecha' }, { status: 409 });
    }
    throw e;
  }
}

// DELETE — remove a register
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const register = await resolveRegister(params.id, session.user.id);
  if (!register) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await prisma.dailyCashRegister.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
