// Shared period/date-range helpers for Caja y Cobros (Company export + Gestoria
// read/export). Extracted from app/api/caja-cobros/export/route.ts so the
// gestoria-side routes reuse the exact same period math instead of
// reimplementing it — no second "quarter boundary" definition to drift out of
// sync with the company view.
import { getFiscalQuarterInfo, FiscalQuarter } from './fiscal-calendar';

export function getMonthRange(year: number, month: number): { from: Date; to: Date } {
  return {
    from: new Date(year, month - 1, 1),
    to: new Date(year, month, 1), // exclusive upper bound
  };
}

export interface CajaExportRange {
  start: Date;
  end: Date;
  label: string;
}

export function getCajaExportRange(
  scope: string,
  year: number,
  month: number,
  quarter: number,
): CajaExportRange | null {
  if (scope === 'daily' || scope === 'monthly') {
    if (!month || month < 1 || month > 12) return null;
    return {
      start: new Date(year, month - 1, 1),
      end: new Date(year, month, 0, 23, 59, 59, 999),
      label: `${String(month).padStart(2, '0')}/${year}`,
    };
  }
  if (scope === 'quarterly') {
    if (!quarter || ![1, 2, 3, 4].includes(quarter)) return null;
    const info = getFiscalQuarterInfo(year, quarter as FiscalQuarter);
    return { start: info.period_start, end: info.period_end, label: `Q${quarter} ${year}` };
  }
  return null;
}
