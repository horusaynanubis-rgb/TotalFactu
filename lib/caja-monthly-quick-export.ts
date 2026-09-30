// Pure CSV/XLSX builders for the "Caja y Cobros" page's own quick-export
// buttons (app/(dashboard)/dashboard/caja-cobros/page.tsx). This is a
// SEPARATE, client-side-only code path from the canonical lib/caja-csv.ts
// generator used by the server-side GET /api/caja-cobros/export (and the
// gestoria equivalent) and by the quarterly "Exportación trimestral
// completa" ZIP — that one already appends its own "TOTAL PERIODO" row for
// every scope (daily/monthly/quarterly) and must not be touched or have its
// output changed. This file only fixes the page's own quick-export buttons,
// which never had a totals row at all (Fase Gascón follow-up, Marc/BYOU
// feedback: "cada CSV mensual debe incluir al final su TOTAL").
//
// `registers` here is always whatever the page currently has loaded for a
// single selected month (GET /api/caja-cobros?year=&month= only returns
// confirmed rows for that month) — so the total computed below is always
// scoped to exactly that month's data, never mixed across months, and never
// invents a row for a day that has no register.

export interface MonthlyCajaExportRow {
  date: string | Date;
  cash_amount: string | number;
  card_amount: string | number;
  bizum_amount: string | number;
  transfer_amount: string | number;
  other_amount: string | number;
  total_amount: string | number;
  source: string;
  notes: string | null;
}

export interface MonthlyCajaTotals {
  cash: number;
  card: number;
  bizum: number;
  transfer: number;
  other: number;
  total: number;
}

// Integer-cents summation avoids IEEE754 float drift (e.g. 0.1 + 0.2 style
// errors) when adding many Decimal(12,2) amounts together.
function sumCents(values: Array<string | number>): number {
  const cents = values.reduce((acc: number, v) => acc + Math.round(Number(v) * 100), 0);
  return cents / 100;
}

export function computeMonthlyCajaTotals(registers: MonthlyCajaExportRow[]): MonthlyCajaTotals {
  return {
    cash:     sumCents(registers.map((r) => r.cash_amount)),
    card:     sumCents(registers.map((r) => r.card_amount)),
    bizum:    sumCents(registers.map((r) => r.bizum_amount)),
    transfer: sumCents(registers.map((r) => r.transfer_amount)),
    other:    sumCents(registers.map((r) => r.other_amount)),
    total:    sumCents(registers.map((r) => r.total_amount)),
  };
}

function originLabel(source: string): string {
  return source === 'ai' ? 'IA' : 'Manual';
}

export function buildMonthlyCajaCSV(registers: MonthlyCajaExportRow[]): string {
  const header = 'Fecha,Efectivo,TPV,Bizum,Transferencias,Otros,Total,Origen,Observaciones';
  const rows = registers.map((r) => [
    new Date(r.date).toLocaleDateString('es-ES'),
    Number(r.cash_amount).toFixed(2),
    Number(r.card_amount).toFixed(2),
    Number(r.bizum_amount).toFixed(2),
    Number(r.transfer_amount).toFixed(2),
    Number(r.other_amount).toFixed(2),
    Number(r.total_amount).toFixed(2),
    originLabel(r.source),
    `"${(r.notes ?? '').replace(/"/g, '""')}"`,
  ].join(','));

  const totals = computeMonthlyCajaTotals(registers);
  const totalRow = [
    'TOTAL',
    totals.cash.toFixed(2), totals.card.toFixed(2), totals.bizum.toFixed(2),
    totals.transfer.toFixed(2), totals.other.toFixed(2), totals.total.toFixed(2),
    '', '',
  ].join(',');

  return [header, ...rows, totalRow].join('\n');
}

export function buildMonthlyCajaXLSXHtml(registers: MonthlyCajaExportRow[]): string {
  const header = ['Fecha', 'Efectivo', 'TPV', 'Bizum', 'Transferencias', 'Otros', 'Total', 'Origen', 'Observaciones'];
  const rows = registers.map((r) => [
    new Date(r.date).toLocaleDateString('es-ES'),
    Number(r.cash_amount).toFixed(2),
    Number(r.card_amount).toFixed(2),
    Number(r.bizum_amount).toFixed(2),
    Number(r.transfer_amount).toFixed(2),
    Number(r.other_amount).toFixed(2),
    Number(r.total_amount).toFixed(2),
    originLabel(r.source),
    r.notes ?? '',
  ]);

  const totals = computeMonthlyCajaTotals(registers);
  const totalRow = [
    'TOTAL',
    totals.cash.toFixed(2), totals.card.toFixed(2), totals.bizum.toFixed(2),
    totals.transfer.toFixed(2), totals.other.toFixed(2), totals.total.toFixed(2),
    '', '',
  ];

  const tableRows = [header, ...rows, totalRow]
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('');

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"/></head><body><table>${tableRows}</table></body></html>`;
}
