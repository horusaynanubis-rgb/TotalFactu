import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { parseByouXls } from '@/lib/tpv-parsers/byou';

export const dynamic = 'force-dynamic';

// Prefers the active company already validated in the JWT (session.user.companyId);
// only re-derives from Membership as a fallback for a stale/edge-case token.
async function getCompanyId(session: any): Promise<string | null> {
  if (session?.user?.companyId) return session.user.companyId;
  const membership = await prisma.membership.findFirst({
    where: { user_id: session.user.id },
    select: { company_id: true },
  });
  return membership?.company_id ?? null;
}

// POST — upload XLS file, parse it, and return a preview with duplicate status
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const companyId = await getCompanyId(session);
  if (!companyId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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

  // Check which dates already exist for this company
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
