import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // Use companyId already stored in the JWT
    let companyId = session.user.companyId;
    if (!companyId) {
      const membership = await prisma.membership.findFirst({
        where: { user_id: session.user.id },
        orderBy: { created_at: 'asc' },
      });
      if (!membership) {
        return NextResponse.json({ message: 'No company found' }, { status: 400 });
      }
      companyId = membership.company_id;
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const review = searchParams.get('review');
    const search = searchParams.get('search');

    const where: any = { company_id: companyId };
    if (type && type !== 'all') where.invoice_type = type;
    if (review && review !== 'all') where.review_status = review;
    if (search) {
      where.OR = [
        { invoice_number: { contains: search, mode: 'insensitive' } },
        { supplier_name: { contains: search, mode: 'insensitive' } },
        { customer_name: { contains: search, mode: 'insensitive' } },
      ];
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: { document: true },
      orderBy: { issue_date: 'desc' },
      take: 100,
    });

    return NextResponse.json({ invoices });
  } catch (error: any) {
    console.error('[invoices] GET error:', error);
    return NextResponse.json({ message: 'Failed to fetch invoices' }, { status: 500 });
  }
}
