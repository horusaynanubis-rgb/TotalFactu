// Shared IVA-rate classification for an invoice, used by both
// lib/fiscal-summary.ts (aggregate rate breakdown) and lib/iva-detalle.ts
// (per-invoice detail listing) so the two never disagree on which bucket an
// invoice falls into.
//
// Why this exists: Invoice.tax_rate (header) is frequently null on
// OCR-extracted invoices, and InvoiceLine.total_amount is not reliably
// gross-vs-net across documents (depends on what the source invoice printed),
// so we never derive a base/cuota split from line amounts. The only line-level
// signal trusted here is the tax_rate itself — if every line agrees on one
// rate, that rate is used together with the (internally consistent) header
// subtotal/tax_amount. Anything else is left unclassified rather than guessed.
export type IvaClassificationSource = 'header' | 'lines' | 'unclassified';

export interface IvaClassification {
  rate: number | null; // null = sin clasificar
  source: IvaClassificationSource;
}

export function classifyInvoiceRate(
  headerTaxRate: number | null | undefined,
  lineTaxRates: (number | null | undefined)[],
): IvaClassification {
  if (headerTaxRate !== null && headerTaxRate !== undefined) {
    return { rate: headerTaxRate, source: 'header' };
  }
  const distinct = Array.from(
    new Set(lineTaxRates.filter((r): r is number => r !== null && r !== undefined)),
  );
  if (distinct.length === 1) {
    return { rate: distinct[0], source: 'lines' };
  }
  return { rate: null, source: 'unclassified' };
}

export function ivaClassificationObservation(c: IvaClassification, hasLines: boolean): string {
  if (c.source === 'header') return '';
  if (c.source === 'lines') return 'Tipo de IVA inferido desde las líneas de factura (cabecera sin tipo)';
  if (!hasLines) return 'Sin tipo de IVA en cabecera y sin líneas de detalle — revisar factura';
  return 'Líneas con varios tipos de IVA distintos — no se reparte automáticamente, revisar factura';
}
