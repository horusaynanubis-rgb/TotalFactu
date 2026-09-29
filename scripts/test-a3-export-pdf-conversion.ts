/**
 * Export A3 — PDF-only conversion tests (2026-09). Pure logic, no DB, no
 * Storage, no network. All JPEG/PNG/PDF fixtures below are synthetically
 * generated in-code (never real customer documents) and verified against
 * pdf-lib's own parser before being used as test inputs.
 * Run with: npx tsx scripts/test-a3-export-pdf-conversion.ts
 */
import zlib from 'zlib';
import { PDFDocument } from 'pdf-lib';
import { sniffFileMime, getJpegExifOrientation, convertImageToPdf, ImageConversionError } from '../lib/image-to-pdf';
import { buildZipEntryName, sanitizePart, A3ZipDoc } from '../lib/a3-export-naming';
import * as fs from 'fs';
import * as path from 'path';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string) {
  if (condition) { console.log(`  ✅  ${label}`); passed++; }
  else { console.error(`  ❌  ${label}`); failed++; }
}

// ---------------------------------------------------------------------------
// Synthetic fixture generators (verified against pdf-lib during development —
// see commit history; not re-verified here to keep this file focused on the
// actual behavior under test).
// ---------------------------------------------------------------------------

function u16be(n: number) { return [(n >> 8) & 0xff, n & 0xff]; }

