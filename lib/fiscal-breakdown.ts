// Single normalized fiscal-VAT view of an Invoice — the ONE thing every
// exporter (facturas.csv, resumen_fiscal.csv, detalle_iva.csv, paquete
// trimestral, UI) should read instead of touching Invoice.tax_rate directly.
//
// Root cause this fixes (auditoría 2026-07-15): facturas.csv used to export
// the raw Invoice.tax_rate header field (null on ~57% of BYOU Q2 rows),
// while resumen_fiscal.csv/detalle_iva.csv used classifyInvoiceRate() with
// line/AI/calc fallbacks — two different views of the same invoice that were
// bound to disagree. This module wraps lib/iva-classification.ts (rate
// resolution) and lib/fiscal-status.ts (persisted status) once, so every
// caller sees the same numbers.
//
// Preference order (delegated to classifyInvoiceRate): line-level rates that
// agree > a reconciled multi-rate line split > header tax_rate > a one-shot
// AI VAT breakdown already persisted > a math-only inference from base+cuota
// (flagged, never silent) > unclassified (manual review, never guessed).
import {
  classifyInvoiceRate,
  IvaClassification,
  IvaClassificationSource,
  IvaLineInput,
  IvaRateBreakdownEntry,
} from './iva-classification';
import { computeFiscalStatus, FiscalStatus } from './fiscal-status';

const STANDARD_RATES = [0, 4, 10, 21] as const;
const RECONCILE_TOLERANCE_EUR = 0.15; // same tolerance classifyInvoiceRate uses internally

export type ClassificationSource =
  | 'line_items'
  | 'invoice_header'
  | 'ai'
  | 'inferred'
  | 'manual'
  | 'unclassified';

export type ClassificationConfidence = 'verified' | 'inferred' | 'unresolved';

export interface FiscalBreakdownInput {
  tax_rate: number | null | undefined;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  invoice_lines: IvaLineInput[];
  ai_vat_breakdown?: string | null;
  vat_reclassification_attempted?: boolean;
}

export interface FiscalBreakdown {
  base0: number; vat0: number;
  base4: number; vat4: number;
  base10: number; vat10: number;
  base21: number; vat21: number;
  // Base/cuota at a rate outside 0/4/10/21 (IGIC, IPSI, an OCR artifact).
  // Never silently folded into the nearest standard bucket — that would
  // misstate the return. Always accompanied by a warning.
  otherBase: number;
  otherVat: number;
  totalBase: number;
  totalVat: number;
  total: number;
  classificationStatus: FiscalStatus; // 'classified' | 'pending_classification' | 'mixed_vat' | 'manual_review'
  classificationStatusReason: string; // machine reason code — see lib/fiscal-status.ts / lib/fiscal-manual-review.ts REASON_LABELS
  classificationSource: ClassificationSource;
  confidence: ClassificationConfidence;
  warnings: string[];
  // Underlying classification, for callers that need the raw source/reason
  // (e.g. lib/iva-classification.ts#ivaClassificationObservation).
  raw: IvaClassification;
}

const SOURCE_MAP: Record<IvaClassificationSource, ClassificationSource> = {
  lines: 'line_items',
  'lines-split': 'line_items',
  header: 'invoice_header',
  'ai-vat': 'ai',
  calc: 'inferred',
  unclassified: 'unclassified',
};

const CONFIDENCE_MAP: Record<IvaClassificationSource, ClassificationConfidence> = {
  lines: 'verified',
  'lines-split': 'verified',
  header: 'verified',
  'ai-vat': 'verified',
  calc: 'inferred',
  unclassified: 'unresolved',
};

type Buckets = Pick<
  FiscalBreakdown,
  'base0' | 'vat0' | 'base4' | 'vat4' | 'base10' | 'vat10' | 'base21' | 'vat21' | 'otherBase' | 'otherVat'
>;

function emptyBuckets(): Buckets {
  return { base0: 0, vat0: 0, base4: 0, vat4: 0, base10: 0, vat10: 0, base21: 0, vat21: 0, otherBase: 0, otherVat: 0 };
}

