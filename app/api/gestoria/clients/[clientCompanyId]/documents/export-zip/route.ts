import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options';
import { prisma } from '@/lib/prisma';
import { verifyBatchToken } from '@/lib/batch-token';
import { getSignedDownloadUrl } from '@/lib/storage';
import { zipSync } from 'fflate';
import { buildDocumentWhere } from '@/lib/gestoria-document-where';

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

/** Strip diacritics, keep alphanumeric + safe chars, uppercase, max 40 chars */
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

function buildZipEntryName(
  doc: {
    original_filename: string;
    upload_timestamp: Date;
    invoice?: {
      invoice_type: string;
      invoice_number: string | null;
      issue_date: Date | null;
      supplier_name: string | null;
      total_amount: number | null;
    } | null;
  },
  usedNames: Set<string>,
): string {
  const folder =
    doc.invoice?.invoice_type === 'received' ? 'recibidas' :
    doc.invoice?.invoice_type === 'issued'   ? 'emitidas' :
    'sin_clasificar';

  const refDate = doc.invoice?.issue_date ?? doc.upload_timestamp;
  const date = new Date(refDate).toISOString().slice(0, 10);

  const ext = doc.original_filename.includes('.')
    ? doc.original_filename.slice(doc.original_filename.lastIndexOf('.')).toLowerCase()
    : '.pdf';

  let name: string;
  if (doc.invoice) {
    const supplier  = sanitizePart(doc.invoice.supplier_name ?? 'DESCONOCIDO', 30);
    const invoiceNo = sanitizePart(doc.invoice.invoice_number ?? 'SN', 30);
    const total     = (doc.invoice.total_amount ?? 0).toFixed(2).replace('.', '-');
    name = `${folder}/${date}_${supplier}_${invoiceNo}_${total}${ext}`;
  } else {
    const base = sanitizePart(
      doc.original_filename.slice(0, doc.original_filename.lastIndexOf('.')), 40,
    );
    name = `${folder}/${date}_${base}${ext}`;
  }

  // Deduplicate
  if (usedNames.has(name)) {
    const base = name.slice(0, name.lastIndexOf('.'));
    const xExt = name.slice(name.lastIndexOf('.'));
    let n = 2;
    while (usedNames.has(`${base}_${n}${xExt}`)) n++;
    name = `${base}_${n}${xExt}`;
  }
  usedNames.add(name);
  return name;
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
      const buf = await res.arrayBuffer();
      const entryName = buildZipEntryName(doc, usedNames);
      // level: 0 = store (no re-compression) — PDFs are already compressed
      files[entryName] = [new Uint8Array(buf), { level: 0 }];
    } catch (err: any) {
      errors.push(`${doc.original_filename}: ${err?.message ?? 'error desconocido'}`);
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
