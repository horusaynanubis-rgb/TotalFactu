import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { generateCajaCSV } from '@/lib/caja-csv';
import { getCajaExportRange } from '@/lib/caja-period';

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

// GET — "Caja y cobros (CSV)" direct download for a gestoria acting on a
// client company. Same canonical CSV as the company-side export
// (app/api/caja-cobros/export/route.ts): same period math (lib/caja-period),
// same confirmed-only DailyCashRegister query, same generateCajaCSV
// (lib/caja-csv) — no separate/fourth CSV format. Streamed directly, no ZIP.
export async function GET(
  request: NextRequest,
  { params }: { params: { clientCompanyId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }

  const companyId = params.clientCompanyId;

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get('scope') ?? 'monthly';
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()), 10);
  const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1), 10);
  const quarter = parseInt(searchParams.get('quarter') ?? '0', 10);

  const range = getCajaExportRange(scope, year, month, quarter);
  if (!range) {
    return NextResponse.json({ message: 'Invalid scope/period' }, { status: 400 });
  }

  const registers = await prisma.dailyCashRegister.findMany({
    where: { company_id: companyId, date: { gte: range.start, lte: range.end }, status: 'confirmed' },
    orderBy: { date: 'asc' },
    include: { document: { select: { source_channel: true } } },
  });

  const csv = generateCajaCSV(registers);

  prisma.exportLog.create({
    data: {
      company_id: companyId,
      user_id: session.user.id,
      export_type: 'caja_csv',
      format: 'csv',
      period_label: range.label,
      fiscal_year: year,
      record_count: registers.length,
    },
  }).catch((err) => console.error('[gestoria/caja-cobros/export] ExportLog write failed:', err?.message));

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="caja_cobros_${scope}_${range.label.replace(/\s|\//g, '_')}.csv"`,
    },
  });
}
