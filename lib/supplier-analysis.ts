// Shared analysis logic for the Suppliers module.
// All stats are computed at runtime from InvoiceLine — no extra DB columns needed.

// --------------------------------------------------------------------------
// Normalisation
// --------------------------------------------------------------------------

const UNIT_TOKENS =
  /\b(uds?|unidades?|und|pcs?|kg|kgs?|gramos?|gr|litros?|lts?|ml|cms?|metros?|m2|m3|packs?|cajas?|bolsas?|botes?|latas?|env(?:ase)?s?)\b/gi;

export function normalizeDescription(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // strip combining diacritics
    .replace(UNIT_TOKENS, ' ')         // drop standalone unit tokens
    .replace(/[^a-z0-9 ]/g, ' ')      // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type AlertLevel = 'none' | 'minor' | 'major';

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
// Alert logic
// --------------------------------------------------------------------------

function computeAlertLevel(
  variationVsPrev: number | null,
  variationVsInitial: number | null,
): AlertLevel {
  const vp = variationVsPrev ?? 0;
  const vi = variationVsInitial ?? 0;
  if (vp > 5 || vi > 10) return 'major';
  if (vp > 0) return 'minor';
  return 'none';
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

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

    const withPrice = sorted.filter((e) => e.unit_price !== null);

    const firstPrice = withPrice.length > 0 ? withPrice[0].unit_price! : null;
    const lastPrice  = withPrice.length > 0 ? withPrice[withPrice.length - 1].unit_price! : null;
    const prevPrice  = withPrice.length > 1 ? withPrice[withPrice.length - 2].unit_price! : null;

    const variationVsPrev =
      prevPrice !== null && lastPrice !== null && prevPrice > 0
        ? r1(((lastPrice - prevPrice) / prevPrice) * 100)
        : null;

    const variationVsInitial =
      firstPrice !== null && lastPrice !== null && firstPrice > 0
        ? r1(((lastPrice - firstPrice) / firstPrice) * 100)
        : null;

    const alertLevel = computeAlertLevel(variationVsPrev, variationVsInitial);

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
      total_quantity: r1(sorted.reduce((sum, e) => sum + (e.quantity ?? 0), 0)),
    } satisfies ProductStat;
  });

  // Sort: major first → minor → none; then by appearances desc
  const order: Record<AlertLevel, number> = { major: 0, minor: 1, none: 2 };
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
    if (line.unit_price === null || !line.normalized_description) continue;
    const key = line.normalized_description;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push({
      price: line.unit_price,
      date: new Date(line.invoice.issue_date),
    });
  }

  // product_count = distinct normalized_descriptions with at least one unit_price
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

    const varVsPrev    = prevPrice > 0    ? r1(((lastPrice - prevPrice)    / prevPrice)    * 100) : null;
    const varVsInitial = firstPrice > 0   ? r1(((lastPrice - firstPrice)   / firstPrice)   * 100) : null;

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
