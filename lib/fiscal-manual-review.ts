// "manual_review.csv" — separate listing of invoices whose fiscal_status is
// 'manual_review': local classification failed AND the VAT-only Gemini
// second pass (lib/ai-extraction.ts extractVatBreakdown) either wasn't able
// to resolve it or was never reconciled. These need a human at the gestoría
// to open the document — the regular resumen/detalle CSVs never guess a
// rate for them.
import { prisma } from './prisma';

const CSV_DELIMITER = ';';

export interface ManualReviewRow {
  fecha: string;
  numeroFactura: string;
  contraparte: string;
  tipo: 'emitida' | 'recibida';
  total: number;
  motivo: string;
}

const REASON_LABELS: Record<string, string> = {
  'ai-unresolved-no-data': 'Sin líneas ni cabecera con IVA — la IA no pudo determinar el desglose',
  'ai-unresolved-multi-rate': 'Líneas con varios tipos de IVA que no cuadran, y la IA tampoco pudo reconciliarlas',
  'ai-unresolved-no-reconcile': 'La IA devolvió un desglose pero no cuadra con la base/cuota de cabecera',
  'ai-unresolved-empty': 'La IA no pudo leer el desglose de IVA en el documento',
  'ai-unresolved-error': 'Fallo técnico al intentar la verificación con IA',
};

export async function buildManualReviewList(companyId: string, from: Date, to: Date): Promise<ManualReviewRow[]> {
  const invoices = await prisma.invoice.findMany({
    where: { company_id: companyId, issue_date: { gte: from, lte: to }, fiscal_status: 'manual_review' },
    select: {
      invoice_number: true,
      issue_date: true,
      invoice_type: true,
      supplier_name: true,
      customer_name: true,
      total_amount: true,
      fiscal_status_reason: true,
    },
    orderBy: { issue_date: 'asc' },
  });

  return invoices.map((inv) => {
    const isVenta = inv.invoice_type === 'issued';
    return {
      fecha: inv.issue_date.toISOString().slice(0, 10),
      numeroFactura: inv.invoice_number,
      contraparte: isVenta ? inv.customer_name : inv.supplier_name,
      tipo: isVenta ? 'emitida' as const : 'recibida' as const,
      total: inv.total_amount,
      motivo: REASON_LABELS[inv.fiscal_status_reason ?? ''] ?? 'Pendiente de revisión manual',
    };
  });
}

function escapeCSV(value: string): string {
  if (!value) return '';
  const s = String(value);
  if (s.includes(CSV_DELIMITER) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function generateManualReviewCSV(rows: ManualReviewRow[]): string {
  const lines: string[] = [];
  lines.push(escapeCSV('Facturas pendientes de revisión manual (clasificación fiscal)'));
  lines.push(escapeCSV('La validación local y la verificación con IA no pudieron determinar el desglose de IVA — revisar el documento original.'));
  lines.push('');
  lines.push(['fecha', 'numero_factura', 'cliente_proveedor', 'tipo', 'total', 'motivo'].join(CSV_DELIMITER));
  for (const r of rows) {
    lines.push([
      r.fecha,
      escapeCSV(r.numeroFactura),
      escapeCSV(r.contraparte),
      r.tipo,
      r.total.toFixed(2),
      escapeCSV(r.motivo),
    ].join(CSV_DELIMITER));
  }
  if (rows.length === 0) {
    lines.push(escapeCSV('Ninguna factura pendiente de revisión manual en este periodo.'));
  }
  return '﻿' + lines.join('\r\n');
}
