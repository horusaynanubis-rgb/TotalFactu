// Reprocess-safety for human fiscal decisions on Invoice (Fase Gascón, 2026-09).
//
// lib/document-processing.ts#processDocument() deletes and recreates the
// Invoice row from scratch on every retry ("If retrying, delete existing
// records first"). That is harmless for extraction-derived fields (they are
// meant to be refreshed), but document_type and fiscal_period are fields a
// HUMAN can explicitly confirm/override — a reprocess run weeks later must
// never silently erase that decision.
//
// Pure, DB-agnostic — mirrors lib/document-dedup.ts#evaluateDuplicate() style
// so it can be unit-tested without Prisma. The caller (processDocument) is
// responsible for reading the old Invoice before deleting it and merging the
// result of this function into the freshly built invoiceData before create().

export interface PreservableFiscalFields {
  document_type: string | null;
  suggested_document_type: string | null;
  document_type_classified_by: string | null;
  document_type_classified_at: Date | null;
  fiscal_period_year: number | null;
  fiscal_period_quarter: number | null;
  fiscal_period_set_by: string | null;
  fiscal_period_set_at: Date | null;
  vat_treatment_override: string | null;
  vat_treatment_override_note: string | null;
  vat_treatment_override_set_by: string | null;
  vat_treatment_override_set_at: Date | null;
}

export type PreservedFiscalFields = Partial<PreservableFiscalFields>;

/**
 * Given the Invoice row about to be deleted during a reprocess, returns only
 * the subset of fiscal fields a human actually confirmed — extraction-derived
 * suggestions are intentionally NOT carried over, since a reprocess is
 * expected to recompute those fresh from the (possibly re-extracted) document.
 *
 * - document_type is preserved only if a human confirmed it
 *   (document_type_classified_by is set). A merely-suggested, never-confirmed
 *   document_type is dropped so the next processing attempt can suggest again
 *   from scratch.
 * - fiscal_period_year/quarter is preserved only if a human explicitly set it
 *   (fiscal_period_set_by is set) — i.e. only for manual overrides, never for
 *   a still-untouched NULL.
 * - vat_treatment_override (+ its note) is preserved only if a human
 *   explicitly set it (vat_treatment_override_set_by is set) — same
 *   criterion as document_type, kept as its own independent check since the
 *   two are independent decisions (see lib/invoice-fiscal-treatment.ts).
 */
export function extractPreservedFiscalFields(
  oldInvoice: PreservableFiscalFields,
): PreservedFiscalFields {
  const preserved: PreservedFiscalFields = {};

  if (oldInvoice.document_type_classified_by) {
    preserved.document_type = oldInvoice.document_type;
    preserved.document_type_classified_by = oldInvoice.document_type_classified_by;
    preserved.document_type_classified_at = oldInvoice.document_type_classified_at;
  }

  if (oldInvoice.fiscal_period_set_by) {
    preserved.fiscal_period_year = oldInvoice.fiscal_period_year;
    preserved.fiscal_period_quarter = oldInvoice.fiscal_period_quarter;
    preserved.fiscal_period_set_by = oldInvoice.fiscal_period_set_by;
    preserved.fiscal_period_set_at = oldInvoice.fiscal_period_set_at;
  }

  if (oldInvoice.vat_treatment_override_set_by) {
    preserved.vat_treatment_override = oldInvoice.vat_treatment_override;
    preserved.vat_treatment_override_note = oldInvoice.vat_treatment_override_note;
    preserved.vat_treatment_override_set_by = oldInvoice.vat_treatment_override_set_by;
    preserved.vat_treatment_override_set_at = oldInvoice.vat_treatment_override_set_at;
  }

  return preserved;
}
