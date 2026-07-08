// Spanish quarterly fiscal calendar (Modelo 303 / 390 style declarations).
//
// Reusable across: quarterly CSV export (custom period picker), the "next
// filing" banner on the Exports page, and future Modelo 303/390 tooling,
// dashboard widgets, or fiscal-deadline alerts.

export type FiscalQuarter = 1 | 2 | 3 | 4;

export type FiscalQuarterStatus = 'open' | 'upcoming' | 'closed';

export interface FiscalQuarterInfo {
  year: number;
  quarter: FiscalQuarter;
  // Calendar period the declaration covers (e.g. 01/04 -> 30/06).
  period_start: Date;
  period_end: Date;
  // Window during which the declaration can be filed (e.g. 01/07 -> 20/07).
  declaration_start: Date;
  declaration_end: Date;
}

export interface FiscalQuarterWithStatus extends FiscalQuarterInfo {
  status: FiscalQuarterStatus;
}

/**
 * Period + filing-window dates for an arbitrary (year, quarter) pair.
 * Pure date math — no dependency on "today". Reused by both the custom CSV
 * export (period_start/period_end) and getCurrentFiscalQuarter() below.
 *
 * Spain quarterly VAT (Modelo 303) rules:
 *   Q1  01/01-31/03  -> filed 01/04-20/04
 *   Q2  01/04-30/06  -> filed 01/07-20/07
 *   Q3  01/07-30/09  -> filed 01/10-20/10
 *   Q4  01/10-31/12  -> filed 01/01-30/01 (next year)
 */
export function getFiscalQuarterInfo(year: number, quarter: FiscalQuarter): FiscalQuarterInfo {
  const qIndex = quarter - 1;
  const period_start = new Date(year, qIndex * 3, 1);
  const period_end = new Date(year, qIndex * 3 + 3, 0, 23, 59, 59, 999);

  // Declaration month is always the month right after the period ends —
  // Date() normalizes month=12 into January of the next year for Q4.
  const declarationMonth = qIndex * 3 + 3;
  const declarationDay = quarter === 4 ? 30 : 20;
  const declaration_start = new Date(year, declarationMonth, 1);
  const declaration_end = new Date(year, declarationMonth, declarationDay, 23, 59, 59, 999);

  return { year, quarter, period_start, period_end, declaration_start, declaration_end };
}

/** Traffic-light status of a fiscal quarter's filing window relative to `date`. */
export function getFiscalQuarterStatus(
  info: FiscalQuarterInfo,
  date: Date = new Date(),
): FiscalQuarterStatus {
  if (date < info.declaration_start) return 'upcoming';
  if (date > info.declaration_end) return 'closed';
  return 'open';
}

/**
 * The most recently CLOSED calendar quarter relative to `date` — i.e. the
 * quarter a gestoría/company is currently expected to file for. This matches
 * the same "last completed quarter" rule the quarterly CSV export uses.
 */
export function getCurrentFiscalQuarter(date: Date = new Date()): FiscalQuarterWithStatus {
  const year = date.getFullYear();
  const month = date.getMonth();
  const currentQuarterIndex = Math.floor(month / 3);
  const lastClosedQuarterIndex = currentQuarterIndex - 1;

  // Resolve (year, quarter) for the last closed quarter — Date() normalizes
  // a negative month index by rolling back into the previous year.
  const resolved = new Date(year, lastClosedQuarterIndex * 3, 1);
  const resolvedQuarter = (Math.floor(resolved.getMonth() / 3) + 1) as FiscalQuarter;

  const info = getFiscalQuarterInfo(resolved.getFullYear(), resolvedQuarter);
  const status = getFiscalQuarterStatus(info, date);
  return { ...info, status };
}

/** DD/MM/YYYY formatting used for fiscal dates (Modelo 303 style), locale-independent. */
export function formatFiscalDate(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}