function addToBucket(buckets: Buckets, rate: number, base: number, vat: number, warnings: string[]): void {
  const rounded = Math.round(rate);
  switch (rounded) {
    case 0: buckets.base0 += base; buckets.vat0 += vat; return;
    case 4: buckets.base4 += base; buckets.vat4 += vat; return;
    case 10: buckets.base10 += base; buckets.vat10 += vat; return;
    case 21: buckets.base21 += base; buckets.vat21 += vat; return;
    default:
      buckets.otherBase += base;
      buckets.otherVat += vat;
      warnings.push(
        `Tipo de IVA no estándar (${rate}%): ${base.toFixed(2)} € de base no incluidos en los tipos 0/4/10/21 — revisar manualmente`,
      );
  }
}

function parseAiBreakdown(json: string | null | undefined): IvaRateBreakdownEntry[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function getInvoiceFiscalBreakdown(invoice: FiscalBreakdownInput): FiscalBreakdown {
  const aiBreakdown = parseAiBreakdown(invoice.ai_vat_breakdown);
  const classification = classifyInvoiceRate(
    invoice.tax_rate ?? null,
    invoice.invoice_lines,
    invoice.subtotal,
    invoice.tax_amount,
    aiBreakdown,
  );

  const buckets = emptyBuckets();
  const warnings: string[] = [];

  if (classification.breakdown) {
    for (const entry of classification.breakdown) {
      addToBucket(buckets, entry.rate, entry.base, entry.iva, warnings);
    }
    // lines-split is reconciled against the header by construction
    // (classifyInvoiceRate only returns it when it already matches within
    // tolerance); an ai-vat multi-rate answer is NOT checked anywhere else —
    // surface it here rather than trust it silently.
    if (classification.source === 'ai-vat') {
      const sumBase = classification.breakdown.reduce((s, e) => s + e.base, 0);
      const sumVat = classification.breakdown.reduce((s, e) => s + e.iva, 0);
      if (
        Math.abs(sumBase - invoice.subtotal) > RECONCILE_TOLERANCE_EUR ||
        Math.abs(sumVat - invoice.tax_amount) > RECONCILE_TOLERANCE_EUR
      ) {
        warnings.push(
          `El desglose de IVA obtenido por IA (${sumBase.toFixed(2)} € base / ${sumVat.toFixed(2)} € cuota) no cuadra con la cabecera (${invoice.subtotal.toFixed(2)} € / ${invoice.tax_amount.toFixed(2)} €) — revisar manualmente`,
        );
      }
    }
  } else if (classification.rate !== null) {
    addToBucket(buckets, classification.rate, invoice.subtotal, invoice.tax_amount, warnings);
  }
  // classification.rate === null && no breakdown => unclassified: buckets
  // stay at 0, but totalBase/totalVat/total below still carry the invoice's
  // real amounts — an unresolved rate never means "this invoice is worth 0".

  const { fiscal_status, fiscal_status_reason } = computeFiscalStatus(classification, {
    secondPassAttempted: invoice.vat_reclassification_attempted,
  });

  if (classification.source === 'unclassified') {
    warnings.push(
      classification.unclassifiedReason === 'multi-rate-unreconciled'
        ? 'Líneas con varios tipos de IVA que no cuadran con la cabecera — revisión manual'
        : 'Sin tipo de IVA en cabecera ni en líneas de detalle — revisión manual',
    );
  } else if (classification.source === 'calc') {
    warnings.push(
      'Tipo de IVA inferido matemáticamente a partir de base y cuota (sin cabecera ni líneas) — no verificado contra el documento original',
    );
  }

  return {
    ...buckets,
    totalBase: invoice.subtotal,
    totalVat: invoice.tax_amount,
    total: invoice.total_amount,
    classificationStatus: fiscal_status,
    classificationStatusReason: fiscal_status_reason,
    classificationSource: SOURCE_MAP[classification.source],
    confidence: CONFIDENCE_MAP[classification.source],
    warnings,
    raw: classification,
  };
}
