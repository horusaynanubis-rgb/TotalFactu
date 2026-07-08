import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { normalizeCompanyName } from '@/lib/invoice-type-classifier';
import { resolveActiveCompanyId } from '@/lib/active-company';

export const dynamic = 'force-dynamic';

const VALID_TYPES = ['fiscal', 'comercial', 'marca', 'otro'] as const;
type AliasType = (typeof VALID_TYPES)[number];

// GET — list all aliases for current company
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const companyId = await resolveActiveCompanyId(session);
  if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 400 });

  const aliases = await prisma.companyAlias.findMany({
    where: { company_id: companyId },
    orderBy: { created_at: 'asc' },
  });

  return NextResponse.json({ aliases });
}

// POST — create a new alias
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const companyId = await resolveActiveCompanyId(session);
  if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 400 });

  const body = await request.json();
  const { alias, alias_type } = body ?? {};

  if (!alias || typeof alias !== 'string' || alias.trim().length < 3) {
    return NextResponse.json({ error: 'El alias debe tener al menos 3 caracteres' }, { status: 400 });
  }
  if (alias.trim().length > 100) {
    return NextResponse.json({ error: 'El alias no puede superar 100 caracteres' }, { status: 400 });
  }
  if (!alias_type || !VALID_TYPES.includes(alias_type as AliasType)) {
    return NextResponse.json({ error: 'Tipo de alias inválido' }, { status: 400 });
  }

  const aliasNormalized = normalizeCompanyName(alias.trim());

  // Prevent exact-normalized duplicates for this company
  const existing = await prisma.companyAlias.findFirst({
    where: { company_id: companyId, alias_normalized: aliasNormalized },
  });
  if (existing) {
    return NextResponse.json({ error: 'Ya existe un alias equivalente para esta empresa' }, { status: 409 });
  }

  const record = await prisma.companyAlias.create({
    data: {
      company_id: companyId,
      alias: alias.trim(),
      alias_normalized: aliasNormalized,
      alias_type: alias_type as AliasType,
      active: true,
    },
  });

  return NextResponse.json({ alias: record }, { status: 201 });
}
