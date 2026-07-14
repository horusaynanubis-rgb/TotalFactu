// Maps the read-time IvaClassification (lib/iva-classification.ts) to the
// persisted Invoice.fiscal_status. Kept separate from that module because
// this is the one place that decides the DB-facing status string — the
// classification logic itself doesn't know about persistence.
import { IvaClassification } from './iva-classification';

export type FiscalStatus = 'classified' | 'pending_classification' | 'mixed_vat' | 'manual_review';

export interface FiscalStatusResult {
  fiscal_status: FiscalStatus;
  fiscal_status_reason: string;
}

export function computeFiscalStatus(
  c: IvaClassification,
  opts?: { secondPassAttempted?: boolean },
): FiscalStatusResult {
  if (c.source !== 'unclassified') {
    return { fiscal_status: 'classified', fiscal_status_reason: c.source };
  }

  // Second pass already ran (lib/ai-extraction.ts extractVatBreakdown) and
  // still couldn't resolve it — terminal state, never retried automatically.
  if (opts?.secondPassAttempted) {
    return {
      fiscal_status: 'manual_review',
      fiscal_status_reason: c.unclassifiedReason === 'multi-rate-unreconciled' ? 'ai-unresolved-multi-rate' : 'ai-unresolved-no-data',
    };
  }

  return c.unclassifiedReason === 'multi-rate-unreconciled'
    ? { fiscal_status: 'mixed_vat', fiscal_status_reason: 'multi-rate-unreconciled' }
    : { fiscal_status: 'pending_classification', fiscal_status_reason: 'no-data' };
}
