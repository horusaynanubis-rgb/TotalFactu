// "Control TPV vs facturación" — purely informational comparison per period.
// Never auto-corrects or creates invoices; only flags differences for review.
import { prisma } from './prisma';

const CSV_DELIMITER = ';';

export interface TpvControlRow {
  month: string; // YYYY-MM
  cajaTotal: number;
  facturasTotal: number;
  diferencia: number;
}

export interface TpvControlReport {
  periodLabel: string;
  rows: TpvControlRow[];
  totalCaja: number;
  totalFacturas: number;
  totalDiferencia: number;
}

export async function buildTpvControlReport(
  companyId: string,
  from: Date,
  to: Date,
  periodLabel: string,
): Promise<TpvControlReport> {
  const [registers, invoices] = await Promise.all([
    prisma.dailyCashRegister.findMany({
      where: { company_id: companyId, date: { gte: from, lte: to }, status: 'confirmed' },
      select: { date: true, total_amount: true },
    }),
    prisma.invoice.findMany({
      where: { company_id: companyId, invoice_type: 'issued', issue_date: { gte: from, lte: to } },
      select: { issue_date: true, total_amount: true },
    }),
  ]);

  const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const cajaMap = new Map<string, number>();
  const facturasMap = new Map<string, number>();

  for (const r of registers) {
    const key = monthKey(r.date);
    cajaMap.set(key, (cajaMap.get(key) ?? 0) + Number(r.total_amount));
  }
  for (const inv of invoices) {
    const key = monthKey(inv.issue_date);
    facturasMap.set(key, (facturasMap.get(key) ?? 0) + inv.total_amount);
  }

  const months = Array.from(new Set([...cajaMap.keys(), ...facturasMap.keys()])).sort();
  const rows = months.map((month) => {
    const cajaTotal = cajaMap.get(month) ?? 0;
    const facturasTotal = facturasMap.get(month) ?? 0;
    return { month, cajaTotal, facturasTotal, diferencia: cajaTotal - facturasTotal };
  });

  const totalCaja = rows.reduce((s, r) => s + r.cajaTotal, 0);
  const totalFacturas = rows.reduce((s, r) => s + r.facturasTotal, 0);

  return { periodLabel, rows, totalCaja, totalFacturas, totalDiferencia: totalCaja - totalFacturas };
}

function escapeCSV(value: string): string {
  if (!value) return '';
  const s = String(value);
  if (s.includes(CSV_DELIMITER) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function generateTpvControlCSV(report: TpvControlReport): string {
  const lines: string[] = [];
  lines.push(escapeCSV(`Control TPV vs facturación — ${report.periodLabel}`));
  lines.push(escapeCSV('Informe informativo. No corrige ni crea facturas automáticamente — las diferencias deben revisarse manualmente.'));
  lines.push('');
  lines.push(['Mes', 'Total Caja/TPV', 'Total facturas emitidas', 'Diferencia'].join(CSV_DELIMITER));
  for (const r of report.rows) {
    lines.push([r.month, r.cajaTotal.toFixed(2), r.facturasTotal.toFixed(2), r.diferencia.toFixed(2)].join(CSV_DELIMITER));
  }
  lines.push('');
  lines.push(['Total Caja/TPV', report.totalCaja.toFixed(2)].join(CSV_DELIMITER));
  lines.push(['Total facturas emitidas', report.totalFacturas.toFixed(2)].join(CSV_DELIMITER));
  lines.push(['Diferencia total', report.totalDiferencia.toFixed(2)].join(CSV_DELIMITER));

  return '﻿' + lines.join('\r\n');
}
