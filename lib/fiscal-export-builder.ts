// Shared plan + ZIP-building logic for the "Paquete trimestral" family of
// exports. Used by both the gestoría route
// (app/api/gestoria/clients/[clientCompanyId]/fiscal-export/**) and the
// company-side route (app/api/fiscal-export/**) — extracted so neither
// duplicates the other. Extracted, behavior-preserving refactor of what
// already worked in the gestoría route, plus: mode 'complete' now also adds
// caja_tpv.csv, control_tpv_vs_facturacion.csv, and a "Gastos especiales"
// section inside resumen_fiscal.csv.
import { prisma } from './prisma';
import { createFiscalExportBatchToken, FiscalExportBatchPayload } from './batch-token';
import { getFiscalQuarterInfo, FiscalQuarter } from './fiscal-calendar';
import { getSignedDownloadUrl } from './storage';
import { buildFiscalSummary, generateResumenCSV } from './fiscal-summary';
import { buildSpecialExpensesSummary } from './special-expenses';
import { buildTpvControlReport, generateTpvControlCSV } from './tpv-control';
import { generateCajaCSV } from './caja-csv';
import { generateCSV } from './csv-generator';
import { FISCAL_DOCUMENT_TYPE_LABELS_ES } from './fiscal-document-types';

export type FiscalExportMode = 'csv' | 'fiscal' | 'complete';

const MAX_DOCS_PER_BATCH = 25;
const MAX_ESTIMATED_SIZE_MB = 80;
const MAX_DOCS_TOTAL = 5000;
const AVG_DOC_SIZE_BYTES = 200 * 1024;

export function getPeriodRange(year: number, quarter: number | 'annual'): { start: Date; end: Date; label: string } {
  if (quarter === 'annual') {
    return {
      start: new Date(year, 0, 1),
      end: new Date(year, 11, 31, 23, 59, 59, 999),
      label: `Año ${year}`,
    };
  }
  const info = getFiscalQuarterInfo(year, quarter as FiscalQuarter);
  return { start: info.period_start, end: info.period_end, label: `Q${quarter} ${year}` };
}

// Docs tagged for a specific quarter of `year`, plus any doc tagged "annual"
// for that same year (applies to the whole year regardless of quarter picked).
export function fiscalDocPeriodFilter(quarter: number | 'annual') {
  if (quarter === 'annual') return undefined;
  return { in: [`Q${quarter}`, 'annual'] };
}

export interface FiscalExportPlanResult {
  mode: FiscalExportMode;
  year: number;
  quarter: number | 'annual';
  periodLabel: string;
  totalDocuments: number;
  batchCount: number;
  batches: {
    batchIndex: number;
    fromItem: number;
    toItem: number;
    documentCount: number;
    estimatedSizeMB: number;
    token: string;
  }[];
}

export async function planFiscalExport(
  companyId: string,
  year: number,
  quarter: number | 'annual',
  mode: FiscalExportMode,
): Promise<FiscalExportPlanResult | { error: 'TOO_MANY_DOCUMENTS'; totalDocuments: number }> {
  const { label: periodLabel } = getPeriodRange(year, quarter);

  const includesDocs = mode === 'fiscal' || mode === 'complete';
  const period = fiscalDocPeriodFilter(quarter);
  const docsWhere = {
    company_id: companyId,
    fiscal_year: year,
    ...(period ? { fiscal_period: period } : {}),
  };

  const totalDocuments = includesDocs ? await prisma.fiscalDocument.count({ where: docsWhere }) : 0;

  if (totalDocuments > MAX_DOCS_TOTAL) {
    return { error: 'TOO_MANY_DOCUMENTS', totalDocuments };
  }

  const docsPerBatch = Math.min(
    MAX_DOCS_PER_BATCH,
    Math.floor((MAX_ESTIMATED_SIZE_MB * 1024 * 1024) / AVG_DOC_SIZE_BYTES),
  );

  // At least one batch always exists — batch 0 carries the CSVs even if there
  // are zero fiscal documents to attach.
  const batchCount = totalDocuments > 0 ? Math.ceil(totalDocuments / docsPerBatch) : 1;

  const batches = Array.from({ length: batchCount }, (_, i) => {
    const offset = i * docsPerBatch;
    const count = totalDocuments > 0 ? Math.min(docsPerBatch, totalDocuments - offset) : 0;
    const token = createFiscalExportBatchToken(companyId, mode, year, quarter, i, offset, count);
    return {
      batchIndex: i,
      fromItem: count > 0 ? offset + 1 : 0,
      toItem: offset + count,
      documentCount: count,
      estimatedSizeMB: Math.round((count * AVG_DOC_SIZE_BYTES) / (1024 * 1024)),
      token,
    };
  });

  return { mode, year, quarter, periodLabel, totalDocuments, batchCount, batches };
}

function sanitizePart(s: string, maxLen = 40): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase()
    .slice(0, maxLen) || 'DESCONOCIDO';
}

