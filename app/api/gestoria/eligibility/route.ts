import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { getGestoriaEligibility } from '@/lib/gestoria-eligibility';

export const dynamic = 'force-dynamic';

// Single canonical read used by the portal status banner (and anything
// else that needs to know a firm's state) — always the caller's OWN
// gestoria company, resolved from their session, never a client-supplied
// firmId (no IDOR surface here at all).
export async function GET() {
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

  const eligibility = await getGestoriaEligibility(membership.company_id);
  return NextResponse.json(eligibility);
}
