import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { verifyFiscalExportBatchToken } from '@/lib/batch-token';
import { getSignedDownloadUrl } from '@/lib/storage';
import { zipSync } from 'fflate';
import { getFiscalQuarterInfo, FiscalQuarter } from '@/lib/fiscal-calendar';
import { buildFiscalSummary, generateResumenCSV } from '@/lib/fiscal-summary';
import { generateCSV } from '@/lib/csv-generator';
import { FISCAL_DOCUMENT_TYPE_LABELS_ES } from '@/lib/fiscal-document-types';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

async function resolveGestoriaAccess(userId: string, clientCompanyId: string) {
  const membership = await prisma.membership.findFirst({
    where: { user_id: userId },
    select: { company_id: true, company: { select: { company_type: true } } },
  });
  if (!membership || membership.company.company_type !== 'gestoria') return null;

  const license = await prisma.license.findFirst({
    where: {
      client_company_id: clientCompanyId,
      status: 'assigned',
      pack: { gestoria_company_id: membership.company_id },
    },
  });
  if (!license) return null;

  return { gestoriaCompanyId: membership.company_id };
}

function getPeriodRange(year: number, quarter: number | 'annual'): { start: Date; end: Date; label: string } {
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

function fiscalDocPeriodFilter(quarter: number | 'annual') {
  if (quarter === 'annual') return undefined;
  return { in: [`Q${quarter}`, 'annual'] };
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

export async function GET(
  request: NextRequest,
  { params }: { params: { clientCompanyId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = request.nextUrl.searchParams.get('token');
  if (!token) return Response.json({ error: 'Missing token' }, { status: 400 });

  const payload = verifyFiscalExportBatchToken(token);
  if (!payload) return Response.json({ error: 'Invalid or expired token' }, { status: 403 });
  if (payload.cid !== params.clientCompanyId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) return Response.json({ error: 'Forbidden' }, { status: 403 });

  const { mode, year, quarter, batchIndex, offset, count } = payload;
  const { start, end, label } = getPeriodRange(year, quarter);

  const files: { [path: string]: [Uint8Array, { level: 0 }] } = {};
  const errors: string[] = [];

  // Batch 0 carries the CSVs (resumen + facturas + índice) regardless of size —
  // they're tiny text files and don't need to be split like the document ZIPs do.
  if (batchIndex === 0) {
    if (mode === 'csv' || mode === 'complete') {
      const summary = await buildFiscalSummary(params.clientCompanyId, start, end, label);
      files['resumen_trimestral.csv'] = [new TextEncoder().encode(generateResumenCSV(summary)), { level: 0 }];

      const invoices = await prisma.invoice.findMany({
        where: { company_id: params.clientCompanyId, issue_date: { gte: start, lte: end } },
        include: { document: true },
        orderBy: { issue_date: 'asc' },
      });
      files['facturas.csv'] = [new TextEncoder().encode(generateCSV(invoices as any)), { level: 0 }];
    }

    if (mode === 'fiscal' || mode === 'complete') {
      const docPeriod = fiscalDocPeriodFilter(quarter);
      const allDocs = await prisma.fiscalDocument.findMany({
        where: {
          company_id: params.clientCompanyId,
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
        company_id: params.clientCompanyId,
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
      } catch (err: any) {
        errors.push(`${doc.original_filename}: ${err?.message ?? 'error desconocido'}`);
      }
    }
  }

  if (errors.length > 0) {
    const errText = `Archivos que no se pudieron incluir en este ZIP\nGenerado: ${new Date().toISOString()}\n\n${errors.join('\n')}`;
    files['_errores.txt'] = [new TextEncoder().encode(errText), { level: 0 }];
  }

  if (Object.keys(files).length === 0) {
    return Response.json({ error: 'Nothing to export for this batch' }, { status: 500 });
  }

  const zipBuffer = zipSync(files);
  const periodTag = quarter === 'annual' ? `ANUAL_${year}` : `Q${quarter}_${year}`;
  const batchLabel = String(batchIndex + 1).padStart(3, '0');
  const zipFilename = `exportacion_${periodTag}_lote${batchLabel}.zip`;

  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipFilename}"`,
      'Content-Length': String(zipBuffer.byteLength),
    },
  });
}
