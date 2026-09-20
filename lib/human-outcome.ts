// Pure classifier for "what did a human actually do with this invoice",
// used to compare shadow decisions against real gestoria/client outcomes
// (see approved plan §7 and §8). Not wired into the processing pipeline —
// human review happens days or weeks after a document is processed, so this
// is invoked by future read-only metrics scripts, never from
// lib/document-processing.ts.
//
// Critical rule this encodes: absence of a correction is NOT the same as
// confirmation. A factura nobody has looked at yet must never be counted as
// "Barbara said it was fine".
//
// No DB access here — the caller fetches InvoiceReviewLog/
// InvoiceCorrectionProposal/AuditLog rows and passes in the derived booleans.

export type HumanOutcome = 'HUMAN_CONFIRMED' | 'HUMAN_CORRECTED' | 'NOT_REVIEWED' | 'UNKNOWN';

// InvoiceReviewLog.action values that indicate gestoria flagged a problem.
const NEGATIVE_REVIEW_LOG_ACTIONS = new Set(['mark_incorrect', 'correction_detected']);

// Invoice.gestoria_review_status values that already mean "something was corrected".
const CORRECTED_STATUSES = new Set(['reviewed_issue', 'corrected']);

export interface HumanOutcomeInput {
  /** Invoice.gestoria_review_status as currently stored. */
  gestoriaReviewStatus: string | null | undefined;
  /** InvoiceReviewLog.action values for this invoice, any order. */
  reviewLogActions: string[];
  /** True if any InvoiceCorrectionProposal for this invoice has status='accepted'. */
  hasAcceptedCorrectionProposal: boolean;
  /**
   * True if there is at least one AuditLog 'update' entry for this invoice
   * that isn't already captured by the gestoria review/correction flow
   * (e.g. the self-service edit modal). Optional — defaults to false, which
   * is the conservative direction for NOT_REVIEWED (see below): omitting
   * this signal can only ever move a result from NOT_REVIEWED to UNKNOWN
   * less often, never the reverse silently.
   */
  hasDirectEdit?: boolean;
}

/**
 * Four states, not two. NOT_REVIEWED and UNKNOWN are deliberately distinct:
 * NOT_REVIEWED means zero human touchpoints of any kind were found.
 * UNKNOWN means some touchpoint exists but doesn't resolve cleanly to
 * confirmed or corrected (e.g. an unrelated field edit). Neither is treated
 * as "confirmed correct".
 */
export function classifyHumanOutcome(input: HumanOutcomeInput): HumanOutcome {
  const { gestoriaReviewStatus, reviewLogActions, hasAcceptedCorrectionProposal, hasDirectEdit = false } = input;

  const hasNegativeLog = reviewLogActions.some((action) => NEGATIVE_REVIEW_LOG_ACTIONS.has(action));
  const statusIndicatesCorrection = !!gestoriaReviewStatus && CORRECTED_STATUSES.has(gestoriaReviewStatus);

  if (hasNegativeLog || hasAcceptedCorrectionProposal || statusIndicatesCorrection) {
    return 'HUMAN_CORRECTED';
  }

  if (gestoriaReviewStatus === 'reviewed_ok') {
    return 'HUMAN_CONFIRMED';
  }

  const untouchedStatus =
    gestoriaReviewStatus == null ||
    gestoriaReviewStatus === 'pending_review' ||
    gestoriaReviewStatus === 'legacy_unreviewed';

  if (untouchedStatus && reviewLogActions.length === 0 && !hasAcceptedCorrectionProposal && !hasDirectEdit) {
    return 'NOT_REVIEWED';
  }

  return 'UNKNOWN';
}
