// Pure, DB-agnostic evaluator for the exception-based review shadow engine
// (Fase 1+2 — SHADOW MODE ONLY, see lib/invoice-decision.ts for the
// persistence wrapper that actually writes InvoiceDecision rows). Mirrors
// the style of lib/iva-classification.ts / lib/duplicate-detection.ts: no
// Prisma import, no I/O — every signal is passed in by the caller.
//
// Conservative by construction: any HARD gate that fails routes to
// REVIEW_REQUIRED. AUTO_APPROVED requires every gate to pass — never
// inferred from a single confidence score (see EXTRACTION_CONFIDENCE gate:
// it is a floor, not a sufficient condition on its own).
//
// The 7 gates and their exact PASS/FAIL/MISSING-DATA behaviour are
// documented in the approved implementation plan. Each one reads a signal
// that lib/document-processing.ts already has in memory at the chosen
// integration point (right after the fiscal_status block) — this module
// adds no new queries.

export const ENGINE_VERSION = 'v1';

export type GateName =
  | 'EXTRACTION_COMPLETE'
  | 'EXTRACTION_CONFIDENCE'
  | 'ARITHMETIC_VALID'
  | 'FISCAL_CLASSIFICATION_VALID'
  | 'NOT_DUPLICATE'
  | 'SUPPLIER_TAX_ID_PRESENT'
  | 'ISSUED_RECEIVED_CONFIRMED';

export type ShadowDecision = 'AUTO_APPROVED' | 'REVIEW_REQUIRED';

export interface FailedGate {
  gate: GateName;
  reason: string;
}

export interface EvaluationResult {
  decision: ShadowDecision;
  rules_evaluated: GateName[];
  rules_passed: GateName[];
  rules_failed: FailedGate[];
  signals: Record<string, unknown>;
}

const ARITHMETIC_TOLERANCE_EUR = 0.5;
const CONFIDENCE_GATE = 0.7;

export interface EvaluateInvoiceDecisionInput {
  extraction: {
    invoice_number: string | null | undefined;
    issue_date: string | null | undefined;
    supplier_name: string | null | undefined;
    customer_name: string | null | undefined;
    total_amount: number;
    extraction_confidence: number;
  };
  invoice: {
    subtotal: number;
    tax_amount: number;
    total_amount: number;
    invoice_type: string; // 'received' | 'issued'
    supplier_tax_id: string | null | undefined;
  };
  /** Invoice.fiscal_status, already computed by computeFiscalStatus() upstream. */
  fiscalStatus: string;
  /**
   * dupResult.probableMatches.length from lib/duplicate-detection.ts#checkDuplicate().
   * dupResult.strongMatch is always null at the chosen integration point — a
   * strong match short-circuits invoice creation entirely upstream, so this
   * gate can only ever see probable matches in production. See NOT_DUPLICATE.
   */
  duplicateProbableMatchCount: number;
  /**
   * classification.needs_review === false, where `classification` is the
   * ClassificationResult already returned by
   * lib/invoice-type-classifier.ts#classifyInvoiceType() upstream in
   * lib/document-processing.ts. No classification logic is duplicated here.
   */
  invoiceTypeConfirmed: boolean;
}

/**
 * Evaluates the 7 HARD gates against already-computed signals and returns a
 * shadow decision. Never throws for well-formed input — every branch is a
 * pure boolean/arithmetic check. Callers that need extra safety around
 * malformed input should still wrap this in try/catch (see
 * lib/invoice-decision.ts), since it is the module responsible for
 * persistence and conservative fallback on unexpected errors.
 */
export function evaluateInvoiceDecision(input: EvaluateInvoiceDecisionInput): EvaluationResult {
  const { extraction, invoice, fiscalStatus, duplicateProbableMatchCount, invoiceTypeConfirmed } = input;

  const rules_evaluated: GateName[] = [];
  const rules_passed: GateName[] = [];
  const rules_failed: FailedGate[] = [];

  function gate(name: GateName, passed: boolean, reason: string) {
    rules_evaluated.push(name);
    if (passed) rules_passed.push(name);
    else rules_failed.push({ gate: name, reason });
  }

  // 1. EXTRACTION_COMPLETE — critical fields present, total > 0.
  const criticalMissing =
    !extraction.invoice_number ||
    !extraction.issue_date ||
    !extraction.supplier_name ||
    !extraction.customer_name ||
    !(extraction.total_amount > 0);
  gate('EXTRACTION_COMPLETE', !criticalMissing, 'critical_fields_missing');

  // 2. EXTRACTION_CONFIDENCE — floor only, never sufficient alone.
  const confidence = typeof extraction.extraction_confidence === 'number' ? extraction.extraction_confidence : 0;
  gate('EXTRACTION_CONFIDENCE', confidence >= CONFIDENCE_GATE, 'low_extraction_confidence');

  // 3. ARITHMETIC_VALID — header-level subtotal + tax ≈ total.
  const arithmeticDelta = Math.abs(invoice.subtotal + invoice.tax_amount - invoice.total_amount);
  gate('ARITHMETIC_VALID', arithmeticDelta <= ARITHMETIC_TOLERANCE_EUR, 'arithmetic_mismatch');

  // 4. FISCAL_CLASSIFICATION_VALID — VAT rate fully resolved.
  gate('FISCAL_CLASSIFICATION_VALID', fiscalStatus === 'classified', `fiscal_status_${fiscalStatus}`);

  // 5. NOT_DUPLICATE — no probable duplicate match (strong matches never
  // reach this point, see field doc above).
  gate('NOT_DUPLICATE', duplicateProbableMatchCount === 0, 'possible_duplicate');

  // 6. SUPPLIER_TAX_ID_PRESENT — Spanish fiscal deducibility minimum for
  // received invoices.
  const supplierTaxIdOk = invoice.invoice_type !== 'received' || !!invoice.supplier_tax_id;
  gate('SUPPLIER_TAX_ID_PRESENT', supplierTaxIdOk, 'missing_supplier_tax_id');

  // 7. ISSUED_RECEIVED_CONFIRMED — reuses the existing classifyInvoiceType()
  // result verbatim. See lib/invoice-type-classifier.ts — not reimplemented.
  gate('ISSUED_RECEIVED_CONFIRMED', invoiceTypeConfirmed === true, 'invoice_type_unconfirmed');

  const decision: ShadowDecision = rules_failed.length === 0 ? 'AUTO_APPROVED' : 'REVIEW_REQUIRED';

  const signals = {
    extraction_confidence: confidence,
    arithmetic_delta_eur: Math.round(arithmeticDelta * 100) / 100,
    fiscal_status: fiscalStatus,
    duplicate_probable_match_count: duplicateProbableMatchCount,
    invoice_type: invoice.invoice_type,
    invoice_type_confirmed: invoiceTypeConfirmed,
    supplier_tax_id_present: !!invoice.supplier_tax_id,
  };

  return { decision, rules_evaluated, rules_passed, rules_failed, signals };
}
