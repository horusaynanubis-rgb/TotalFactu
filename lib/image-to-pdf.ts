// Export A3 (2026-09) — temporary, in-memory image→PDF conversion used ONLY
// by app/api/gestoria/clients/[clientCompanyId]/documents/export-zip/route.ts.
// A3 (accounting software) does not import images as justificantes, only
// PDFs. This module never touches Supabase Storage, Document, or Invoice —
// it is a pure Buffer-in/Buffer-out conversion, called per-file inside the
// export request and discarded once the ZIP response is sent.
import { PDFDocument, degrees } from 'pdf-lib';

export type SniffedMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'unknown';

/** Magic-byte sniffing — the same 3 signatures already used elsewhere in this
 * codebase (lib/document-file.ts, app/api/webhooks/telegram/route.ts), kept
 * as a small local copy here rather than a shared refactor, to keep this
 * change scoped to the A3 export only. */
export function sniffFileMime(buf: Buffer): SniffedMime {
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'application/pdf';
  return 'unknown';
}

/**
 * Reads the EXIF Orientation tag (0x0112) from a JPEG's APP1/Exif segment.
 * Returns null when there is no Exif segment at all (e.g. Telegram-recompressed
 * photos, which typically bake rotation into the pixels and drop Exif).
 * Returns 0 when an Exif segment exists but has no Orientation tag.
 *
 * Defensive addition (2026-09): this repo's local dev environment has no
 * Supabase Storage credentials, so the planned empirical check against real
 * production JPEGs could not run. Rather than assume orientation is never an
 * issue, every JPEG is corrected here if — and only if — it actually carries
 * a non-default Orientation tag. Normal photos (no tag, or tag=1) are
 * completely unaffected.
 */
export function getJpegExifOrientation(buf: Buffer): number | null {
  let offset = 2; // skip FFD8 (SOI)
  while (offset < buf.length - 3) {
    if (buf[offset] !== 0xff) { offset++; continue; }
    const marker = buf[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break; // EOI or start-of-scan — no more header markers
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    if (offset + 4 > buf.length) break;
    const len = buf.readUInt16BE(offset + 2);
    if (marker === 0xe1 && offset + 4 + 6 <= buf.length) {
      const segStart = offset + 4;
      if (buf.toString('ascii', segStart, segStart + 4) === 'Exif') {
        const tiffStart = segStart + 6;
        if (tiffStart + 8 > buf.length) return 0;
        const byteOrder = buf.toString('ascii', tiffStart, tiffStart + 2);
        const little = byteOrder === 'II';
        const readU16 = (o: number) => (little ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
        const readU32 = (o: number) => (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
        const ifd0Offset = tiffStart + readU32(tiffStart + 4);
        if (ifd0Offset + 2 > buf.length) return 0;
        const numEntries = readU16(ifd0Offset);
        for (let i = 0; i < numEntries; i++) {
          const entryOffset = ifd0Offset + 2 + i * 12;
          if (entryOffset + 10 > buf.length) break;
          if (readU16(entryOffset) === 0x0112) return readU16(entryOffset + 8);
        }
        return 0;
      }
    }
    offset += 2 + len;
  }
  return null;
}

export class ImageConversionError extends Error {}

/**
 * Converts a single JPEG/PNG image (raw bytes) into a single-page PDF,
 * embedding the original compressed image stream as-is (pdf-lib does not
 * re-encode JPEG/PNG pixel data — only wraps it in a PDF container), so the
 * resulting file is only a few KB larger than the source image.
 *
 * JPEG orientation 3/6/8 (the only ones real cameras commonly produce) are
 * corrected by sizing the page to the DISPLAY dimensions and rotating the
 * drawn image accordingly — see the geometry comment below. Any other
 * orientation value (rare mirrored variants, or none at all) is drawn
 * unrotated, which matches today's (pre-conversion) behavior exactly.
 */
export async function convertImageToPdf(bytes: Buffer, mimeType: 'image/jpeg' | 'image/png'): Promise<Buffer> {
  try {
    const pdfDoc = await PDFDocument.create();
    // pdf-lib's embedders read `imageData.buffer` directly (ignoring
    // byteOffset/length) — a Node Buffer's `.buffer` can be a larger SHARED
    // pool ArrayBuffer for small allocations, which would make pdf-lib parse
    // the wrong bytes entirely (silently, or "SOI not found"). Uint8Array.from()
    // always allocates its own dedicated ArrayBuffer at offset 0 of the exact
    // right length, so this is safe regardless of how `bytes` was produced.
    const safeBytes = Uint8Array.from(bytes);
    const image = mimeType === 'image/jpeg' ? await pdfDoc.embedJpg(safeBytes) : await pdfDoc.embedPng(safeBytes);
    const rawWidth = image.width;
    const rawHeight = image.height;

    const orientation = mimeType === 'image/jpeg' ? getJpegExifOrientation(bytes) : null;

    // Geometry derived from first principles (pdf-lib rotates counter-
    // clockwise for positive degrees, around the drawImage x/y anchor):
    //   orientation 6 (needs 90° CW correction): page=[rawH,rawW], anchor=(0,rawW),      rotate=-90
    //   orientation 8 (needs 90° CCW correction): page=[rawH,rawW], anchor=(rawH,0),      rotate=+90
    //   orientation 3 (needs 180° correction):    page=[rawW,rawH], anchor=(rawW,rawH),   rotate=180
    //   anything else (1, null, or an unhandled mirrored variant):  page=[rawW,rawH], anchor=(0,0), rotate=0
    let pageWidth = rawWidth;
    let pageHeight = rawHeight;
    let anchorX = 0;
    let anchorY = 0;
    let angle = 0;

    if (orientation === 6) {
      pageWidth = rawHeight; pageHeight = rawWidth;
      anchorX = 0; anchorY = rawWidth;
      angle = -90;
    } else if (orientation === 8) {
      pageWidth = rawHeight; pageHeight = rawWidth;
      anchorX = rawHeight; anchorY = 0;
      angle = 90;
    } else if (orientation === 3) {
      anchorX = rawWidth; anchorY = rawHeight;
      angle = 180;
    }

    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    page.drawImage(image, {
      x: anchorX,
      y: anchorY,
      width: rawWidth,
      height: rawHeight,
      rotate: degrees(angle),
    });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  } catch (err: any) {
    throw new ImageConversionError(`No se pudo convertir la imagen a PDF: ${err?.message ?? 'error desconocido'}`);
  }
}
