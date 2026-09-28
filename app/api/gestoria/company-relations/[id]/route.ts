import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { assertActiveRelationOwnership } from '@/lib/gestoria-eligibility';

export const dynamic = 'force-dynamic';

// NEW MODEL equivalent of the legacy license revoke — ends the management
// relationship immediately (same "instant, not end-of-period" behavior as
// the legacy route; this endpoint carries no billing implication at all,
// since the client company's own Subscription is untouched either way).
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user_id: session.user.id },
    select: { company_id: true, company: { select: { company_type: true } } },
    orderBy: { created_at: 'asc' },
  });
  if (!membership || membership.company.company_type !== 'gestoria') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const relation = await assertActiveRelationOwnership(params.id, membership.company_id);
  if (!relation) {
    return NextResponse.json({ error: 'Relation not found' }, { status: 404 });
  }
  if (relation.status !== 'active') {
    return NextResponse.json({ error: 'Relation is not active' }, { status: 400 });
  }

  await prisma.gestoriaClientRelation.update({
    where: { id: params.id },
    data: { status: 'ended', ended_at: new Date(), ended_reason: 'removed_by_firm' },
  });

  return NextResponse.json({ success: true });
}
