// CSV Export Generator — "facturas.csv"
//
// Root cause fixed (auditoría 2026-07-15): this used to export the raw
// Invoice.tax_rate header field with `inv.tax_rate ? x.toFixed(2) : ''`
// (falsy-0 bug: a legitimate 0% invoice printed blank, indistinguishable
// from "no data"), while resumen_fiscal.csv/detalle_iva.csv resolved the
// same invoices via classifyInvoiceRate()'s line/AI/calc fallbacks — two
// different pictures of the same data. Every fiscal field below now comes
// from lib/fiscal-breakdown.ts (getInvoiceFiscalBreakdown), the same
// function resumen_fiscal.csv and detalle_iva.csv use, so the three files
// can never disagree about whether an invoice is classified.
//
// Multi-rate format decision: one row per invoice (not one row per rate),
// with a fixed base_iva_N/cuota_iva_N column per standard rate (0/4/10/21)
// plus an "otro" column for anything outside those. This keeps
// invoice_number unique per row — Excel VLOOKUP/pivot against this file by
// invoice_number still works, and the row count still matches "número de
// facturas" everywhere else. The alternative (one row per rate touched)
// would have broken that invariant for the ~0 but possible mixed-VAT case.
import { Invoice, Document, InvoiceLine } from '@prisma/client';
import { getInvoiceFiscalBreakdown } from './fiscal-breakdown';

export interface InvoiceWithDocument extends Invoice {
  document: Document;
  invoice_lines?: InvoiceLine[];
}

// Semicolon delimiter for Excel compatibility with Spanish/European locale.
// Spanish Excel uses ";" as the list separator (regional setting).
const CSV_DELIMITER = ';';

// null/undefined -> '' ; a real number (including 0) is always printed.
// Replaces the old `value ? value.toFixed(2) : ''` pattern, which silently
// blanked out any legitimately-zero numeric field (see header comment).
function formatNumberOrBlank(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return value.toFixed(decimals);
}

