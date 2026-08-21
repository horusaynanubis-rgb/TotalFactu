/**
 * invoice-type-classifier.ts
 *
 * Determines the correct invoice_type ("received" | "issued") by comparing
 * the extracted supplier/customer data against the current company's identity.
 *
 * Rule:
 *   - Company appears as supplier  → "issued"   (we sold/sent this invoice)
 *   - Company appears as customer  → "received" (we received this invoice)
 *   - No clear match               → keep AI guess, force needs_review = true
 *
 * Priority order:
 *   1. tax_id exact match  (most reliable)
 *   2. normalized name match (substring, min 5 chars to avoid false positives)
 *
 * This module is pure: it never reads from or writes to the database.
 */

import { InvoiceExtraction } from './ai-extraction';

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

const LEGAL_SUFFIXES =
  /[\s,]+(s\.?l\.?u?\.?|s\.?a\.?s?\.?|ltd\.?|limited|inc\.?|llc\.?|gmbh|b\.?v\.?|n\.?v\.?|a\.?s\.?|s\.?l\.?)\s*$/i;

/**
 * Strips accents, lowercase, removes common legal-form suffixes and punctuation.
 * "HORUS NETWORK SOLUTIONS SLU" → "horus network solutions"
 * "Nespresso S.A."              → "nespresso"
 */
export function normalizeCompanyName(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strips spaces, dashes and dots; uppercases.
 * "B-12 345.678" → "B12345678"
 *
 * Exported for lib/duplicate-detection.ts — same normalization is needed to
 * compare a newly-extracted supplier_tax_id against existing invoices.
 */
export function normalizeTaxId(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/[\s.\-]/g, '').toUpperCase();
}

/**
 * Returns true if normalized name `a` and `b` are considered the same company.
 * Requires exact equality OR one is a substring of the other (min 5 chars
 * to avoid coincidental short-string matches like "SA" inside "NESPRESSO").
 *
 * Exported for lib/duplicate-detection.ts.
 */
export function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer  = a.length <= b.length ? b : a;
  return shorter.length >= 5 && longer.includes(shorter);
}

// ---------------------------------------------------------------------------
// Alias matching helper
// ---------------------------------------------------------------------------

/**
 * Compares a user-defined alias (already normalised) against a name extracted
 * from an invoice (also normalised). The alias is the short/colloquial form
 * that appears on invoices; the invoice name may contain it as a substring.
 *
 * Minimum alias length: 3 chars to prevent accidental single-word matches.
 */
