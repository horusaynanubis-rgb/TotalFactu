// Aggregates Invoice data into the "resumen_trimestral.csv" used by the
// "Exportación trimestral completa" ZIP (ventas/compras por mes, bases e IVA
// por tipo, total trimestral). No existing helper computes this breakdown —
// lib/csv-generator.ts only emits a flat per-invoice CSV.
import { prisma } from './prisma';

const CSV_DELIMITER = ';';

export interface MonthlyTotals {
  month: string; // YYYY-MM
  ventas: number;
  compras: number;
}

export interface RateBreakdown {
  rate: number; // 0, 4, 10, 21, ...
  base: number;
  iva: number;
}

export interface FiscalSummary {
  periodLabel: string;
  monthly: MonthlyTotals[];
  rates: RateBreakdown[];
  totalVentas: number;
  totalCompras: number;
  totalBase: number;
  totalIva: number;
  totalTrimestral: number;
}

export async function buildFiscalSummary(
  companyId: string,
  from: Date,
  to: Date,
  periodLabel: string,
): Promise<FiscalSummary> {
  const invoices = await prisma.invoice.findMany({
    where: { company_id: companyId, issue_date: { gte: from, lte: to } },
    select: {
      invoice_type: true,
      issue_date: true,
      subtotal: true,
      tax_amount: true,
      total_amount: true,
      tax_rate: true,
    },
  });

  const monthlyMap = new Map<string, { ventas: number; compras: number }>();
  const rateMap = new Map<number, { base: number; iva: number }>();
  let totalVentas = 0;
  let totalCompras = 0;
  let totalBase = 0;
  let totalIva = 0;

  for (const inv of invoices) {
    const monthKey = `${inv.issue_date.getFullYear()}-${String(inv.issue_date.getMonth() + 1).padStart(2, '0')}`;
    const m = monthlyMap.get(monthKey) ?? { ventas: 0, compras: 0 };
    if (inv.invoice_type === 'issued') {
      m.ventas += inv.total_amount;
      totalVentas += inv.total_amount;
    } else {
      m.compras += inv.total_amount;
      totalCompras += inv.total_amount;
    }
    monthlyMap.set(monthKey, m);

    const rate = Math.round(inv.tax_rate ?? 0);
    const r = rateMap.get(rate) ?? { base: 0, iva: 0 };
    r.base += inv.subtotal;
    r.iva += inv.tax_amount;
    rateMap.set(rate, r);
    totalBase += inv.subtotal;
    totalIva += inv.tax_amount;
  }

  const monthly = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  const rates = Array.from(rateMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([rate, v]) => ({ rate, ...v }));

  return {
    periodLabel,
    monthly,
    rates,
    totalVentas,
    totalCompras,
    totalBase,
    totalIva,
    totalTrimestral: totalVentas - totalCompras,
  };
}

function escapeCSV(value: string): string {
  if (!value) return '';
  const s = String(value);
  if (s.includes(CSV_DELIMITER) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function generateResumenCSV(summary: FiscalSummary): string {
  const lines: string[] = [];

  lines.push(escapeCSV(`Resumen trimestral — ${summary.periodLabel}`));
  lines.push('');

  lines.push(['Mes', 'Ventas', 'Compras/Gastos'].join(CSV_DELIMITER));
  for (const m of summary.monthly) {
    lines.push([m.month, m.ventas.toFixed(2), m.compras.toFixed(2)].join(CSV_DELIMITER));
  }
  lines.push('');

  lines.push(['Tipo IVA (%)', 'Base imponible', 'Cuota IVA'].join(CSV_DELIMITER));
  for (const r of summary.rates) {
    lines.push([`${r.rate}%`, r.base.toFixed(2), r.iva.toFixed(2)].join(CSV_DELIMITER));
  }
  lines.push('');

  lines.push(['Total ventas', summary.totalVentas.toFixed(2)].join(CSV_DELIMITER));
  lines.push(['Total compras/gastos', summary.totalCompras.toFixed(2)].join(CSV_DELIMITER));
  lines.push(['Total base imponible', summary.totalBase.toFixed(2)].join(CSV_DELIMITER));
  lines.push(['Total cuota IVA', summary.totalIva.toFixed(2)].join(CSV_DELIMITER));
  lines.push(['Total trimestral (ventas - compras)', summary.totalTrimestral.toFixed(2)].join(CSV_DELIMITER));

  // UTF-8 BOM + CRLF — same convention as lib/csv-generator.ts
  return '﻿' + lines.join('\r\n');
}
