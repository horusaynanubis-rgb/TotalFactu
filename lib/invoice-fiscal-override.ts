// Shared, pure builder for human-confirmed document_type / fiscal_period /
// vat_treatment_override changes on Invoice (Fase Gascón, 2026-09; extended
// 2026-09-30 for the vat_treatment_override "AIGÜES" case). Used by BOTH
// app/api/invoices/[id]/route.ts (company-owner side, e.g. Bárbara) and
// app/api/gestoria/clients/[clientCompanyId]/invoices/[invoiceId]/review/route.ts
// (gestoría side, e.g. Jesús Gascón) so neither route re-derives validation
// or AuditLog shape independently — see lib/invoice-fiscal-treatment.ts for
// the read-time fiscal consequences once these fields are set (that file
// owns VAT_TREATMENT_OVERRIDE_CODES; this one only imports it to validate).
//
// Deliberately does NOT touch Prisma — callers run the update() + auditLog
// writes themselves (ideally in a $transaction, matching the existing
// gestoria review route's pattern).
import { VAT_TREATMENT_OVERRIDE_CODES, VatTreatmentOverrideCode } from './invoice-fiscal-treatment';

export const VALID_DOCUMENT_TYPES = ['FULL_INVOICE', 'SIMPLIFIED_INVOICE'] as const;
export type DocumentTypeValue = (typeof VALID_DOCUMENT_TYPES)[number] | null;

export function isValidDocumentTypeValue(value: unknown): value is DocumentTypeValue {
  return value === null || (VALID_DOCUMENT_TYPES as readonly unknown[]).includes(value);
}

export type VatTreatmentOverrideValue = VatTreatmentOverrideCode | null;

export function isValidVatTreatmentOverrideValue(value: unknown): value is VatTreatmentOverrideValue {
  return value === null || (VAT_TREATMENT_OVERRIDE_CODES as readonly unknown[]).includes(value);
}

/** Both null (clearing an override) or both a valid (year, quarter) pair — never one without the other. */
export function isValidFiscalPeriodValue(year: unknown, quarter: unknown): boolean {
  if (year === null && quarter === null) return true;
  return (
    Number.isInteger(year) &&
    Number.isInteger(quarter) &&
    (quarter as number) >= 1 &&
    (quarter as number) <= 4 &&
    (year as number) >= 2000 &&
    (year as number) <= 2100
  );
}

export interface CurrentFiscalFields {
  document_type: string | null;
  fiscal_period_year: number | null;
  fiscal_period_quarter: number | null;
  vat_treatment_override: string | null;
  vat_treatment_override_note: string | null;
}

export interface RequestedFiscalOverride {
  document_type?: DocumentTypeValue;
  fiscal_period_year?: number | null;
  fiscal_period_quarter?: number | null;
  vat_treatment_override?: VatTreatmentOverrideValue;
  vat_treatment_override_note?: string | null;
}

export interface FiscalAuditLogEntry {
  action: 'document_type_reclassified' | 'fiscal_period_overridden' | 'vat_treatment_overridden';
  old_values: string; // JSON
  new_values: string; // JSON
}

/**
 * vat_treatment_override is only meaningful for a FULL_INVOICE — combining it
 * with SIMPLIFIED_INVOICE would express two conflicting non-deductibility
 * reasons on the same invoice at once. `resolvedDocumentType` is whatever
 * document_type the invoice will actually have AFTER this request (the
 * requested value if the caller is changing it, otherwise the current one) —
 * callers compute that themselves since only they know whether
 * 'document_type' was present in the request body.
 */
export function isVatTreatmentOverrideConsistentWithDocumentType(
  resolvedDocumentType: DocumentTypeValue,
  vatTreatmentOverride: VatTreatmentOverrideValue,
): boolean {
  return vatTreatmentOverride === null || resolvedDocumentType !== 'SIMPLIFIED_INVOICE';
}

export interface BuildFiscalOverrideResult {
  updateData: Record<string, unknown>;
  auditEntries: FiscalAuditLogEntry[];
}

/**
 * Computes the Prisma update payload + AuditLog entries for a document_type
 * and/or fiscal_period change. No-ops (value unchanged from current) produce
 * neither an update field nor an audit entry for that specific field — so a
 * PATCH that resends the same value is silent, not a spurious log line.
 *
 * document_type_classified_by/at and fiscal_period_set_by/at are ALWAYS
 * server-derived here (userId, now) — callers must never let a client body
 * set those directly (see the two API routes' whitelists).
 */
export function buildFiscalOverrideUpdate(
  current: CurrentFiscalFields,
  requested: RequestedFiscalOverride,
  userId: string,
  now: Date = new Date(),
): BuildFiscalOverrideResult {
  const updateData: Record<string, unknown> = {};
  const auditEntries: FiscalAuditLogEntry[] = [];

  if ('document_type' in requested && requested.document_type !== current.document_type) {
    updateData.document_type = requested.document_type ?? null;
    updateData.document_type_classified_by = userId;
    updateData.document_type_classified_at = now;
    auditEntries.push({
      action: 'document_type_reclassified',
      old_values: JSON.stringify({ document_type: current.document_type }),
      new_values: JSON.stringify({ document_type: requested.document_type ?? null }),
    });
  }

  const fiscalPeriodRequested = 'fiscal_period_year' in requested || 'fiscal_period_quarter' in requested;
  if (fiscalPeriodRequested) {
    const newYear = requested.fiscal_period_year ?? null;
    const newQuarter = requested.fiscal_period_quarter ?? null;
    if (newYear !== current.fiscal_period_year || newQuarter !== current.fiscal_period_quarter) {
      updateData.fiscal_period_year = newYear;
      updateData.fiscal_period_quarter = newQuarter;
      updateData.fiscal_period_set_by = userId;
      updateData.fiscal_period_set_at = now;
      auditEntries.push({
        action: 'fiscal_period_overridden',
        old_values: JSON.stringify({
          fiscal_period_year: current.fiscal_period_year,
          fiscal_period_quarter: current.fiscal_period_quarter,
        }),
        new_values: JSON.stringify({ fiscal_period_year: newYear, fiscal_period_quarter: newQuarter }),
      });
    }
  }

  if ('vat_treatment_override' in requested) {
    const newOverride = requested.vat_treatment_override ?? null;
    const newNote = requested.vat_treatment_override_note ?? null;
    if (newOverride !== current.vat_treatment_override || newNote !== current.vat_treatment_override_note) {
      updateData.vat_treatment_override = newOverride;
      updateData.vat_treatment_override_note = newNote;
      updateData.vat_treatment_override_set_by = userId;
      updateData.vat_treatment_override_set_at = now;
      auditEntries.push({
        action: 'vat_treatment_overridden',
        old_values: JSON.stringify({
          vat_treatment_override: current.vat_treatment_override,
          vat_treatment_override_note: current.vat_treatment_override_note,
        }),
        new_values: JSON.stringify({ vat_treatment_override: newOverride, vat_treatment_override_note: newNote }),
      });
    }
  }

  return { updateData, auditEntries };
}
