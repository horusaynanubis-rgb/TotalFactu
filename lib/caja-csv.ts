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
  source: string; // manual | ai | excel_import
  ai_raw_data: string | null;
  document?: { source_channel: string } | null;
}

const ORIGEN_LABELS: Record<string, string> = {
  manual: 'Manual',
  excel_import: 'Excel',
};

// source='ai' rows come from OCR'ing an uploaded document — label by how that
// document arrived (Telegram forward, web upload, email) when known.
function resolveOrigen(row: CajaRegisterRow): string {
  if (row.source === 'ai') {
    const channel = row.document?.source_channel;
    if (channel === 'telegram') return 'Telegram';
    if (channel === 'web') return 'Manual (documento)';
    if (channel === 'email') return 'Email';
    return 'IA';
  }
  return ORIGEN_LABELS[row.source] ?? row.source;
}

// Discrepancy between theoretical and actual closing cash, when the source
// document/import captured both (e.g. BYOU TPV export). 0 when not available.
function resolveDescuadre(row: CajaRegisterRow): number {
  if (!row.ai_raw_data) return 0;
  try {
    const raw = JSON.parse(row.ai_raw_data);
    if (typeof raw.efec_final_real === 'number' && typeof raw.efec_final_teorico === 'number') {
      return raw.efec_final_real - raw.efec_final_teorico;
    }
  } catch {
    // ai_raw_data not JSON or missing fields — no descuadre info available
  }
  return 0;
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
  const headers = ['fecha', 'efectivo', 'tarjeta', 'bizum', 'transferencia', 'otros', 'total', 'descuadre', 'origen', 'estado', 'notas'];

  const rows = registers.map((r) => [
    r.date.toISOString().split('T')[0],
    Number(r.cash_amount).toFixed(2),
    Number(r.card_amount).toFixed(2),
    Number(r.bizum_amount).toFixed(2),
    Number(r.transfer_amount).toFixed(2),
    Number(r.other_amount).toFixed(2),
    Number(r.total_amount).toFixed(2),
    resolveDescuadre(r).toFixed(2),
    escapeCSV(resolveOrigen(r)),
    escapeCSV(r.status),
    escapeCSV(r.notes ?? ''),
  ]);

  const totals = registers.reduce(
    (acc, r) => ({
      cash: acc.cash + Number(r.cash_amount),
      card: acc.card + Number(r.card_amount),
      bizum: acc.bizum + Number(r.bizum_amount),
      transfer: acc.transfer + Number(r.transfer_amount),
      other: acc.other + Number(r.other_amount),
      total: acc.total + Number(r.total_amount),
      descuadre: acc.descuadre + resolveDescuadre(r),
    }),
    { cash: 0, card: 0, bizum: 0, transfer: 0, other: 0, total: 0, descuadre: 0 },
  );
  const totalsRow = [
    'TOTAL PERIODO',
    totals.cash.toFixed(2), totals.card.toFixed(2), totals.bizum.toFixed(2),
    totals.transfer.toFixed(2), totals.other.toFixed(2), totals.total.toFixed(2),
    totals.descuadre.toFixed(2), '', '', '',
  ];

  const csvContent =
    '﻿' +
    [
      headers.join(CSV_DELIMITER),
      ...rows.map((row) => row.join(CSV_DELIMITER)),
      totalsRow.join(CSV_DELIMITER),
    ].join('\r\n');

  return csvContent;
}
