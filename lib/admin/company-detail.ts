import { prisma } from "@/lib/prisma";
import { findStuckDocuments } from "@/lib/stuck-documents";
import { classifyCompanyBucket, getPaymentStatusLabel } from "./company-classification";
import { getBillingStatus, getBillingStatusLabel } from "./billing-status";

// Shared by app/api/admin/companies/[companyId]/route.ts and
// app/(dashboard)/dashboard/admin/companies/[companyId]/page.tsx — the page
// calls this directly (no self-fetch over HTTP), same pattern as
// lib/admin/demo-gestoria.ts used by app/(dashboard)/dashboard/admin/demo/page.tsx.
//
// Reuses ExportLog / InvoiceReviewLog / lib/stuck-documents.ts (existing
// tables/helpers) instead of new audit infrastructure. No "last login"
// field — NextAuth's Session table isn't a reliable login history, so it's
// omitted rather than invented.
export async function getCompanyDetail(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) return null;

  const now = new Date();
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [
    memberships,
    subscription,
    documentCount,
    documentsThisMonth,
    lastDocument,
    invoiceCount,
    invoicesThisMonth,
    lastInvoice,
    lastExport,
    lastReview,
    telegramLinkCount,
    fiscalDocsSizeAgg,
    stuckDocuments,
    paymentRecords,
  ] = await Promise.all([
    prisma.membership.findMany({
      where: { company_id: companyId },
      select: { role: true, created_at: true, user: { select: { id: true, name: true, email: true } } },
      orderBy: { created_at: "asc" },
    }),
    prisma.subscription.findFirst({ where: { company_id: companyId }, orderBy: { created_at: "desc" } }),
    prisma.document.count({ where: { company_id: companyId } }),
    prisma.document.count({ where: { company_id: companyId, created_at: { gte: startOfMonth } } }),
    prisma.document.findFirst({ where: { company_id: companyId }, orderBy: { upload_timestamp: "desc" }, select: { upload_timestamp: true } }),
    prisma.invoice.count({ where: { company_id: companyId } }),
    prisma.invoice.count({ where: { company_id: companyId, created_at: { gte: startOfMonth } } }),
    prisma.invoice.findFirst({ where: { company_id: companyId }, orderBy: { created_at: "desc" }, select: { created_at: true } }),
    prisma.exportLog.findFirst({ where: { company_id: companyId }, orderBy: { created_at: "desc" }, select: { created_at: true, export_type: true } }),
    prisma.invoiceReviewLog.findFirst({
      where: { OR: [{ client_company_id: companyId }, { gestoria_company_id: companyId }] },
      orderBy: { created_at: "desc" },
      select: { created_at: true },
    }),
    prisma.telegramLink.count({ where: { company_id: companyId } }),
    prisma.fiscalDocument.aggregate({ where: { company_id: companyId }, _sum: { size_bytes: true }, _count: { _all: true } }),
    findStuckDocuments(prisma, { companyId }),
    // Ordered by period_end, not created_at — a historical backfill inserts
    // rows out of chronological order (see summarizePayments in
    // billing-status.ts for the bug this caused), so created_at can't be
    // trusted as "most recent first" for anything but live webhook inserts.
    prisma.paymentRecord.findMany({
      where: { company_id: companyId },
      orderBy: [{ period_end: { sort: "desc", nulls: "last" } }, { created_at: "desc" }],
    }),
  ]);

  const billing = await getBillingStatus(companyId);

  // "Grupo empresarial" = any of this company's users also belongs to
  // another company (same concept as hasMultipleCompanies in
  // components/dashboard-nav.tsx). One follow-up bulk query, not per-user.
  const userIds = memberships.map((m) => m.user.id);
  const membershipCounts = userIds.length
    ? await prisma.membership.groupBy({ by: ["user_id"], where: { user_id: { in: userIds } }, _count: { _all: true } })
    : [];
  const isPartOfGroup = membershipCounts.some((m) => m._count._all > 1);

  const bucket = classifyCompanyBucket(company, isPartOfGroup);
  const status = getPaymentStatusLabel(company, subscription);

  return {
    company: {
      id: company.id,
      name: company.name,
      taxId: company.tax_id,
      address: company.address,
      country: company.country,
      companyType: company.company_type,
      isBeta: company.is_beta,
      createdAt: company.created_at,
      bucket,
      status,
    },
    users: memberships.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      memberSince: m.created_at,
    })),
    subscription: subscription
      ? {
          planName: subscription.plan_name,
          status: subscription.status,
          stripeCustomerId: subscription.stripe_customer_id,
          currentPeriodStart: subscription.current_period_start,
          currentPeriodEnd: subscription.current_period_end,
        }
      : null,
    billing,
    billingStatusLabel: billing ? getBillingStatusLabel(billing) : null,
    paymentHistory: paymentRecords.map((p) => ({
      id: p.id,
      periodStart: p.period_start,
      periodEnd: p.period_end,
      amountCents: p.amount_cents,
      currency: p.currency,
      status: p.status,
      paidAt: p.paid_at,
      failedAt: p.failed_at,
      stripeInvoiceId: p.stripe_invoice_id,
      stripePaymentIntentId: p.stripe_payment_intent_id,
    })),
    usage: {
      documentsTotal: documentCount,
      documentsThisMonth,
      invoicesTotal: invoiceCount,
      invoicesThisMonth,
      telegramLinked: telegramLinkCount > 0,
      fiscalDocuments: {
        count: fiscalDocsSizeAgg._count._all,
        approxSizeBytes: fiscalDocsSizeAgg._sum.size_bytes ?? 0,
        note: "Solo incluye Documentación Fiscal (con tamaño registrado) — no el total de facturas/documentos.",
      },
    },
    activity: {
      lastDocumentUpload: lastDocument?.upload_timestamp ?? null,
      lastInvoice: lastInvoice?.created_at ?? null,
      lastExport: lastExport ? { at: lastExport.created_at, type: lastExport.export_type } : null,
      lastGestoriaReview: lastReview?.created_at ?? null,
    },
    incidents: {
      stuckDocuments: stuckDocuments.length,
    },
  };
}

export type CompanyDetail = NonNullable<Awaited<ReturnType<typeof getCompanyDetail>>>;
