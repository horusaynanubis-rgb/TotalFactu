import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// GET — client views their pending correction proposals
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const membership = await prisma.membership.findFirst({
    where: { user_id: session.user.id },
    select: { company_id: true, company: { select: { company_type: true } } },
  });
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Gestoria users don't have corrections — this is a client-only endpoint
  if (membership.company.company_type === 'gestoria') {
    return NextResponse.json({ proposals: [], pendingCount: 0 });
  }

  const proposals = await prisma.invoiceCorrectionProposal.findMany({
    where: {
      client_company_id: membership.company_id,
      status: 'pending',
    },
    include: {
      invoice: {
        select: {
          id: true,
          invoice_number: true,
          supplier_name: true,
          issue_date: true,
          total_amount: true,
          currency: true,
          document_id: true,
        },
      },
      gestoria_company: { select: { id: true, name: true } },
      proposed_by: { select: { name: true } },
    },
    orderBy: { created_at: 'desc' },
  });

  return NextResponse.json({ proposals, pendingCount: proposals.length });
}
