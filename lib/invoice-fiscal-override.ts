// Shared, pure builder for human-confirmed document_type / fiscal_period
// changes on Invoice (Fase Gascón, 2026-09). Used by BOTH
// app/api/invoices/[id]/route.ts (company-owner side, e.g. Bárbara) and
// app/api/gestoria/clients/[clientCompanyId]/invoices/[invoiceId]/review/route.ts
// (gestoría side, e.g. Jesús Gascón) so neither route re-derives validation
// or AuditLog shape independently — see lib/invoice-fiscal-treatment.ts for
// the read-time fiscal consequences once these fields are set.
//
// Deliberately does NOT touch Prisma — callers run the update() + auditLog
// writes themselves (ideally in a $transaction, matching the existing
// gestoria review route's pattern).

export const VALID_DOCUMENT_TYPES = ['FULL_INVOICE', 'SIMPLIFIED_INVOICE'] as const;
export type DocumentTypeValue = (typeof VALID_DOCUMENT_TYPES)[number] | null;

export function isValidDocumentTypeValue(value: unknown): value is DocumentTypeValue {
  return value === null || (VALID_DOCUMENT_TYPES as readonly unknown[]).includes(value);
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
}

export interface RequestedFiscalOverride {
  document_type?: DocumentTypeValue;
  fiscal_period_year?: number | null;
  fiscal_period_quarter?: number | null;
}

export interface FiscalAuditLogEntry {
  action: 'document_type_reclassified' | 'fiscal_period_overridden';
  old_values: string; // JSON
  new_values: string; // JSON
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

  return { updateData, auditEntries };
}
