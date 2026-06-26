import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

async function getCompanyId(userId: string): Promise<string | null> {
  const membership = await prisma.membership.findFirst({
    where: { user_id: userId },
    select: { company_id: true },
  });
  return membership?.company_id ?? null;
}

// GET — list registers with optional month filter + monthly summary
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const companyId = await getCompanyId(session.user.id);
  if (!companyId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const year  = parseInt(searchParams.get('year')  ?? String(new Date().getFullYear()));
  const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1));

  const from = new Date(year, month - 1, 1);
  const to   = new Date(year, month, 1);   // exclusive upper bound

  const [registers, summary] = await Promise.all([
    prisma.dailyCashRegister.findMany({
      where: { company_id: companyId, date: { gte: from, lt: to } },
      orderBy: { date: 'desc' },
    }),
    prisma.dailyCashRegister.aggregate({
      where: { company_id: companyId, date: { gte: from, lt: to } },
      _sum: {
        cash_amount:     true,
        card_amount:     true,
        bizum_amount:    true,
        transfer_amount: true,
        other_amount:    true,
        total_amount:    true,
      },
    }),
  ]);

  return NextResponse.json({
    registers,
    summary: {
      cash_amount:     Number(summary._sum.cash_amount     ?? 0),
      card_amount:     Number(summary._sum.card_amount     ?? 0),
      bizum_amount:    Number(summary._sum.bizum_amount    ?? 0),
      transfer_amount: Number(summary._sum.transfer_amount ?? 0),
      other_amount:    Number(summary._sum.other_amount    ?? 0),
      total_amount:    Number(summary._sum.total_amount    ?? 0),
    },
  });
}

// POST — create a new daily register
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const companyId = await getCompanyId(session.user.id);
  if (!companyId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: {
    date: string;
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

  if (!body.date) return NextResponse.json({ error: 'date is required' }, { status: 400 });

  const dateObj = new Date(body.date);
  if (isNaN(dateObj.getTime())) return NextResponse.json({ error: 'Invalid date' }, { status: 400 });

  const cash     = Number(body.cash_amount     ?? 0);
  const card     = Number(body.card_amount     ?? 0);
  const bizum    = Number(body.bizum_amount    ?? 0);
  const transfer = Number(body.transfer_amount ?? 0);
  const other    = Number(body.other_amount    ?? 0);
  const total    = cash + card + bizum + transfer + other;

  try {
    const register = await prisma.dailyCashRegister.create({
      data: {
        company_id:      companyId,
        date:            dateObj,
        cash_amount:     cash,
        card_amount:     card,
        bizum_amount:    bizum,
        transfer_amount: transfer,
        other_amount:    other,
        total_amount:    total,
        notes:           body.notes?.trim() || null,
      },
    });
    return NextResponse.json({ register }, { status: 201 });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'Ya existe un registro para esa fecha' }, { status: 409 });
    }
    throw e;
  }
}
