import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { verifyBatchToken } from '@/lib/batch-token';
import { getSignedDownloadUrl } from '@/lib/storage';
import { zipSync } from 'fflate';
import { buildDocumentWhere } from '@/lib/gestoria-document-where';
import { sniffFileMime, convertImageToPdf, ImageConversionError } from '@/lib/image-to-pdf';
import { buildZipEntryName } from '@/lib/a3-export-naming';

// Allow up to 60 s on Vercel Pro for large batches
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

export async function GET(
  request: NextRequest,
  { params }: { params: { clientCompanyId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return Response.json({ error: 'Missing token' }, { status: 400 });
  }

  let payload;
  try {
    payload = verifyBatchToken(token);
  } catch {
    return Response.json({ error: 'Invalid token' }, { status: 403 });
  }

  if (!payload) {
    return Response.json({ error: 'Invalid or expired token' }, { status: 403 });
  }

  // Token must match the URL's clientCompanyId
  if (payload.cid !== params.clientCompanyId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const access = await resolveGestoriaAccess(session.user.id, params.clientCompanyId);
  if (!access) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { from, to, type, status, offset, count, batchIndex } = payload;
  const fromDate = new Date(from);
  const toDate = new Date(to);
  toDate.setUTCHours(23, 59, 59, 999);

  const where = buildDocumentWhere(params.clientCompanyId, fromDate, toDate, type, status);

  const documents = await prisma.document.findMany({
    where,
    include: {
      invoice: {
        select: {
          invoice_type: true,
          invoice_number: true,
          issue_date: true,
          supplier_name: true,
          total_amount: true,
        },
      },
    },
    orderBy: [{ upload_timestamp: 'asc' }, { id: 'asc' }],
    skip: offset,
    take: count,
  });

  // Download each file and build the ZIP
  const files: { [path: string]: [Uint8Array, { level: 0 }] } = {};
  const errors: string[] = [];
  const usedNames = new Set<string>();

  for (const doc of documents) {
    try {
      const signedUrl = await getSignedDownloadUrl(doc.cloud_storage_path, 180);
      const res = await fetch(signedUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());

      // A3 export (2026-09): decide PDF-passthrough vs. image→PDF conversion
      // by the REAL file content (magic bytes), never by Document.mime_type
      // or the filename extension — a document's stored/declared type can be
      // stale or wrong. Document itself is never written to here.
      const sniffed = sniffFileMime(buf);
      if (sniffed !== doc.mime_type) {
        // Safe, non-sensitive diagnostic only — no invoice/document content,
        // just the type mismatch. Never persisted, never modifies Document.
        console.warn(
          `[a3-export] MIME mismatch documentId=${doc.id} db_mime_type=${doc.mime_type} sniffed=${sniffed}`,
        );
      }

      let pdfBytes: Buffer;
      if (sniffed === 'application/pdf') {
        pdfBytes = buf; // byte-for-byte passthrough
      } else if (sniffed === 'image/jpeg' || sniffed === 'image/png') {
        pdfBytes = await convertImageToPdf(buf, sniffed);
      } else {
        throw new Error('Formato de archivo no reconocido (no es PDF, JPEG ni PNG) — no se puede generar un PDF para A3');
      }

      const entryName = buildZipEntryName(doc, usedNames);
      // level: 0 = store (no re-compression) — these are already PDFs (original or just-generated)
      files[entryName] = [new Uint8Array(pdfBytes), { level: 0 }];
    } catch (err: any) {
      const reason = err instanceof ImageConversionError
        ? err.message
        : (err?.message ?? 'error desconocido');
      errors.push(`${doc.original_filename}: ${reason}`);
    }
  }

  if (errors.length > 0) {
    const errText =
      `Archivos que no se pudieron incluir en este ZIP\n` +
      `Generado: ${new Date().toISOString()}\n\n` +
      errors.join('\n');
    files['_errores.txt'] = [new TextEncoder().encode(errText), { level: 0 }];
  }

  if (Object.keys(files).length === 0) {
    return Response.json({ error: 'No documents could be downloaded' }, { status: 500 });
  }

  const zipBuffer = zipSync(files);

  const batchLabel = String(batchIndex + 1).padStart(3, '0');
  const zipFilename = `documentos_${from}_${to}_lote${batchLabel}.zip`;

  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipFilename}"`,
      'Content-Length': String(zipBuffer.byteLength),
    },
  });
}
