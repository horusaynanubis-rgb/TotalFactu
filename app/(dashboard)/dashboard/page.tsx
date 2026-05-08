import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { DashboardContent } from '@/components/dashboard-content';

export const dynamic = 'force-dynamic';

async function getDashboardData(userId: string) {
  const membership = await prisma.membership.findFirst({
    where: { user_id: userId },
    include: { company: true },
  });

  if (!membership) return null;

  const companyId = membership.company_id;
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totalInvoices, pendingReview, documentsThisMonth, recentDocs, totalVAT, subscription] = await Promise.all([
    prisma.invoice.count({ where: { company_id: companyId } }),
    prisma.invoice.count({ where: { company_id: companyId, review_status: 'pending' } }),
    prisma.document.count({
      where: {
        company_id: companyId,
        upload_timestamp: { gte: startOfMonth }
      }
    }),
    prisma.document.findMany({
      where: { company_id: companyId },
      include: { invoice: true },
      orderBy: { created_at: 'desc' },
      take: 5,
    }),
    prisma.invoice.aggregate({
      where: {
        company_id: companyId,
        issue_date: { gte: startOfMonth }
      },
      _sum: { tax_amount: true },
    }),
    prisma.subscription.findFirst({ where: { company_id: companyId } }),
  ]);

  const exportsGenerated = await prisma.export.count({
    where: { company_id: companyId },
  });

  return {
    company: membership.company,
    subscription: { plan_name: subscription?.plan_name ?? 'demo' },
    stats: {
      totalInvoices,
      pendingReview,
      documentsThisMonth,
      totalVAT: totalVAT?._sum?.tax_amount ?? 0,
      exportsGenerated,
    },
    recentDocs: JSON.parse(JSON.stringify(recentDocs)),
  };
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect('/login');
  }

  if ((session?.user as any)?.companyType === 'gestoria') {
    redirect('/dashboard/gestoria');
  }

  const data = await getDashboardData(session.user.id);

  if (!data) {
    return <div className="p-6">No company found. Please contact support.</div>;
  }

  return (
    <DashboardContent
      company={data.company}
      stats={data.stats}
      recentDocs={data.recentDocs}
      subscription={data.subscription}
    />
  );
}
