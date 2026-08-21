import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/admin/platform-admin";
import { prisma } from "@/lib/prisma";
import { INTERNAL_COMPANY_TYPE } from "@/lib/admin/platform-admin";
import {
  EXCLUDE_INTERNAL_WHERE,
  getDocumentStatsMap,
  getGroupCompanyIds,
  getInvoiceStatsMap,
  getLatestSubscriptionMap,
  getMembershipCountMap,
} from "@/lib/admin/company-metrics";
import { classifyCompanyBucket, getPaymentStatusLabel } from "@/lib/admin/company-classification";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

// GET /api/admin/companies?q=&filter=&page=
//
// filter: all | activas | beta | pago_pendiente | sin_pago | canceladas |
//         gestorias | empresas | grupos | internas  (see plan section 7)
//
// Payment status and "grupo" bucket are computed from bulk-fetched
// Subscription/Membership rows (see lib/admin/company-metrics.ts) — not raw
// DB columns — so search/type prefiltering happens in SQL but status/bucket
// filtering and final pagination happen in memory. Acceptable at the
// hundreds-to-low-thousands scale this backoffice targets (single bulk
// queries, no N+1); see plan for the Fase 2 note on denormalizing status
// if company count grows much larger.
export async function GET(request: NextRequest) {
  const admin = await requirePlatformAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const filter = request.nextUrl.searchParams.get("filter") ?? "all";
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? "1"));

  const baseWhere = filter === "internas" ? { company_type: INTERNAL_COMPANY_TYPE } : EXCLUDE_INTERNAL_WHERE;

  const where = q
    ? {
        AND: [
          baseWhere,
          {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { tax_id: { contains: q, mode: "insensitive" as const } },
              { memberships: { some: { user: { email: { contains: q, mode: "insensitive" as const } } } } },
              { memberships: { some: { user: { name: { contains: q, mode: "insensitive" as const } } } } },
            ],
          },
        ],
      }
    : baseWhere;

  const companies = await prisma.company.findMany({
    where,
    select: { id: true, name: true, tax_id: true, company_type: true, is_beta: true, created_at: true },
    orderBy: { created_at: "desc" },
  });

  const companyIds = companies.map((c) => c.id);
  const [groupCompanyIds, subscriptionMap, membershipCountMap, documentStatsMap, invoiceStatsMap] = await Promise.all([
    getGroupCompanyIds(),
    getLatestSubscriptionMap(companyIds),
    getMembershipCountMap(companyIds),
    getDocumentStatsMap(companyIds),
    getInvoiceStatsMap(companyIds),
  ]);

  const typeFilterMap: Record<string, string> = { gestorias: "gestoria", empresas: "individual" };
  const statusFilterMap: Record<string, string> = {
    activas: "Activa",
    beta: "Beta",
    pago_pendiente: "Pago pendiente",
    canceladas: "Cancelada",
  };

  let rows = companies.map((company) => {
    const subscription = subscriptionMap.get(company.id) ?? null;
    const bucket = classifyCompanyBucket(company, groupCompanyIds.has(company.id));
    const status = getPaymentStatusLabel(company, subscription);
    const documentStats = documentStatsMap.get(company.id);
    const invoiceStats = invoiceStatsMap.get(company.id);
    const lastActivityCandidates = [documentStats?.lastUploadAt, invoiceStats?.lastCreatedAt].filter(
      (d): d is Date => !!d,
    );
    const lastActivity = lastActivityCandidates.length
      ? new Date(Math.max(...lastActivityCandidates.map((d) => d.getTime())))
      : null;

    return {
      id: company.id,
      name: company.name,
      taxId: company.tax_id,
      companyType: company.company_type,
      bucket,
      createdAt: company.created_at,
      planName: subscription?.plan_name ?? null,
      isBeta: company.is_beta,
      status,
      userCount: membershipCountMap.get(company.id) ?? 0,
      documentCount: documentStats?.count ?? 0,
      invoiceCount: invoiceStats?.count ?? 0,
      lastActivity,
    };
  });

  if (filter === "gestorias" || filter === "empresas") {
    rows = rows.filter((r) => r.companyType === typeFilterMap[filter]);
  } else if (filter === "grupos") {
    rows = rows.filter((r) => r.bucket === "grupo");
  } else if (filter in statusFilterMap) {
    rows = rows.filter((r) => r.status === statusFilterMap[filter]);
  } else if (filter === "sin_pago") {
    rows = rows.filter((r) => r.status === "Sin suscripción" || r.status === "Inactiva");
  }

  const total = rows.length;
  const start = (page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  return NextResponse.json({
    total,
    page,
    pageSize: PAGE_SIZE,
    companies: pageRows,
  });
}
