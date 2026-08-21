import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/auth';
import { prisma } from '@/lib/prisma';
import { findStuckDocuments, DEFAULT_STUCK_TIMEOUT_MINUTES } from '@/lib/stuck-documents';
import { groupDuplicates, DuplicateInvoiceRef } from '@/lib/duplicate-detection';

export const dynamic = 'force-dynamic';

// GET /api/admin/diagnostics?companyId=xxx&timeoutMinutes=15
//
// Read-only operational signal panel — the four checks the 2026-07-15 audit
// showed had no visibility anywhere: documents stuck past a timeout,
// duplicate invoices, documents with no resulting Invoice at all, and
// fiscally unclassified invoices. Admin-only (see lib/admin/auth.ts) — never
// exposed to company users. Not wired into any automatic action; a human
// reads this and decides what (if anything) to do via the dedicated,
// confirm-gated endpoints/scripts (stuck-documents route,
// scripts/resolve-confirmed-duplicates.ts).
//
// Without companyId: returns the two checks that are cheap to compute
// globally (indexed COUNT queries). Duplicate grouping is O(n²) per company
// by design (see lib/duplicate-detection.ts) and the fiscal breakdown is
// live-recomputed per invoice — both require a companyId to stay cheap.
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const companyId = request.nextUrl.searchParams.get('companyId') ?? undefined;
  const timeoutMinutes = Number(request.nextUrl.searchParams.get('timeoutMinutes') ?? DEFAULT_STUCK_TIMEOUT_MINUTES);
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);

  const [stuckDocuments, documentsWithoutInvoiceCount, fiscalStatusCounts] = await Promise.all([
    findStuckDocuments(prisma, { companyId, timeoutMinutes }),
    prisma.document.count({
      where: {
        ...(companyId ? { company_id: companyId } : {}),
        invoice: null,
        delivery_note: null,
        daily_cash_register: null,
        processing_status: { in: ['processing', 'failed'] },
      },
    }),
    prisma.invoice.groupBy({
      by: ['fiscal_status'],
      where: companyId ? { company_id: companyId } : undefined,
      _count: { _all: true },
    }),
  ]);

  // fiscal_status here is the persisted column (written at ingestion time by
  // process/route.ts and by scripts/backfill-fiscal-status.ts) — a fast
  // approximation of the live lib/fiscal-breakdown.ts computation used by
  // every exporter. If this panel's manual_review/pending counts ever
  // disagree with what facturas.csv/resumen_fiscal.csv show for the same
  // period, that gap itself is the signal to re-run the backfill script.
  const fiscalCounts = { classified: 0, pending_classification: 0, mixed_vat: 0, manual_review: 0 } as Record<string, number>;
  for (const row of fiscalStatusCounts) fiscalCounts[row.fiscal_status] = row._count._all;

  let duplicates: { groupCount: number; strongGroupCount: number; probableGroupCount: number; estimatedImpactEur: number } | null = null;
  if (companyId) {
    const invoices = await prisma.invoice.findMany({
      where: { company_id: companyId },
      select: {
        id: true, document_id: true, invoice_number: true, supplier_name: true, supplier_tax_id: true,
        issue_date: true, total_amount: true, created_at: true,
        document: { select: { source_channel: true, original_filename: true } },
      },
    });
    const refs: DuplicateInvoiceRef[] = invoices.map((inv) => ({
      invoiceId: inv.id,
      documentId: inv.document_id,
      invoiceNumber: inv.invoice_number,
      supplierName: inv.supplier_name,
      supplierTaxId: inv.supplier_tax_id,
      issueDate: inv.issue_date,
      totalAmount: inv.total_amount,
      sourceChannel: inv.document?.source_channel ?? null,
      originalFilename: inv.document?.original_filename ?? null,
      createdAt: inv.created_at,
    }));
    const groups = groupDuplicates(refs);
    const estimatedImpactEur = groups.reduce((sum, g) => {
      const sorted = [...g.members].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
      return sum + sorted.slice(1).reduce((s, m) => s + m.totalAmount, 0);
    }, 0);
    duplicates = {
      groupCount: groups.length,
      strongGroupCount: groups.filter((g) => g.matchType === 'strong').length,
      probableGroupCount: groups.filter((g) => g.matchType === 'probable').length,
      estimatedImpactEur: Math.round(estimatedImpactEur * 100) / 100,
    };
  }

  return NextResponse.json({
    scope: companyId ? { companyId } : { scope: 'global' },
    generatedAt: new Date().toISOString(),
    stuckProcessing: {
      timeoutMinutes,
      count: stuckDocuments.length,
      documents: stuckDocuments.slice(0, 50), // cap payload; use the dedicated endpoint/script for the full list
    },
    documentsWithoutInvoice: { count: documentsWithoutInvoiceCount },
    fiscalClassification: fiscalCounts,
    duplicates: duplicates ?? { note: 'pass ?companyId=... to compute duplicate groups for a company' },
  });
}