export function generateCSV(invoices: InvoiceWithDocument[]): string {
  const headers = [
    'invoice_type',
    'issue_date',
    'due_date',
    'invoice_number',
    'supplier_name',
    'supplier_tax_id',
    'customer_name',
    'customer_tax_id',
    'subtotal',
    'tax_amount',
    'total_amount',
    'currency',
    'tax_rate', // raw Invoice.tax_rate header field — kept for backward compatibility; NOT the source of truth, see effective_tax_rate/estado_fiscal
    'effective_tax_rate', // single rate if the invoice touches only one bucket, "mixto" if several, '' if unclassified
    'base_iva_0', 'cuota_iva_0',
    'base_iva_4', 'cuota_iva_4',
    'base_iva_10', 'cuota_iva_10',
    'base_iva_21', 'cuota_iva_21',
    'base_iva_otro', 'cuota_iva_otro', // rate outside 0/4/10/21 (IGIC/IPSI, extraction artifact) — never silently merged into a standard bucket
    'iva_mixto', // TRUE if the invoice spans 2+ rate buckets
    'estado_fiscal', // classified | manual_review | pending_classification | mixed_vat
    'fuente_clasificacion', // line_items | invoice_header | ai | inferred | manual | unclassified
    'motivo_sin_clasificar', // populated whenever getInvoiceFiscalBreakdown has a warning, not only when fully unclassified
    'payment_method',
    'category',
    'notes',
    'extraction_confidence',
    'review_status',
    'source_channel'
  ];

  const rows = invoices.map((inv: InvoiceWithDocument) => {
    const breakdown = getInvoiceFiscalBreakdown({
      tax_rate: inv.tax_rate,
      subtotal: inv.subtotal,
      tax_amount: inv.tax_amount,
      total_amount: inv.total_amount,
      invoice_lines: (inv.invoice_lines ?? []).map((l) => ({ tax_rate: l.tax_rate, total_amount: l.total_amount })),
      ai_vat_breakdown: inv.ai_vat_breakdown,
      vat_reclassification_attempted: inv.vat_reclassification_attempted,
    });

    const touchedRates = [
      breakdown.base0 !== 0 || breakdown.vat0 !== 0 ? 0 : null,
      breakdown.base4 !== 0 || breakdown.vat4 !== 0 ? 4 : null,
      breakdown.base10 !== 0 || breakdown.vat10 !== 0 ? 10 : null,
      breakdown.base21 !== 0 || breakdown.vat21 !== 0 ? 21 : null,
      breakdown.otherBase !== 0 || breakdown.otherVat !== 0 ? -1 : null,
    ].filter((r): r is number => r !== null);
    const isMixed = touchedRates.length >= 2;
    const effectiveTaxRate = touchedRates.length === 0 ? '' : isMixed ? 'mixto' : (touchedRates[0] === -1 ? 'no estándar' : String(touchedRates[0]));

    return [
      escapeCSV(inv.invoice_type),
      inv.issue_date ? new Date(inv.issue_date).toISOString().split('T')[0] : '',
      inv.due_date ? new Date(inv.due_date).toISOString().split('T')[0] : '',
      escapeCSV(inv.invoice_number),
      escapeCSV(inv.supplier_name),
      escapeCSV(inv.supplier_tax_id || ''),
      escapeCSV(inv.customer_name),
      escapeCSV(inv.customer_tax_id || ''),
      inv.subtotal.toFixed(2),
      inv.tax_amount.toFixed(2),
      inv.total_amount.toFixed(2),
      escapeCSV(inv.currency),
      formatNumberOrBlank(inv.tax_rate),
      effectiveTaxRate,
      formatNumberOrBlank(breakdown.base0), formatNumberOrBlank(breakdown.vat0),
      formatNumberOrBlank(breakdown.base4), formatNumberOrBlank(breakdown.vat4),
      formatNumberOrBlank(breakdown.base10), formatNumberOrBlank(breakdown.vat10),
      formatNumberOrBlank(breakdown.base21), formatNumberOrBlank(breakdown.vat21),
      formatNumberOrBlank(breakdown.otherBase), formatNumberOrBlank(breakdown.otherVat),
      isMixed ? 'TRUE' : 'FALSE',
      breakdown.classificationStatus,
      breakdown.classificationSource,
      escapeCSV(breakdown.warnings.join(' | ')),
      escapeCSV(inv.payment_method || ''),
      escapeCSV(inv.category || ''),
      escapeCSV(inv.notes || ''),
      formatNumberOrBlank(inv.extraction_confidence),
      escapeCSV(inv.review_status),
      escapeCSV(inv.document?.source_channel || '')
    ];
  });

  // UTF-8 BOM (﻿) tells Excel to read the file as UTF-8, preventing
  // characters like ñ and accents from being corrupted (shown as ÃÂ¡, etc.).
  // CRLF line endings are required by RFC 4180 and expected by Excel on Windows.
  const csvContent =
    '﻿' +
    [
      headers.join(CSV_DELIMITER),
      ...rows.map((row: any[]) => row.join(CSV_DELIMITER))
    ].join('\r\n');

  return csvContent;
}

function escapeCSV(value: string): string {
  if (!value) return '';
  const s = String(value);
  if (s.includes(CSV_DELIMITER) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function getDateRange(type: 'monthly' | 'quarterly', date: Date = new Date()): { start: Date; end: Date } {
  const year = date.getFullYear();
  const month = date.getMonth();

  if (type === 'monthly') {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
    return { start, end };
  } else {
    // Quarterly exports are generated for tax filing (Modelo 303), which is
    // always done in the days right after a quarter closes (e.g. Jul 1-20
    // covers Q2/Apr-Jun) — so this must target the last COMPLETED quarter,
    // not the in-progress current one. JS Date normalizes negative months,
    // so quarter=-1 correctly rolls back to Q4 of the previous year.
    const currentQuarter = Math.floor(month / 3);
    const quarter = currentQuarter - 1;
    const start = new Date(year, quarter * 3, 1);
    const end = new Date(year, quarter * 3 + 3, 0, 23, 59, 59, 999);
    return { start, end };
  }
}