function aliasNamesMatch(aliasNorm: string, invoiceNameNorm: string): boolean {
  if (!aliasNorm || !invoiceNameNorm || aliasNorm.length < 3) return false;
  return invoiceNameNorm.includes(aliasNorm);
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ClassificationResult {
  /** Corrected (or confirmed) invoice type */
  invoice_type: 'received' | 'issued';
  /** True if the AI's type was overridden */
  was_corrected: boolean;
  /** Human-readable explanation of the correction (null when no correction) */
  correction_reason: string | null;
  /** Whether the invoice still needs human review */
  needs_review: boolean;
  /** True when identity was confirmed via a company alias (triggers confidence bonus) */
  matched_via_alias: boolean;
}

export interface AliasEntry {
  alias_normalized: string;
  alias_type: string;
}

export interface CompanyIdentity {
  name: string;
  tax_id: string;
  /** Active company aliases to try when direct name/tax_id match fails */
  aliases?: AliasEntry[];
}

/**
 * Classifies the invoice type using company identity as ground truth.
 * Does NOT modify the extraction object — returns a result you apply yourself.
 */
export function classifyInvoiceType(
  extraction: Pick<
    InvoiceExtraction,
    'invoice_type' | 'supplier_name' | 'supplier_tax_id' | 'customer_name' | 'customer_tax_id' | 'needs_review'
  >,
  company: CompanyIdentity,
): ClassificationResult {
  const aiType = (extraction.invoice_type === 'issued' ? 'issued' : 'received') as 'received' | 'issued';

  const companyNameNorm  = normalizeCompanyName(company.name);
  const companyTaxId     = normalizeTaxId(company.tax_id);

  const supplierNameNorm = normalizeCompanyName(extraction.supplier_name);
  const supplierTaxId    = normalizeTaxId(extraction.supplier_tax_id);
  const customerNameNorm = normalizeCompanyName(extraction.customer_name);
  const customerTaxId    = normalizeTaxId(extraction.customer_tax_id);

  // ------------------------------------------------------------------
  // 1. tax_id exact match — highest confidence
  // ------------------------------------------------------------------
  if (companyTaxId) {
    if (supplierTaxId && companyTaxId === supplierTaxId) {
      const corrected = aiType !== 'issued';
      return {
        invoice_type: 'issued',
        was_corrected: corrected,
        correction_reason: corrected
          ? `Tax ID match: ${company.tax_id} found as supplier tax ID → overriding AI type '${aiType}' to 'issued'`
          : null,
        needs_review: extraction.needs_review,
        matched_via_alias: false,
      };
    }

    if (customerTaxId && companyTaxId === customerTaxId) {
      const corrected = aiType !== 'received';
      return {
        invoice_type: 'received',
        was_corrected: corrected,
        correction_reason: corrected
          ? `Tax ID match: ${company.tax_id} found as customer tax ID → overriding AI type '${aiType}' to 'received'`
          : null,
        needs_review: extraction.needs_review,
        matched_via_alias: false,
      };
    }
  }

  // ------------------------------------------------------------------
  // 2. Normalized name match
  // ------------------------------------------------------------------
  if (companyNameNorm) {
    if (namesMatch(companyNameNorm, supplierNameNorm)) {
      const corrected = aiType !== 'issued';
      return {
        invoice_type: 'issued',
        was_corrected: corrected,
        correction_reason: corrected
          ? `Name match: '${company.name}' recognized as supplier ('${extraction.supplier_name}') → overriding AI type '${aiType}' to 'issued'`
          : null,
        needs_review: extraction.needs_review,
        matched_via_alias: false,
      };
    }

    if (namesMatch(companyNameNorm, customerNameNorm)) {
      const corrected = aiType !== 'received';
      return {
        invoice_type: 'received',
        was_corrected: corrected,
        correction_reason: corrected
          ? `Name match: '${company.name}' recognized as customer ('${extraction.customer_name}') → overriding AI type '${aiType}' to 'received'`
          : null,
        needs_review: extraction.needs_review,
        matched_via_alias: false,
      };
    }
  }

  // ------------------------------------------------------------------
  // 3. Alias match — user-defined alternative names
  // ------------------------------------------------------------------
  if (company.aliases && company.aliases.length > 0) {
    for (const entry of company.aliases) {
      const aliasNorm = entry.alias_normalized;

      if (aliasNamesMatch(aliasNorm, supplierNameNorm)) {
        const corrected = aiType !== 'issued';
        return {
          invoice_type: 'issued',
          was_corrected: corrected,
          correction_reason: `Alias match (${entry.alias_type}): alias '${aliasNorm}' found in supplier name '${extraction.supplier_name}'`,
          needs_review: extraction.needs_review,
          matched_via_alias: true,
        };
      }

      if (aliasNamesMatch(aliasNorm, customerNameNorm)) {
        const corrected = aiType !== 'received';
        return {
          invoice_type: 'received',
          was_corrected: corrected,
          correction_reason: `Alias match (${entry.alias_type}): alias '${aliasNorm}' found in customer name '${extraction.customer_name}'`,
          needs_review: extraction.needs_review,
          matched_via_alias: true,
        };
      }
    }
  }

  // ------------------------------------------------------------------
  // 4. No match — keep AI type, flag for review
  // ------------------------------------------------------------------
  return {
    invoice_type: aiType,
    was_corrected: false,
    correction_reason: null,
    needs_review: true, // cannot confirm without match → always review
    matched_via_alias: false,
  };
}
