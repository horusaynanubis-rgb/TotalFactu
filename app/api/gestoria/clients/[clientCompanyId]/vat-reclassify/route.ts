import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { fetchDocumentAsBase64 } from '@/lib/document-file';
import { extractVatBreakdown } from '@/lib/ai-extraction';
import { classifyInvoiceRate } from '@/lib/iva-classification';
import { computeFiscalStatus } from '@/lib/fiscal-status';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Sequential batch cap per click — same order of magnitude as
// MAX_DOCS_PER_BATCH in lib/fiscal-export-builder.ts. Kept small and
// synchronous (no queue infra in this repo) so one request never risks
// hitting maxDuration; the button can simply be clicked again if `remaining`
// comes back > 0.
const MAX_PER_CALL = 20;

// Same tolerance used to reconcile a mixed-line split against header totals
// in lib/iva-classification.ts — applied here to the AI-provided breakdown
// too, so a hallucinated/inconsistent answer is never trusted blindly.
const RECONCILE_TOLERANCE_EUR = 0.15;

async function resolveGestoriaAccess(userId: string, clientCompanyId: string) {
  const membership = await prisma.membership.findFirst({
    where: { user_id: userId },
    select: { company_id: true, company: { select: { company_type: true } } },
  });
  if (!membership || membership.company.company_type !== 'gestoria') return null;

  const license = await prisma.license.findFirst({
    where: {
      client_company_id: clientCompanyId,
      status: 'assigned',
      pack: { gestoria_company_id: membership.company_id },
    },
  });
  if (!license) return null;

  return { gestoriaCompanyId: membership.company_id };
}

// POST — run the VAT-only Gemini micro pass for this client's pending
// invoices, up to MAX_PER_CALL at a time. Never re-attempts an invoice once
// vat_reclassification_attempted is true, regardless of outcome.
export async function POST(
  request: NextRequest,
  { params }: { params: { clientCompanyId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const companyId = params.clientCompanyId;

  const candidates = await prisma.invoice.findMany({
    where: {
      company_id: companyId,
      fiscal_status: { in: ['pending_classification', 'mixed_vat'] },
      vat_reclassification_attempted: false,
      document: { processing_status: 'completed' },
    },
    select: {
      id: true,
      tax_rate: true,
      subtotal: true,
      tax_amount: true,
      total_amount: true,
      invoice_lines: { select: { tax_rate: true, total_amount: true } },
      document: { select: { cloud_storage_path: true, is_public: true, mime_type: true } },
    },
    take: MAX_PER_CALL,
    orderBy: { issue_date: 'asc' },
  });

  let attempted = 0;
  let resolved = 0;
  let manualReview = 0;
  const errors: string[] = [];

  for (const inv of candidates) {
    attempted++;
    try {
      const { fileBase64, effectiveMime } = await fetchDocumentAsBase64(inv.document, 'vat-reclassify');
      const result = await extractVatBreakdown(fileBase64, effectiveMime);

      const breakdown = result?.breakdown ?? [];
      const sumBase = breakdown.reduce((s, e) => s + e.base, 0);
      const sumIva = breakdown.reduce((s, e) => s + e.iva, 0);
      const reconciled =
        breakdown.length > 0 &&
        Math.abs(sumBase - inv.subtotal) <= RECONCILE_TOLERANCE_EUR &&
        Math.abs(sumIva - inv.tax_amount) <= RECONCILE_TOLERANCE_EUR;

      if (reconciled) {
        const classification = classifyInvoiceRate(inv.tax_rate, inv.invoice_lines, inv.subtotal, inv.tax_amount, breakdown);
        const { fiscal_status, fiscal_status_reason } = computeFiscalStatus(classification, { secondPassAttempted: true });
        await prisma.invoice.update({
          where: { id: inv.id },
          data: {
            fiscal_status,
            fiscal_status_reason,
            ai_vat_breakdown: JSON.stringify(breakdown),
            vat_reclassification_attempted: true,
            vat_reclassified_at: new Date(),
          },
        });
        resolved++;
      } else {
        await prisma.invoice.update({
          where: { id: inv.id },
          data: {
            fiscal_status: 'manual_review',
            fiscal_status_reason: breakdown.length > 0 ? 'ai-unresolved-no-reconcile' : 'ai-unresolved-empty',
            vat_reclassification_attempted: true,
            vat_reclassified_at: new Date(),
          },
        });
        manualReview++;
      }
    } catch (e: any) {
      // Still mark as attempted — never retry a document whose file fetch or
      // AI call blew up, that would just fail identically forever.
      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          fiscal_status: 'manual_review',
          fiscal_status_reason: 'ai-unresolved-error',
          vat_reclassification_attempted: true,
          vat_reclassified_at: new Date(),
        },
      }).catch(() => {});
      manualReview++;
      errors.push(`${inv.id}: ${e?.message ?? 'Error desconocido'}`);
    }
  }

  const remaining = await prisma.invoice.count({
    where: {
      company_id: companyId,
      fiscal_status: { in: ['pending_classification', 'mixed_vat'] },
      vat_reclassification_attempted: false,
    },
  });

  return NextResponse.json({ attempted, resolved, manualReview, remaining, errors });
}
