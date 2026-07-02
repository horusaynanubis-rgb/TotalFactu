import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

async function resolveGestoriaAccess(userId: string, clientCompanyId: string) {
  const membership = await prisma.membership.findFirst({
    where: { user_id: userId },
    select: { company_id: true, company: { select: { company_type: true } } },
  });
  if (!membership || membership.company.company_type !== 'gestoria') return null;

  const license = await prisma.license.findFirst({
    where: {
      client_company_id: clientCompanyId,
      status: 'assigned',
      pack: { gestoria_company_id: membership.company_id },
    },
  });
  if (!license) return null;

  return { gestoriaCompanyId: membership.company_id };
}

interface ImportRow {
  date: string;
  cash_amount: number;
  card_amount: number;
  total_amount: number;
  notes: string | null;
  ai_raw_data: string;
  status: 'new' | 'exists';
}

// POST — execute import for a client company on behalf of a gestoria
export async function POST(
  request: NextRequest,
  { params }: { params: { clientCompanyId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const companyId = params.clientCompanyId;

  let body: { rows: ImportRow[]; skipExisting: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { rows, skipExisting = true } = body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'rows required' }, { status: 400 });
  }

  let imported = 0;
  let skipped = 0;
  let updated = 0;
  const errors: string[] = [];

  for (const row of rows) {
    if (row.status === 'exists' && skipExisting) {
      skipped++;
      continue;
    }

    const dateObj = new Date(row.date);
    const payload = {
      cash_amount:     row.cash_amount,
      card_amount:     row.card_amount,
      bizum_amount:    0,
      transfer_amount: 0,
      other_amount:    0,
      total_amount:    row.total_amount,
      notes:           row.notes,
      source:          'excel_import',
      status:          'confirmed',
      ai_raw_data:     row.ai_raw_data,
    };

    try {
      if (row.status === 'exists' && !skipExisting) {
        await prisma.dailyCashRegister.update({
          where: { company_id_date: { company_id: companyId, date: dateObj } },
          data: payload,
        });
        updated++;
      } else {
        await prisma.dailyCashRegister.create({
          data: { company_id: companyId, date: dateObj, ...payload },
        });
        imported++;
      }
    } catch (e: any) {
      errors.push(`${row.date}: ${e.message ?? 'Error desconocido'}`);
    }
  }

  return NextResponse.json({ imported, skipped, updated, errors });
}
