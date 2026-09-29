// Conservative, advisory-only classifier for Invoice.suggested_document_type
// (Fase Gascón, 2026-09). Pure, DB-agnostic, no Gemini calls — uses only
// fields already present in the current extraction (lib/ai-extraction.ts).
// Mirrors lib/invoice-type-classifier.ts style.
//
// NEVER returns a value that gets written to Invoice.document_type directly —
// only to suggested_document_type, which lib/fiscal-summary.ts and
// lib/economic-summary.ts never read. Only a human PATCH confirms
// document_type. See lib/invoice-fiscal-treatment.ts for the fiscal
// consequences once confirmed.
//
// Signal priority (conservative by construction):
//   1. Recipient tax-id identification (recipient_tax_id / customer_tax_id) —
//      PRIMARY and REQUIRED signal. If either is present, the document is
//      never suggested as simplified, full stop.
//   2. Explicit "factura simplificada" / "ticket" text in an already-extracted
//      field — corroborating signal, only consulted once (1) already points
//      away from a fully-identified recipient.
//   3. total_amount < 400€ (Spanish legal threshold for simplified invoices) —
//      TERTIARY signal only. Never sufficient alone — always requires (1) to
//      already indicate an unidentified recipient. Per explicit product
//      decision: amount is never a determining rule on its own.
// Any other combination → null (no suggestion) rather than guessing.

export type DocumentTypeSuggestion = 'FULL_INVOICE' | 'SIMPLIFIED_INVOICE' | null;

const SIMPLIFIED_TEXT_SIGNAL = /factura\s+simplificada|\bticket\b/i;
const SIMPLIFIED_AMOUNT_THRESHOLD_EUR = 400;

export interface DocumentTypeSignalsInput {
  recipient_tax_id: string | null | undefined;
  customer_tax_id: string | null | undefined;
  total_amount: number | null | undefined;
  category: string | null | undefined;
  notes: string | null | undefined;
  invoice_number: string | null | undefined;
}

function hasValue(v: string | null | undefined): boolean {
  return !!v && v.trim() !== '';
}

export function suggestDocumentType(input: DocumentTypeSignalsInput): DocumentTypeSuggestion {
  const recipientIdentified = hasValue(input.recipient_tax_id) || hasValue(input.customer_tax_id);

  if (recipientIdentified) {
    return 'FULL_INVOICE';
  }

  const textSignal =
    SIMPLIFIED_TEXT_SIGNAL.test(input.category ?? '') ||
    SIMPLIFIED_TEXT_SIGNAL.test(input.notes ?? '') ||
    SIMPLIFIED_TEXT_SIGNAL.test(input.invoice_number ?? '');

  if (textSignal) {
    return 'SIMPLIFIED_INVOICE';
  }

  const amountSignal =
    typeof input.total_amount === 'number' &&
    input.total_amount > 0 &&
    input.total_amount < SIMPLIFIED_AMOUNT_THRESHOLD_EUR;

  if (amountSignal) {
    return 'SIMPLIFIED_INVOICE';
  }

  // Recipient not identified, but no corroborating signal either — not
  // confident enough to suggest anything. Never force a guess.
  return null;
}