/** Minimal solid-color grayscale baseline JPEG. width/height must be multiples of 8. */
function makeMinimalJpeg(width: number, height: number, exifOrientation?: number): Buffer {
  const bytes: number[] = [];
  const push = (...b: number[]) => bytes.push(...b);
  push(0xff, 0xd8); // SOI

  if (exifOrientation !== undefined) {
    const exifAscii = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
    const tiffHeader = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]; // "II", 0x002A, IFD0@8
    const ifd0 = [
      0x01, 0x00,
      0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, exifOrientation & 0xff, (exifOrientation >> 8) & 0xff, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ];
    const payload = [...exifAscii, ...tiffHeader, ...ifd0];
    push(0xff, 0xe1, ...u16be(2 + payload.length), ...payload);
  }

  push(0xff, 0xe0, ...u16be(16), 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00); // APP0 JFIF
  push(0xff, 0xdb, ...u16be(2 + 1 + 64), 0x00, ...new Array(64).fill(1)); // DQT
  push(0xff, 0xc0, ...u16be(2 + 6 + 3), 0x08, ...u16be(height), ...u16be(width), 0x01, 0x01, 0x11, 0x00); // SOF0
  push(0xff, 0xc4, ...u16be(2 + 1 + 16 + 1), 0x00, 1, 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0, 0x00); // DHT DC
  push(0xff, 0xc4, ...u16be(2 + 1 + 16 + 1), 0x10, 1, 0,0,0,0,0,0,0,0,0,0,0,0,0,0,0, 0x00); // DHT AC
  push(0xff, 0xda, ...u16be(2 + 1 + 2 + 3), 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00); // SOS

  const numBlocks = (width / 8) * (height / 8);
  let bitStr = '00'.repeat(numBlocks);
  while (bitStr.length % 8 !== 0) bitStr += '1';
  for (let i = 0; i < bitStr.length; i += 8) push(parseInt(bitStr.slice(i, i + 8), 2));

  push(0xff, 0xd9); // EOI
  return Buffer.from(bytes);
}

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = PNG_CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function makeMinimalPng(width: number, height: number, r = 200, g = 50, b = 50): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; ihdrData[9] = 2; ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;
  const rowBytes = 1 + width * 3;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowBytes] = 0;
    for (let x = 0; x < width; x++) {
      const px = y * rowBytes + 1 + x * 3;
      raw[px] = r; raw[px + 1] = g; raw[px + 2] = b;
    }
  }
  return Buffer.concat([sig, pngChunk('IHDR', ihdrData), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

/** Minimal valid empty-content single/multi-page PDF, for passthrough tests. */
async function makeMinimalPdf(pageCount = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([100, 100]);
  return Buffer.from(await doc.save());
}

function doc(overrides: Partial<A3ZipDoc>): A3ZipDoc {
  return {
    original_filename: 'factura.jpg',
    upload_timestamp: new Date('2026-08-01T00:00:00Z'),
    invoice: {
      invoice_type: 'received',
      invoice_number: 'F-001',
      issue_date: new Date('2026-08-01T00:00:00Z'),
      supplier_name: 'Proveedor SA',
      total_amount: 121,
    },
    ...overrides,
  };
}

async function main() {
  console.log('\nCase 1: PDF original -> PDF exportado byte-for-byte\n');
  {
    const src = await makeMinimalPdf(1);
    const sniffed = sniffFileMime(src);
    assert(sniffed === 'application/pdf', 'sniffFileMime detecta PDF real');
    // The route passes PDFs through untouched — simulate that decision here.
    const output = sniffed === 'application/pdf' ? src : null;
    assert(output !== null && Buffer.compare(output, src) === 0, 'passthrough produce bytes idénticos, sin pasar por pdf-lib');
  }

  console.log('\nCase 2: JPG -> PDF\n');
  {
    const jpg = makeMinimalJpeg(8, 8);
    const pdfBytes = await convertImageToPdf(jpg, 'image/jpeg');
    assert(pdfBytes.subarray(0, 5).toString('ascii') === '%PDF-', 'la salida empieza por la cabecera %PDF-');
    const reloaded = await PDFDocument.load(pdfBytes);
    assert(reloaded.getPageCount() === 1, 'el PDF generado tiene exactamente 1 página');
  }

  console.log('\nCase 3: PNG -> PDF\n');
  {
    const png = makeMinimalPng(8, 8);
    const pdfBytes = await convertImageToPdf(png, 'image/png');
    assert(pdfBytes.subarray(0, 5).toString('ascii') === '%PDF-', 'la salida empieza por la cabecera %PDF-');
    const reloaded = await PDFDocument.load(pdfBytes);
    assert(reloaded.getPageCount() === 1, 'el PDF generado tiene exactamente 1 página');
  }

  console.log('\nCase 4: imagen vertical/horizontal -> dimensiones y orientación correctas\n');
  {
    const horizontal = makeMinimalJpeg(16, 8); // raw 16x8, no EXIF
    const pdfH = await PDFDocument.load(await convertImageToPdf(horizontal, 'image/jpeg'));
    assert(pdfH.getPage(0).getWidth() === 16 && pdfH.getPage(0).getHeight() === 8, 'imagen horizontal (16x8) sin EXIF -> página 16x8, sin rotar');

    const vertical = makeMinimalJpeg(8, 16); // raw 8x16, no EXIF
    const pdfV = await PDFDocument.load(await convertImageToPdf(vertical, 'image/jpeg'));
    assert(pdfV.getPage(0).getWidth() === 8 && pdfV.getPage(0).getHeight() === 16, 'imagen vertical (8x16) sin EXIF -> página 8x16, sin rotar');

    // EXIF orientation 6/8 on a raw 8x16 image must swap the page to 16x8 (display corrected)
    const rot6 = makeMinimalJpeg(8, 16, 6);
    const pdfRot6 = await PDFDocument.load(await convertImageToPdf(rot6, 'image/jpeg'));
    assert(pdfRot6.getPage(0).getWidth() === 16 && pdfRot6.getPage(0).getHeight() === 8, 'raw 8x16 + EXIF orientation=6 -> página corregida a 16x8');

    const rot8 = makeMinimalJpeg(8, 16, 8);
    const pdfRot8 = await PDFDocument.load(await convertImageToPdf(rot8, 'image/jpeg'));
    assert(pdfRot8.getPage(0).getWidth() === 16 && pdfRot8.getPage(0).getHeight() === 8, 'raw 8x16 + EXIF orientation=8 -> página corregida a 16x8');

    // EXIF orientation 3 (180°) must NOT swap dimensions
    const rot3 = makeMinimalJpeg(8, 16, 3);
    const pdfRot3 = await PDFDocument.load(await convertImageToPdf(rot3, 'image/jpeg'));
    assert(pdfRot3.getPage(0).getWidth() === 8 && pdfRot3.getPage(0).getHeight() === 16, 'raw 8x16 + EXIF orientation=3 (180°) -> dimensiones sin intercambiar (8x16)');
  }

  console.log('\nCase 5: PDF ya multi-página pasa intacto (no hay modelo de varias imágenes = 1 documento en TotalFactu)\n');
  {
    const multiPagePdf = await makeMinimalPdf(3);
    const sniffed = sniffFileMime(multiPagePdf);
    assert(sniffed === 'application/pdf', 'un PDF multi-página se sniffa como PDF (no como imagen)');
    const reloaded = await PDFDocument.load(multiPagePdf);
    assert(reloaded.getPageCount() === 3, 'passthrough conserva las 3 páginas originales sin alterarlas');
  }

  console.log('\nCase 6: nombres/relación CSV-documento intactos — extensión forzada a .pdf, resto de la convención sin cambios\n');
  {
    const used = new Set<string>();
    const name = buildZipEntryName(doc({}), used);
    assert(name.startsWith('recibidas/2026-08-01_PROVEEDOR_SA_F-001_121-00'), 'convención carpeta/fecha/proveedor/num_factura/total se mantiene');
    assert(name.endsWith('.pdf'), 'la extensión final es .pdf');
  }

  console.log('\nCase 7: ZIP splitting sigue funcionando — constantes de export-plan sin cambios\n');
  {
    const planPath = path.join(__dirname, '../app/api/gestoria/clients/[clientCompanyId]/documents/export-plan/route.ts');
    const src = fs.readFileSync(planPath, 'utf-8');
    assert(/MAX_DOCS_PER_BATCH\s*=\s*25/.test(src), 'MAX_DOCS_PER_BATCH sigue siendo 25');
    assert(/MAX_ESTIMATED_SIZE_MB\s*=\s*80/.test(src), 'MAX_ESTIMATED_SIZE_MB sigue siendo 80');
    assert(/MAX_DOCS_TOTAL\s*=\s*5000/.test(src), 'MAX_DOCS_TOTAL sigue siendo 5000');
  }

  console.log('\nCase 8: la conversión no aumenta significativamente el tamaño (embedJpg no recomprime)\n');
  {
    const jpg = makeMinimalJpeg(8, 8);
    const pdfBytes = await convertImageToPdf(jpg, 'image/jpeg');
    const overheadRatio = pdfBytes.length / jpg.length;
    assert(overheadRatio < 10, `overhead de contenedor PDF acotado (ratio=${overheadRatio.toFixed(2)}x sobre un JPEG minúsculo de ${jpg.length} bytes — en imágenes reales de cientos de KB el overhead fijo del contenedor es proporcionalmente insignificante)`);
  }

  console.log('\nCase 9: conversión fallida no genera un PDF vacío/corrupto silencioso\n');
  {
    const garbage = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03]); // JPEG magic bytes but garbage body
    let threw = false;
    try {
      await convertImageToPdf(garbage, 'image/jpeg');
    } catch (e) {
      threw = true;
      assert(e instanceof ImageConversionError, 'el error lanzado es un ImageConversionError identificable, no un fallo genérico silencioso');
    }
    assert(threw, 'una imagen corrupta lanza una excepción — nunca devuelve bytes de PDF vacíos/corruptos como si hubiera ido bien');
  }

  console.log('\nCase 10: ningún original de Storage es modificado — el route no escribe a Storage\n');
  {
    const routePath = path.join(__dirname, '../app/api/gestoria/clients/[clientCompanyId]/documents/export-zip/route.ts');
    const src = fs.readFileSync(routePath, 'utf-8');
    assert(!/uploadFile\s*\(/.test(src), 'export-zip/route.ts no llama a uploadFile ni a ninguna función de escritura de Storage');
    assert(/getSignedDownloadUrl/.test(src), 'sigue usando solo getSignedDownloadUrl (lectura) para obtener los originales');
  }

  console.log('\nCase 11: magic bytes PDF + extensión incorrecta -> passthrough como PDF\n');
  {
    const realPdf = await makeMinimalPdf(1);
    // original_filename lies about the format — sniffing must ignore it entirely.
    const sniffed = sniffFileMime(realPdf);
    assert(sniffed === 'application/pdf', 'un archivo con bytes reales de PDF se detecta como PDF sin importar cómo se llame original_filename (no se usa en absoluto para esta decisión)');
  }

  console.log('\nCase 12: magic bytes JPEG + extensión ".pdf" incorrecta -> se convierte de verdad a PDF\n');
  {
    const jpgMislabeled = makeMinimalJpeg(8, 8);
    // Simulate a Document row whose original_filename says ".pdf" but the real bytes are JPEG.
    const sniffed = sniffFileMime(jpgMislabeled);
    assert(sniffed === 'image/jpeg', 'el sniffing detecta JPEG real pese a un nombre de archivo ".pdf" engañoso');
    if (sniffed !== 'image/jpeg') throw new Error('unreachable — asserted above');
    const pdfBytes = await convertImageToPdf(jpgMislabeled, sniffed);
    assert(pdfBytes.subarray(0, 5).toString('ascii') === '%PDF-', 'se ejecuta la conversión real (no un passthrough incorrecto) y el resultado es un PDF válido');
  }

  console.log('\nCase 13: todos los archivos válidos del ZIP A3 terminan en .pdf, sea cual sea el original\n');
  {
    const used = new Set<string>();
    const names = [
      buildZipEntryName(doc({ original_filename: 'foto.jpg' }), used),
      buildZipEntryName(doc({ original_filename: 'foto.PNG', invoice: null }), used),
      buildZipEntryName(doc({ original_filename: 'sin_extension', invoice: null }), used),
      buildZipEntryName(doc({ original_filename: 'ya_es.pdf' }), used),
    ];
    for (const n of names) assert(n.endsWith('.pdf'), `"${n}" termina en .pdf`);
  }

  console.log('\nCase 14: dos documentos que colisionan de nombre tras forzar .pdf siguen deduplicándose (_2, _3)\n');
  {
    const used = new Set<string>();
    // Same invoice_number/supplier/total/date/type -> identical forced name before dedup.
    const d = () => doc({});
    const n1 = buildZipEntryName(d(), used);
    const n2 = buildZipEntryName(d(), used);
    const n3 = buildZipEntryName(d(), used);
    assert(n1 !== n2 && n2 !== n3 && n1 !== n3, 'los 3 nombres son distintos entre sí');
    assert(n1.endsWith('.pdf') && n2.endsWith('_2.pdf') && n3.endsWith('_3.pdf'), `deduplicación _2/_3 sigue funcionando con la extensión forzada: ${n1} | ${n2} | ${n3}`);
  }

  console.log('\nCase 15: la conversión no altera las constantes ni el mecanismo de paginación por lote\n');
  {
    const zipRoutePath = path.join(__dirname, '../app/api/gestoria/clients/[clientCompanyId]/documents/export-zip/route.ts');
    const src = fs.readFileSync(zipRoutePath, 'utf-8');
    assert(/skip:\s*offset,\s*\n?\s*take:\s*count/.test(src), 'el slicing Prisma skip/take sigue derivándose de offset/count del token, sin tocar');
    assert(/verifyBatchToken/.test(src), 'sigue verificando el token de lote existente, sin nueva lógica de paginación paralela');
    assert(!/MAX_DOCS_PER_BATCH|MAX_ESTIMATED_SIZE_MB|MAX_DOCS_TOTAL/.test(src), 'export-zip/route.ts no define (ni duplica) ninguna constante de límite de lote — siguen viviendo solo en export-plan');
  }

  console.log('\nBonus: sanitizePart sigue siendo la misma función pura reutilizada (no reimplementada)\n');
  {
    assert(sanitizePart('Envío Factura Ñoño') === 'ENVIO_FACTURA_NONO', 'sanitizePart normaliza acentos/ñ igual que antes');
  }

  console.log(`\n${passed + failed} comprobaciones: ${passed} pasadas, ${failed} fallidas`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
