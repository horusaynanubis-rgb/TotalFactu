import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { normalizeCompanyName } from '@/lib/invoice-type-classifier';

export const dynamic = 'force-dynamic';

const VALID_TYPES = ['fiscal', 'comercial', 'marca', 'otro'] as const;
type AliasType = (typeof VALID_TYPES)[number];

async function getCompanyId(userId: string): Promise<string | null> {
  const membership = await prisma.membership.findFirst({
    where: { user_id: userId },
    select: { company_id: true },
  });
  return membership?.company_id ?? null;
}

async function resolveAlias(id: string, companyId: string) {
  const record = await prisma.companyAlias.findUnique({ where: { id } });
  if (!record || record.company_id !== companyId) return null;
  return record;
}

// PATCH — update alias (alias text, type, or active toggle)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const companyId = await getCompanyId(session.user.id);
  if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 400 });

  const record = await resolveAlias(params.id, companyId);
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json();
  const { alias, alias_type, active } = body ?? {};

  const updateData: Record<string, unknown> = {};

  if (alias !== undefined) {
    if (typeof alias !== 'string' || alias.trim().length < 3) {
      return NextResponse.json({ error: 'El alias debe tener al menos 3 caracteres' }, { status: 400 });
    }
    if (alias.trim().length > 100) {
      return NextResponse.json({ error: 'El alias no puede superar 100 caracteres' }, { status: 400 });
    }
    const newNormalized = normalizeCompanyName(alias.trim());
    // Check duplicate (excluding current record)
    const dup = await prisma.companyAlias.findFirst({
      where: { company_id: companyId, alias_normalized: newNormalized, NOT: { id: params.id } },
    });
    if (dup) {
      return NextResponse.json({ error: 'Ya existe un alias equivalente para esta empresa' }, { status: 409 });
    }
    updateData.alias = alias.trim();
    updateData.alias_normalized = newNormalized;
  }

  if (alias_type !== undefined) {
    if (!VALID_TYPES.includes(alias_type as AliasType)) {
      return NextResponse.json({ error: 'Tipo de alias inválido' }, { status: 400 });
    }
    updateData.alias_type = alias_type;
  }

  if (active !== undefined) {
    updateData.active = Boolean(active);
  }

  const updated = await prisma.companyAlias.update({
    where: { id: params.id },
    data: updateData,
  });

  return NextResponse.json({ alias: updated });
}

// DELETE — remove alias
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const companyId = await getCompanyId(session.user.id);
  if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 400 });

  const record = await resolveAlias(params.id, companyId);
  if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await prisma.companyAlias.delete({ where: { id: params.id } });

  return NextResponse.json({ ok: true });
}
