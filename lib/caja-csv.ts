// CSV export for Caja y Cobros (daily/monthly/quarterly). The per-method
// columns already double as "cobros por método" — no separate exporter needed.
const CSV_DELIMITER = ';';

// Amount fields come from Prisma as Decimal at runtime — typed loosely here so
// this lib doesn't need to depend on Prisma's Decimal type. Number(x) works
// correctly for Decimal, string, and number alike.
type Amount = number | string | { toString(): string };

export interface CajaRegisterRow {
  date: Date;
  cash_amount: Amount;
  card_amount: Amount;
  bizum_amount: Amount;
  transfer_amount: Amount;
  other_amount: Amount;
  total_amount: Amount;
  notes: string | null;
  status: string;
}

function escapeCSV(value: string): string {
  if (!value) return '';
  const s = String(value);
  if (s.includes(CSV_DELIMITER) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function generateCajaCSV(registers: CajaRegisterRow[]): string {
  const headers = ['fecha', 'efectivo', 'tarjeta', 'bizum', 'transferencia', 'otros', 'total', 'estado', 'notas'];

  const rows = registers.map((r) => [
    r.date.toISOString().split('T')[0],
    Number(r.cash_amount).toFixed(2),
    Number(r.card_amount).toFixed(2),
    Number(r.bizum_amount).toFixed(2),
    Number(r.transfer_amount).toFixed(2),
    Number(r.other_amount).toFixed(2),
    Number(r.total_amount).toFixed(2),
    escapeCSV(r.status),
    escapeCSV(r.notes ?? ''),
  ]);

  const csvContent =
    '﻿' +
    [
      headers.join(CSV_DELIMITER),
      ...rows.map((row) => row.join(CSV_DELIMITER)),
    ].join('\r\n');

  return csvContent;
}
