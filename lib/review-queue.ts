// Review queue membership (Fase Gascón — "clasificación fiscal pendiente",
// 2026-09). An invoice belongs in the review queue for one of two
// independent reasons:
//   (a) it has never been reviewed at all (review_status === 'pending'), or
//   (b) it is missing a human-confirmed document_type despite having a
//       suggestion (document_type IS NULL AND suggested_document_type IS
//       NOT NULL) — regardless of review_status, since an invoice can
//       already be fully approved on every other field and still need only
//       this one decision (e.g. historical invoices reviewed before this
//       feature existed).
//
// No new status system: (b) reuses document_type/suggested_document_type,
// already added by the Fase Gascón migration, and the same edit UI in
// app/(dashboard)/dashboard/review/page.tsx that lets a human pick
// FULL_INVOICE / SIMPLIFIED_INVOICE. Once document_type is confirmed
// (no longer NULL), condition (b) stops matching and the invoice drops out
// of the queue on the next fetch — no extra bookkeeping required.
//
// reviewQueueInvoiceWhere() is the single source of truth for the DB-level
// condition (used directly by GET /api/review). isInReviewQueue() /
// isFiscalClassificationPending() are pure mirrors of the same logic, kept
// here so both the route and tests use the exact same rule instead of two
// hand-copied versions — this repo's test scripts don't mock Prisma (see
// scripts/test-gestoria-eligibility.ts), so behavior tests exercise the pure
// functions directly with sample data.

export function reviewQueueInvoiceWhere(companyId: string) {
  return {
    company_id: companyId,
    OR: [
      { review_status: 'pending' },
      { document_type: null, suggested_document_type: { not: null } },
    ],
  };
}

export interface ReviewQueueInvoiceInput {
  review_status: string;
  document_type: string | null;
  suggested_document_type: string | null;
}

// (b) above — also used by the UI to label these items distinctly from
// genuine extraction-quality reasons (low confidence, missing fields): this
// is a pending decision, not a processing error.
export function isFiscalClassificationPending(inv: ReviewQueueInvoiceInput): boolean {
  return inv.document_type === null && inv.suggested_document_type !== null;
}

export function isInReviewQueue(inv: ReviewQueueInvoiceInput): boolean {
  return inv.review_status === 'pending' || isFiscalClassificationPending(inv);
}