function indiceCSV(docs: {
  original_filename: string; document_type: string; fiscal_year: number;
  fiscal_period: string; description: string | null; created_at: Date; status: string;
}[]): string {
  const CSV_DELIMITER = ';';
  const escape = (v: string) => {
    if (!v) return '';
    const s = String(v);
    return (s.includes(CSV_DELIMITER) || s.includes('"') || s.includes('\n'))
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = ['filename', 'documentType', 'fiscalYear', 'fiscalQuarter', 'description', 'uploadedAt', 'reviewedStatus'];
  const rows = docs.map((d) => [
    escape(d.original_filename),
    escape(FISCAL_DOCUMENT_TYPE_LABELS_ES[d.document_type as keyof typeof FISCAL_DOCUMENT_TYPE_LABELS_ES] ?? d.document_type),
    String(d.fiscal_year),
    d.fiscal_period,
    escape(d.description ?? ''),
    d.created_at.toISOString(),
    d.status,
  ].join(CSV_DELIMITER));
  return '﻿' + [headers.join(CSV_DELIMITER), ...rows].join('\r\n');
}

export interface FiscalExportZipResult {
  files: Record<string, [Uint8Array, { level: 0 }]>;
  recordCount: number;
}

export async function buildFiscalExportZipFiles(
  companyId: string,
  payload: FiscalExportBatchPayload,
): Promise<FiscalExportZipResult> {
  const { mode, year, quarter, batchIndex, offset, count } = payload;
  const { start, end, label } = getPeriodRange(year, quarter);

  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  const errors: string[] = [];
  let recordCount = 0;

  // Batch 0 carries the CSVs (resumen + facturas + caja/TPV + control + índice)
  // regardless of size — they're tiny text files and don't need to be split
  // like the document ZIPs do.
  if (batchIndex === 0) {
    if (mode === 'csv' || mode === 'complete') {
      const fiscalPeriodTag = quarter === 'annual' ? 'annual' : `Q${quarter}`;
      const [summary, specialExpenses] = await Promise.all([
        buildFiscalSummary(companyId, start, end, label),
        buildSpecialExpensesSummary(companyId, year, fiscalPeriodTag),
      ]);
      files['resumen_fiscal.csv'] = [new TextEncoder().encode(generateResumenCSV(summary, specialExpenses)), { level: 0 }];

      const invoices = await prisma.invoice.findMany({
        where: { company_id: companyId, issue_date: { gte: start, lte: end } },
        include: { document: true },
        orderBy: { issue_date: 'asc' },
      });
      files['facturas.csv'] = [new TextEncoder().encode(generateCSV(invoices as any)), { level: 0 }];
      recordCount += invoices.length;
    }

    if (mode === 'complete') {
      const [registers, tpvReport] = await Promise.all([
        prisma.dailyCashRegister.findMany({
          where: { company_id: companyId, date: { gte: start, lte: end }, status: 'confirmed' },
          orderBy: { date: 'asc' },
        }),
        buildTpvControlReport(companyId, start, end, label),
      ]);
      files['caja_tpv.csv'] = [new TextEncoder().encode(generateCajaCSV(registers)), { level: 0 }];
      files['control_tpv_vs_facturacion.csv'] = [new TextEncoder().encode(generateTpvControlCSV(tpvReport)), { level: 0 }];
    }

    if (mode === 'fiscal' || mode === 'complete') {
      const docPeriod = fiscalDocPeriodFilter(quarter);
      const allDocs = await prisma.fiscalDocument.findMany({
        where: {
          company_id: companyId,
          fiscal_year: year,
          ...(docPeriod ? { fiscal_period: docPeriod } : {}),
        },
        orderBy: { created_at: 'asc' },
      });
      files['indice_documentacion_fiscal.csv'] = [new TextEncoder().encode(indiceCSV(allDocs)), { level: 0 }];
    }
  }

  // documentacion_fiscal/ folder — this batch's slice of original files
  if ((mode === 'fiscal' || mode === 'complete') && count > 0) {
    const docPeriod = fiscalDocPeriodFilter(quarter);
    const docs = await prisma.fiscalDocument.findMany({
      where: {
        company_id: companyId,
        fiscal_year: year,
        ...(docPeriod ? { fiscal_period: docPeriod } : {}),
      },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: count,
    });

    const usedNames = new Set<string>();
    for (const doc of docs) {
      try {
        const signedUrl = await getSignedDownloadUrl(doc.cloud_storage_path, 180);
        const res = await fetch(signedUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();

        const ext = doc.original_filename.includes('.')
          ? doc.original_filename.slice(doc.original_filename.lastIndexOf('.')).toLowerCase()
          : '.pdf';
        const typeLabel = sanitizePart(doc.document_type, 30);
        const date = doc.created_at.toISOString().slice(0, 10);
        const base = sanitizePart(doc.original_filename.slice(0, doc.original_filename.lastIndexOf('.')), 30);
        let name = `documentacion_fiscal/${typeLabel}_${date}_${base}${ext}`;
        if (usedNames.has(name)) {
          const n = name.slice(0, name.lastIndexOf('.'));
          const e = name.slice(name.lastIndexOf('.'));
          let i = 2;
          while (usedNames.has(`${n}_${i}${e}`)) i++;
          name = `${n}_${i}${e}`;
        }
        usedNames.add(name);
        files[name] = [new Uint8Array(buf), { level: 0 }];
        recordCount += 1;
      } catch (err: any) {
        errors.push(`${doc.original_filename}: ${err?.message ?? 'error desconocido'}`);
      }
    }
  }

  if (errors.length > 0) {
    const errText = `Archivos que no se pudieron incluir en este ZIP\nGenerado: ${new Date().toISOString()}\n\n${errors.join('\n')}`;
    files['_errores.txt'] = [new TextEncoder().encode(errText), { level: 0 }];
  }

  return { files, recordCount };
}

export function fiscalExportZipFilename(year: number, quarter: number | 'annual', batchIndex: number): string {
  const periodTag = quarter === 'annual' ? `ANUAL_${year}` : `Q${quarter}_${year}`;
  const batchLabel = String(batchIndex + 1).padStart(3, '0');
  return `exportacion_${periodTag}_lote${batchLabel}.zip`;
}
