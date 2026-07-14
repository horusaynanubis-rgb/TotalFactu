// "detalle_iva.csv" — one row per invoice for the period, showing which IVA
// rate bucket it falls into so gestoría can filter/group by 4% / 10% / 21% /
// sin clasificar without opening each invoice. Shares classification logic
// with lib/fiscal-summary.ts (lib/iva-classification.ts) so the per-invoice
// listing always agrees with the aggregate totals.
import { prisma } from './prisma';
import { classifyInvoiceRate, ivaClassificationObservation, IvaRateBreakdownEntry } from './iva-classification';

const CSV_DELIMITER = ';';

export interface IvaDetalleRow {
  fecha: string;
  numeroFactura: string;
  contraparte: string;
  tipo: 'emitida' | 'recibida';
  baseImponible: number;
  tipoIva: number | null; // null = sin clasificar
  cuotaIva: number;
  total: number;
  origen: string;
  estadoClasificacion: 'clasificada (cabecera)' | 'clasificada (líneas)' | 'clasificada (calculada)' | 'clasificada (IA)' | 'pendiente de clasificación';
  observaciones: string;
}

const SOURCE_CHANNEL_LABELS: Record<string, string> = {
  web: 'Web',
  telegram: 'Telegram',
  email: 'Email',
};

export async function buildIvaDetalle(companyId: string, from: Date, to: Date): Promise<IvaDetalleRow[]> {
  const invoices = await prisma.invoice.findMany({
    where: { company_id: companyId, issue_date: { gte: from, lte: to } },
    select: {
      invoice_number: true,
      issue_date: true,
      invoice_type: true,
      supplier_name: true,
      customer_name: true,
      subtotal: true,
      tax_amount: true,
      total_amount: true,
      tax_rate: true,
      ai_vat_breakdown: true,
      invoice_lines: { select: { tax_rate: true, total_amount: true } },
      document: { select: { source_channel: true } },
    },
    orderBy: { issue_date: 'asc' },
  });

  const rows: IvaDetalleRow[] = [];
  for (const inv of invoices) {
    const isVenta = inv.invoice_type === 'issued';
    let aiBreakdown: IvaRateBreakdownEntry[] | null = null;
    if (inv.ai_vat_breakdown) {
      try { aiBreakdown = JSON.parse(inv.ai_vat_breakdown); } catch { aiBreakdown = null; }
    }
    const classification = classifyInvoiceRate(inv.tax_rate, inv.invoice_lines, inv.subtotal, inv.tax_amount, aiBreakdown);
    const fecha = inv.issue_date.toISOString().slice(0, 10);
    const contraparte = isVenta ? inv.customer_name : inv.supplier_name;
    const tipo = isVenta ? 'emitida' as const : 'recibida' as const;
    const origen = SOURCE_CHANNEL_LABELS[inv.document?.source_channel ?? ''] ?? (inv.document?.source_channel ?? 'Desconocido');

    if (classification.breakdown) {
      // One row per rate the invoice actually touches (mixed lines reconciled,
      // or a multi-rate AI answer), so the detail listing stays consistent
      // with the split applied in the aggregate summary.
      const estado = classification.source === 'ai-vat' ? 'clasificada (IA)' as const : 'clasificada (líneas)' as const;
      for (const entry of classification.breakdown) {
        rows.push({
          fecha,
          numeroFactura: inv.invoice_number,
          contraparte,
          tipo,
          baseImponible: entry.base,
          tipoIva: entry.rate,
          cuotaIva: entry.iva,
          total: entry.base + entry.iva,
          origen,
          estadoClasificacion: estado,
          observaciones: ivaClassificationObservation(classification),
        });
      }
      continue;
    }

    const estadoClasificacion =
      classification.source === 'header' ? 'clasificada (cabecera)' as const :
      classification.source === 'lines' ? 'clasificada (líneas)' as const :
      classification.source === 'calc' ? 'clasificada (calculada)' as const :
      classification.source === 'ai-vat' ? 'clasificada (IA)' as const :
      'pendiente de clasificación' as const;

    rows.push({
      fecha,
      numeroFactura: inv.invoice_number,
      contraparte,
      tipo,
      baseImponible: inv.subtotal,
      tipoIva: classification.rate,
      cuotaIva: inv.tax_amount,
      total: inv.total_amount,
      origen,
      estadoClasificacion,
      observaciones: ivaClassificationObservation(classification),
    });
  }
  return rows;
}

function escapeCSV(value: string): string {
  if (!value) return '';
  const s = String(value);
  if (s.includes(CSV_DELIMITER) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function generateIvaDetalleCSV(rows: IvaDetalleRow[]): string {
  const headers = [
    'fecha', 'numero_factura', 'cliente_proveedor', 'tipo', 'base_imponible',
    'tipo_iva', 'cuota_iva', 'total', 'origen', 'estado_clasificacion', 'observaciones',
  ];

  const csvRows = rows.map((r) => [
    r.fecha,
    escapeCSV(r.numeroFactura),
    escapeCSV(r.contraparte),
    r.tipo,
    r.baseImponible.toFixed(2),
    r.tipoIva === null ? 'sin clasificar' : `${r.tipoIva}%`,
    r.cuotaIva.toFixed(2),
    r.total.toFixed(2),
    escapeCSV(r.origen),
    r.estadoClasificacion,
    escapeCSV(r.observaciones),
  ].join(CSV_DELIMITER));

  const totalBase = rows.reduce((s, r) => s + r.baseImponible, 0);
  const totalIva = rows.reduce((s, r) => s + r.cuotaIva, 0);
  const totalTotal = rows.reduce((s, r) => s + r.total, 0);
  const pendientes = rows.filter((r) => r.estadoClasificacion === 'pendiente de clasificación').length;

  const totalsRow = [
    'TOTAL', '', '', '', totalBase.toFixed(2), '', totalIva.toFixed(2), totalTotal.toFixed(2), '', `${pendientes} pendiente(s) de clasificación`, '',
  ].join(CSV_DELIMITER);

  return '﻿' + [headers.join(CSV_DELIMITER), ...csvRows, totalsRow].join('\r\n');
}
