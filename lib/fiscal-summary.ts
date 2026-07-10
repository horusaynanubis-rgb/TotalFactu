// Aggregates Invoice data into "resumen_fiscal.csv" — informational quarterly
// fiscal summary used both standalone (company "Fiscal" export) and inside the
// "Paquete trimestral" ZIP. No existing helper computes this breakdown —
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
  ventasBase: number;
  ventasIva: number;
  comprasBase: number;
  comprasIva: number;
}

export interface FiscalSummary {
  periodLabel: string;
  monthly: MonthlyTotals[];
  rates: RateBreakdown[];
  totalVentas: number;
  totalCompras: number;
  totalBaseImponible: number;
  ivaRepercutido: number; // IVA de ventas
  ivaSoportado: number;   // IVA de compras
  resultadoOrientativo: number; // ivaRepercutido - ivaSoportado
}

export interface SpecialExpenseEntry {
  label: string;
  count: number;
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
  const rateMap = new Map<number, { ventasBase: number; ventasIva: number; comprasBase: number; comprasIva: number }>();
  let totalVentas = 0;
  let totalCompras = 0;
  let totalBaseImponible = 0;
  let ivaRepercutido = 0;
  let ivaSoportado = 0;

  for (const inv of invoices) {
    const isVenta = inv.invoice_type === 'issued';
    const monthKey = `${inv.issue_date.getFullYear()}-${String(inv.issue_date.getMonth() + 1).padStart(2, '0')}`;
    const m = monthlyMap.get(monthKey) ?? { ventas: 0, compras: 0 };
    if (isVenta) {
      m.ventas += inv.total_amount;
      totalVentas += inv.total_amount;
    } else {
      m.compras += inv.total_amount;
      totalCompras += inv.total_amount;
    }
    monthlyMap.set(monthKey, m);

    const rate = Math.round(inv.tax_rate ?? 0);
    const r = rateMap.get(rate) ?? { ventasBase: 0, ventasIva: 0, comprasBase: 0, comprasIva: 0 };
    if (isVenta) {
      r.ventasBase += inv.subtotal;
      r.ventasIva += inv.tax_amount;
      ivaRepercutido += inv.tax_amount;
    } else {
      r.comprasBase += inv.subtotal;
      r.comprasIva += inv.tax_amount;
      ivaSoportado += inv.tax_amount;
    }
    rateMap.set(rate, r);
    totalBaseImponible += inv.subtotal;
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
    totalBaseImponible,
    ivaRepercutido,
    ivaSoportado,
    resultadoOrientativo: ivaRepercutido - ivaSoportado,
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

export function generateResumenCSV(summary: FiscalSummary, specialExpenses?: SpecialExpenseEntry[]): string {
  const lines: string[] = [];

  lines.push(escapeCSV(`Resumen fiscal trimestral — ${summary.periodLabel}`));
  lines.push(escapeCSV('Documento informativo para revisión por la empresa o gestoría. No es la declaración oficial del Modelo 303.'));
  lines.push('');

  lines.push(['Mes', 'Ventas', 'Compras/Gastos'].join(CSV_DELIMITER));
  for (const m of summary.monthly) {
    lines.push([m.month, m.ventas.toFixed(2), m.compras.toFixed(2)].join(CSV_DELIMITER));
  }
  lines.push('');

  lines.push([
    'Tipo IVA (%)', 'Base ventas', 'IVA ventas', 'Base compras', 'IVA compras',
  ].join(CSV_DELIMITER));
  for (const r of summary.rates) {
    lines.push([
      `${r.rate}%`, r.ventasBase.toFixed(2), r.ventasIva.toFixed(2), r.comprasBase.toFixed(2), r.comprasIva.toFixed(2),
    ].join(CSV_DELIMITER));
  }
  lines.push('');

  lines.push(['Total ventas', summary.totalVentas.toFixed(2)].join(CSV_DELIMITER));
  lines.push(['Total compras/gastos', summary.totalCompras.toFixed(2)].join(CSV_DELIMITER));
  lines.push(['Base imponible total', summary.totalBaseImponible.toFixed(2)].join(CSV_DELIMITER));
  lines.push(['IVA repercutido (ventas)', summary.ivaRepercutido.toFixed(2)].join(CSV_DELIMITER));
  lines.push(['IVA soportado (compras)', summary.ivaSoportado.toFixed(2)].join(CSV_DELIMITER));
  lines.push(['Resultado orientativo (repercutido - soportado)', summary.resultadoOrientativo.toFixed(2)].join(CSV_DELIMITER));

  if (specialExpenses && specialExpenses.length > 0) {
    lines.push('');
    lines.push(escapeCSV('Gastos especiales (documentación complementaria)'));
    lines.push(['Categoría', 'Estado'].join(CSV_DELIMITER));
    for (const e of specialExpenses) {
      lines.push([
        escapeCSV(e.label),
        escapeCSV(e.count > 0 ? `Existe documentación complementaria para revisión (${e.count})` : 'Sin documentación'),
      ].join(CSV_DELIMITER));
    }
  }

  // UTF-8 BOM + CRLF — same convention as lib/csv-generator.ts
  return '﻿' + lines.join('\r\n');
}
