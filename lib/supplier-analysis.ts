// Shared analysis logic for the Suppliers module.
// All stats are computed at runtime from InvoiceLine — no extra DB columns needed.

// --------------------------------------------------------------------------
// Normalisation
// --------------------------------------------------------------------------

// Unit tokens that are safe to strip because they don't differentiate products:
// weight/volume units that appear standalone (not inside a multiplier like "x24").
// NOTE: "cl" is intentionally NOT in this list — "20cl" is a format differentiator.
// NOTE: Multipliers like "x24", "x12", "x6" are also kept (alphanumeric, not stripped).
const UNIT_TOKENS =
  /\b(uds?|unidades?|und|pcs?|kgs?|gramos?|gr|litros?|lts?|ml|cms?|metros?|m2|m3|packs?|cajas?|bolsas?|botes?|latas?|env(?:ase)?s?)\b/gi;

// Note: bare "kg" is still matched by kgs?. "cl" is not matched (centilitros kept as differentiator).

export function normalizeDescription(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics (robust version)
    .replace(UNIT_TOKENS, ' ')       // drop standalone unit tokens
    .replace(/[^a-z0-9 ]/g, ' ')    // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type AlertLevel = 'none' | 'minor' | 'major' | 'suspicious';

export interface ProductStat {
  normalized_description: string;
  last_description: string;
  appearances: number;
  first_date: Date | null;
  last_date: Date | null;
  first_price: number | null;
  prev_price: number | null;
  last_price: number | null;
  variation_vs_prev: number | null;
  variation_vs_initial: number | null;
  alert_level: AlertLevel;
  total_quantity: number;
  // New fields for transparency and debug
  suspicious: boolean;
  suspicious_reason: string | null;
  price_inconsistencies: number; // count of lines where unit_price × qty ≠ total
}

export interface RawLine {
  id: string;
  description: string;
  normalized_description: string | null;
  quantity: number | null;
  unit_price: number | null;
  tax_rate?: number | null;
  total_amount?: number | null;
  currency?: string | null;
  created_at?: Date;
  invoice: { id: string; issue_date: Date; invoice_number: string };
}

// --------------------------------------------------------------------------
// Thresholds
// --------------------------------------------------------------------------

/** Variations beyond this are shown as "possible extraction error" instead of real alerts */
const SUSPICIOUS_VAR_THRESHOLD = 300; // percent

/** unit_price × qty vs total_amount must agree within this tolerance */
const PRICE_CONSISTENCY_TOLERANCE = 0.10; // 10%

/** Minimum price ratio that triggers a "unit vs total" reclassification */
const UNIT_TOTAL_RECLASSIFY_RATIO = 2.0;

// --------------------------------------------------------------------------
// Price validation & derivation
// --------------------------------------------------------------------------

/**
 * Validates whether a line's unit_price is consistent with its total_amount/quantity.
 * Returns the best available unit price and a warning if something looks off.
 *
 * Cases handled:
 *   - unit_price present and consistent → return as-is
 *   - unit_price present but inconsistent with total/qty → derive from total/qty + warn
 *   - unit_price absent but total+qty present → derive
 *   - none available → null
 */
function resolveUnitPrice(line: RawLine): {
  price: number | null;
  derived: boolean;
  inconsistent: boolean;
  warning: string | null;
} {
  const qty = typeof line.quantity === 'number' && line.quantity > 0 ? line.quantity : null;
  const up  = typeof line.unit_price === 'number' && line.unit_price > 0 ? line.unit_price : null;
  const tot = typeof line.total_amount === 'number' && line.total_amount > 0 ? line.total_amount : null;

  // Derived price from total / qty (the ground truth when available)
  const derivedPrice = qty !== null && tot !== null ? round4(tot / qty) : null;

  if (up !== null) {
    // Validate consistency: unit_price × qty should ≈ total_amount
    if (derivedPrice !== null && qty !== null) {
      const expected = up * qty;
      const relative = Math.abs(expected - (tot ?? 0)) / ((tot ?? expected) || 1);

      if (relative > PRICE_CONSISTENCY_TOLERANCE) {
        // Check if unit_price might actually be the total (AI stored total as unit_price)
        const upIsTotalRatio = tot !== null ? up / tot : null;
        const upLooksLikeTotal = upIsTotalRatio !== null && upIsTotalRatio > (1 - PRICE_CONSISTENCY_TOLERANCE) && upIsTotalRatio < (1 + PRICE_CONSISTENCY_TOLERANCE);

        const warning =
          `unit_price(${up}) × qty(${qty}) = ${round2(up * qty)} ≠ total(${tot}); ` +
          `derived=${derivedPrice} inv="${line.description}" [${line.invoice.invoice_number}]`;

        console.warn(`[supplier-analysis] ⚠ Price inconsistency: ${warning}`);

        // If derivedPrice is much smaller and more plausible → use it
        if (derivedPrice < up / UNIT_TOTAL_RECLASSIFY_RATIO) {
          return { price: derivedPrice, derived: true, inconsistent: true, warning };
        }

        // If unit_price looks like the total amount was stored in the wrong field
        if (upLooksLikeTotal && qty > 1) {
          return { price: derivedPrice, derived: true, inconsistent: true, warning };
        }

        // Otherwise keep unit_price but flag inconsistency
        return { price: up, derived: false, inconsistent: true, warning };
      }
    }

    return { price: up, derived: false, inconsistent: false, warning: null };
  }

  // No unit_price — try to derive
  if (derivedPrice !== null) {
    return { price: derivedPrice, derived: true, inconsistent: false, warning: null };
  }

  return { price: null, derived: false, inconsistent: false, warning: null };
}

// --------------------------------------------------------------------------
// Alert logic
// --------------------------------------------------------------------------

function computeAlertLevel(
  variationVsPrev: number | null,
  variationVsInitial: number | null,
  suspicious: boolean,
): AlertLevel {
  if (suspicious) return 'suspicious';
  const vp = variationVsPrev ?? 0;
  const vi = variationVsInitial ?? 0;
  if (vp > 5 || vi > 10) return 'major';
  if (vp > 0) return 'minor';
  return 'none';
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }

// --------------------------------------------------------------------------
// Core analysis: builds per-product stats from raw invoice lines
// --------------------------------------------------------------------------

export function buildProductStats(lines: RawLine[]): ProductStat[] {
  const grouped = new Map<string, RawLine[]>();

  for (const line of lines) {
    const key = line.normalized_description || normalizeDescription(line.description);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(line);
  }

  const stats = Array.from(grouped.entries()).map(([key, entries]) => {
    const sorted = [...entries].sort(
      (a, b) =>
        new Date(a.invoice.issue_date).getTime() -
        new Date(b.invoice.issue_date).getTime(),
    );

    // Resolve best unit price for each line + count inconsistencies
    let priceInconsistencies = 0;
    const resolvedPrices = sorted.map((e) => {
      const res = resolveUnitPrice(e);
      if (res.inconsistent) priceInconsistencies++;
      return { line: e, ...res };
    });

    const withPrice = resolvedPrices.filter((r) => r.price !== null);

    const firstPrice = withPrice.length > 0 ? withPrice[0].price! : null;
    const lastPrice  = withPrice.length > 0 ? withPrice[withPrice.length - 1].price! : null;
    const prevPrice  = withPrice.length > 1 ? withPrice[withPrice.length - 2].price! : null;

    const variationVsPrev =
      prevPrice !== null && lastPrice !== null && prevPrice > 0
        ? round1(((lastPrice - prevPrice) / prevPrice) * 100)
        : null;

    const variationVsInitial =
      firstPrice !== null && lastPrice !== null && firstPrice > 0
        ? round1(((lastPrice - firstPrice) / firstPrice) * 100)
        : null;

    // Detect suspicious variations
    const absVsP = variationVsPrev   !== null ? Math.abs(variationVsPrev)   : 0;
    const absVsI = variationVsInitial !== null ? Math.abs(variationVsInitial) : 0;
    let suspicious = false;
    let suspiciousReason: string | null = null;

    if (absVsP > SUSPICIOUS_VAR_THRESHOLD || absVsI > SUSPICIOUS_VAR_THRESHOLD) {
      suspicious = true;
      const bigVar = Math.max(absVsP, absVsI);
      const which  = absVsP >= absVsI ? 'vs anterior' : 'vs inicial';
      suspiciousReason =
        `Variación de ${bigVar.toFixed(0)}% (${which}) supera el umbral de ${SUSPICIOUS_VAR_THRESHOLD}%. ` +
        `Precios: ${firstPrice?.toFixed(4)} → ${prevPrice?.toFixed(4)} → ${lastPrice?.toFixed(4)}. ` +
        `Posible error de extracción OCR o cambio de formato (unidad/caja/pack).`;
      console.warn(
        `[supplier-analysis] 🚨 SUSPICIOUS variation for "${key}": ${bigVar.toFixed(0)}% (${which})`,
        `prices: ${firstPrice} → ${prevPrice} → ${lastPrice}`,
        `inconsistencies: ${priceInconsistencies}/${entries.length}`,
      );
    }

    // Additional suspicion: many price inconsistencies in the group
    if (!suspicious && priceInconsistencies >= 1 && entries.length <= 3) {
      suspicious = true;
      suspiciousReason = `${priceInconsistencies} de ${entries.length} líneas tienen precio_unitario inconsistente con total/cantidad. Posible mezcla de precio por unidad y precio por caja.`;
    }

    const alertLevel = computeAlertLevel(variationVsPrev, variationVsInitial, suspicious);

    // Debug log for every product with price data
    if (withPrice.length >= 2) {
      console.log(
        `[supplier-analysis] "${key}" appearances=${sorted.length}` +
        ` first=${firstPrice} prev=${prevPrice} last=${lastPrice}` +
        ` vsPrev=${variationVsPrev}% vsInit=${variationVsInitial}%` +
        ` alert=${alertLevel} suspicious=${suspicious}`,
      );
    }

    return {
      normalized_description: key,
      last_description: sorted[sorted.length - 1]?.description ?? '',
      appearances: sorted.length,
      first_date: sorted[0]?.invoice.issue_date ?? null,
      last_date: sorted[sorted.length - 1]?.invoice.issue_date ?? null,
      first_price: firstPrice,
      prev_price: prevPrice,
      last_price: lastPrice,
      variation_vs_prev: variationVsPrev,
      variation_vs_initial: variationVsInitial,
      alert_level: alertLevel,
      total_quantity: round1(sorted.reduce((sum, e) => sum + (e.quantity ?? 0), 0)),
      suspicious,
      suspicious_reason: suspiciousReason,
      price_inconsistencies: priceInconsistencies,
    } satisfies ProductStat;
  });

  // Sort: suspicious first (they need attention too) → major → minor → none;
  // then by appearances desc within each bucket
  const order: Record<AlertLevel, number> = { suspicious: 0, major: 1, minor: 2, none: 3 };
  return stats.sort((a, b) => {
    const d = order[a.alert_level] - order[b.alert_level];
    return d !== 0 ? d : b.appearances - a.appearances;
  });
}

// --------------------------------------------------------------------------
// Summary helpers (used by list API)
// --------------------------------------------------------------------------

type MinLine = {
  normalized_description: string | null;
  unit_price: number | null;
  total_amount?: number | null;
  quantity?: number | null;
  invoice: { issue_date: Date };
};

interface SupplierSummary {
  product_count: number;
  alerts_count: number;
  max_variation: number | null;
}

export function computeSupplierSummary(lines: MinLine[]): SupplierSummary {
  const grouped = new Map<string, { price: number; date: Date }[]>();

  for (const line of lines) {
    if (!line.normalized_description) continue;

    // Resolve the best price using consistency validation
    const qty = typeof line.quantity === 'number' && line.quantity > 0 ? line.quantity : null;
    const up  = typeof line.unit_price === 'number' && line.unit_price > 0 ? line.unit_price : null;
    const tot = typeof line.total_amount === 'number' && line.total_amount > 0 ? line.total_amount : null;

    let price: number | null = up;

    if (up !== null && qty !== null && tot !== null) {
      const expected = up * qty;
      const relative = Math.abs(expected - tot) / tot;
      if (relative > PRICE_CONSISTENCY_TOLERANCE) {
        const derived = tot / qty;
        if (derived < up / UNIT_TOTAL_RECLASSIFY_RATIO) price = derived;
      }
    } else if (price === null && qty !== null && tot !== null) {
      price = tot / qty;
    }

    if (price === null) continue;

    const key = line.normalized_description;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push({ price, date: new Date(line.invoice.issue_date) });
  }

  // product_count = all distinct normalized_descriptions (with or without price)
  const descSet = new Set(
    lines.map((l) => l.normalized_description ?? '').filter(Boolean),
  );

  let alertsCount = 0;
  let maxVariation: number | null = null;

  for (const entries of grouped.values()) {
    if (entries.length < 2) continue;
    entries.sort((a, b) => a.date.getTime() - b.date.getTime());

    const firstPrice = entries[0].price;
    const lastPrice  = entries[entries.length - 1].price;
    const prevPrice  = entries[entries.length - 2].price;

    const varVsPrev    = prevPrice > 0    ? round1(((lastPrice - prevPrice)    / prevPrice)    * 100) : null;
    const varVsInitial = firstPrice > 0   ? round1(((lastPrice - firstPrice)   / firstPrice)   * 100) : null;

    // Skip suspicious variations in summary counts
    const absVsP = varVsPrev    !== null ? Math.abs(varVsPrev)    : 0;
    const absVsI = varVsInitial !== null ? Math.abs(varVsInitial) : 0;
    if (Math.max(absVsP, absVsI) > SUSPICIOUS_VAR_THRESHOLD) continue;

    if ((varVsPrev !== null && varVsPrev > 5) || (varVsInitial !== null && varVsInitial > 10)) {
      alertsCount++;
    }

    const absVar = varVsInitial !== null ? Math.abs(varVsInitial) : 0;
    if (maxVariation === null || absVar > Math.abs(maxVariation)) {
      maxVariation = varVsInitial;
    }
  }

  return {
    product_count: descSet.size,
    alerts_count: alertsCount,
    max_variation: maxVariation,
  };
}
