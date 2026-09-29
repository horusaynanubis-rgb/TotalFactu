// Filename convention for the "Export A3" ZIP
// (app/api/gestoria/clients/[clientCompanyId]/documents/export-zip/route.ts).
// Extracted to its own module (2026-09, Export A3 PDF-only change) purely so
// it can be unit-tested — Next.js route.ts files may only export the
// reserved handler/config names, not arbitrary helpers.

/** Strip diacritics, keep alphanumeric + safe chars, uppercase, max 40 chars */
export function sanitizePart(s: string, maxLen = 40): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase()
    .slice(0, maxLen) || 'DESCONOCIDO';
}

export interface A3ZipDoc {
  original_filename: string;
  upload_timestamp: Date;
  invoice?: {
    invoice_type: string;
    invoice_number: string | null;
    issue_date: Date | null;
    supplier_name: string | null;
    total_amount: number | null;
  } | null;
}

/**
 * A3 only imports PDF justificantes — every entry this produces ends in
 * .pdf, regardless of the original file's real format or filename extension
 * (JPEG/PNG originals are converted to PDF before reaching this function —
 * see lib/image-to-pdf.ts and the export-zip route).
 */
export function buildZipEntryName(doc: A3ZipDoc, usedNames: Set<string>): string {
  const folder =
    doc.invoice?.invoice_type === 'received' ? 'recibidas' :
    doc.invoice?.invoice_type === 'issued'   ? 'emitidas' :
    'sin_clasificar';

  const refDate = doc.invoice?.issue_date ?? doc.upload_timestamp;
  const date = new Date(refDate).toISOString().slice(0, 10);

  const ext = '.pdf';

  let name: string;
  if (doc.invoice) {
    const supplier  = sanitizePart(doc.invoice.supplier_name ?? 'DESCONOCIDO', 30);
    const invoiceNo = sanitizePart(doc.invoice.invoice_number ?? 'SN', 30);
    const total     = (doc.invoice.total_amount ?? 0).toFixed(2).replace('.', '-');
    name = `${folder}/${date}_${supplier}_${invoiceNo}_${total}${ext}`;
  } else {
    const dotIndex = doc.original_filename.lastIndexOf('.');
    const base = sanitizePart(
      dotIndex > 0 ? doc.original_filename.slice(0, dotIndex) : doc.original_filename, 40,
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
