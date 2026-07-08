import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// POST — confirm or reject a pending AI-detected cash register
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Prefers the active company already validated in the JWT; falls back to
  // Membership only for a stale/edge-case token.
  const companyId = session.user.companyId
    ?? (await prisma.membership.findFirst({
      where: { user_id: session.user.id },
      select: { company_id: true },
    }))?.company_id;
  if (!companyId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const register = await prisma.dailyCashRegister.findUnique({ where: { id: params.id } });
  if (!register || register.company_id !== companyId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: {
    action: 'confirm' | 'reject';
    // Optional field overrides when user edits before confirming
    cash_amount?: number;
    card_amount?: number;
    bizum_amount?: number;
    transfer_amount?: number;
    other_amount?: number;
    notes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.action === 'reject') {
    await prisma.dailyCashRegister.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true, action: 'rejected' });
  }

  if (body.action === 'confirm') {
    const cash     = Number(body.cash_amount     ?? register.cash_amount);
    const card     = Number(body.card_amount     ?? register.card_amount);
    const bizum    = Number(body.bizum_amount    ?? register.bizum_amount);
    const transfer = Number(body.transfer_amount ?? register.transfer_amount);
    const other    = Number(body.other_amount    ?? register.other_amount);
    const total    = cash + card + bizum + transfer + other;

    const updated = await prisma.dailyCashRegister.update({
      where: { id: params.id },
      data: {
        status:          'confirmed',
        cash_amount:     cash,
        card_amount:     card,
        bizum_amount:    bizum,
        transfer_amount: transfer,
        other_amount:    other,
        total_amount:    total,
        notes: 'notes' in body ? (body.notes?.trim() || null) : register.notes,
      },
    });
    return NextResponse.json({ ok: true, action: 'confirmed', register: updated });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
