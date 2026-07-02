import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { parseByouXls } from '@/lib/tpv-parsers/byou';

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

// POST — parse XLS file and return preview for a gestoria acting on a client company
export async function POST(
  request: NextRequest,
  { params }: { params: { clientCompanyId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const companyId = params.clientCompanyId;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const content = await file.text();
  const parsed = parseByouXls(content);

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { error: 'No se encontraron registros válidos en el archivo' },
      { status: 422 },
    );
  }

  const datesToCheck = parsed.rows.map((r) => new Date(r.date));
  const existing = await prisma.dailyCashRegister.findMany({
    where: { company_id: companyId, date: { in: datesToCheck } },
    select: { date: true },
  });
  const existingDates = new Set(existing.map((e) => e.date.toISOString().split('T')[0]));

  const rows = parsed.rows.map((row) => ({
    ...row,
    status: existingDates.has(row.date) ? ('exists' as const) : ('new' as const),
  }));

  return NextResponse.json({
    rows,
    summary: {
      total: rows.length,
      new: rows.filter((r) => r.status === 'new').length,
      exists: rows.filter((r) => r.status === 'exists').length,
      skipped: parsed.skipped,
      parseErrors: parsed.parseErrors,
    },
  });
}
