import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Public, read-only validator — mirrors app/api/activate/[token]/route.ts.
// Never associates anything by itself; only tells the frontend whether the
// link is still good, so it can render "create an account" (new_company)
// or "log in and accept" (existing_company) accordingly.
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  const invitation = await prisma.gestoriaCompanyInvitation.findUnique({
    where: { token: params.token },
    include: { gestoria_company: { select: { id: true, name: true } } },
  });

  if (!invitation) {
    return NextResponse.json({ error: 'Invalid invitation link' }, { status: 404 });
  }

  if (invitation.status === 'accepted') {
    return NextResponse.json({ error: 'This invitation has already been used' }, { status: 410 });
  }

  if (invitation.status === 'revoked' || invitation.status === 'rejected') {
    return NextResponse.json({ error: 'This invitation is no longer valid' }, { status: 410 });
  }

  if (invitation.status === 'expired' || invitation.expires_at < new Date()) {
    if (invitation.status === 'pending') {
      await prisma.gestoriaCompanyInvitation.update({
        where: { id: invitation.id },
        data: { status: 'expired' },
      });
    }
    return NextResponse.json({ error: 'This invitation has expired' }, { status: 410 });
  }

  return NextResponse.json({
    valid: true,
    email: invitation.target_email,
    mode: invitation.mode,
    gestoria_name: invitation.gestoria_company.name,
    expires_at: invitation.expires_at,
  });
}
