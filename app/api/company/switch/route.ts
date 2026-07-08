import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { cookies } from 'next/headers';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { ACTIVE_COMPANY_COOKIE, activeCompanyCookieOptions } from '@/lib/active-company';

export const dynamic = 'force-dynamic';

// POST — switch the caller's active company (Gestión de empresas).
// Only allows switching to a company the user actually has a Membership on.
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  let body: { companyId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }

  const companyId = body.companyId;
  if (!companyId) {
    return NextResponse.json({ message: 'companyId is required' }, { status: 400 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user_id: session.user.id, company_id: companyId },
    select: { company_id: true },
  });

  if (!membership) {
    return NextResponse.json({ message: 'No tienes acceso a esa empresa' }, { status: 403 });
  }

  cookies().set(ACTIVE_COMPANY_COOKIE, companyId, activeCompanyCookieOptions());

  return NextResponse.json({ ok: true });
}
