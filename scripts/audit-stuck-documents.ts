/**
 * READ-ONLY audit of documents that never produced a downstream record
 * (Invoice / DeliveryNote / DailyCashRegister). Classifies each one so a
 * human can decide retry vs. duplicate-noise vs. invalid file vs. manual
 * review — mirrors the classification used in the 2026-07-15 audit, where
 * 95 BYOU documents were stuck in 'processing': 87 were retries of one file
 * that succeeded once elsewhere, and 7 distinct files never produced any
 * Invoice at all.
 *
 * Only SELECT queries + read-only Storage lookups (lib/storage.ts#getFileInfo,
 * which lists metadata — never downloads or deletes). Never modifies,
 * reprocesses, or deletes anything. To act on stuck 'processing' documents,
 * use the gated admin endpoint (POST /api/admin/diagnostics/stuck-documents
 * with confirm=true) after reviewing this report — never automatically.
 *
 * Uso:
 *   cd nextjs_space
 *   npx tsx --require dotenv/config scripts/audit-stuck-documents.ts
 *   npx tsx --require dotenv/config scripts/audit-stuck-documents.ts --taxId=B26837328 --timeoutMinutes=15
 */
import { PrismaClient } from '@prisma/client';
import { getFileInfo } from '../lib/storage';
import { normalizeFilenameForSimilarity } from '../lib/duplicate-detection';
import { DEFAULT_STUCK_TIMEOUT_MINUTES } from '../lib/stuck-documents';

const prisma = new PrismaClient();

function arg(name: string, fallback: string): string {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=').slice(1).join('=') : fallback;
}

type Proposal = 'duplicate' | 'retry' | 'invalid_file' | 'manual_review';

async function main() {
  const taxId = arg('taxId', 'B26837328');
  const timeoutMinutes = Number(arg('timeoutMinutes', String(DEFAULT_STUCK_TIMEOUT_MINUTES)));

  const company = await prisma.company.findFirst({ where: { tax_id: taxId } });
  if (!company) throw new Error(`Company with tax_id ${taxId} not found`);

  console.log(`\n=== Auditoría de documentos atascados (solo lectura) — ${company.name} (${taxId}) ===\n`);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('⚠️  SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no configurados en este entorno — la comprobación de existencia en Storage no puede ejecutarse.');
    console.log('   Todas las filas mostrarán existeEnStorage="no verificable en este entorno" y propuesta=manual_review en vez de invalid_file/retry.\n');
  }

  const orphans = await prisma.document.findMany({
    where: {
      company_id: company.id,
      invoice: null,
      delivery_note: null,
      daily_cash_register: null,
      processing_status: { in: ['processing', 'failed'] },
    },
    select: {
      id: true, original_filename: true, source_channel: true, mime_type: true,
      cloud_storage_path: true, processing_status: true, created_at: true, updated_at: true,
    },
    orderBy: { created_at: 'asc' },
  });

  console.log(`Documentos sin Invoice/DeliveryNote/DailyCashRegister (status processing o failed): ${orphans.length}\n`);

  // Group by normalized filename to separate "retries of the same file" from genuinely distinct documents.
  const byFilename = new Map<string, typeof orphans>();
  for (const d of orphans) {
    const key = normalizeFilenameForSimilarity(d.original_filename);
    byFilename.set(key, [...(byFilename.get(key) ?? []), d]);
  }

  // Does any document with this filename (anywhere for the company, any status) have a linked Invoice?
  async function hasSuccessfulSibling(filename: string): Promise<{ documentId: string; invoiceNumber: string; totalAmount: number } | null> {
    const sibling = await prisma.document.findFirst({
      where: { company_id: company!.id, original_filename: filename, invoice: { isNot: null } },
      select: { id: true, invoice: { select: { invoice_number: true, total_amount: true } } },
    });
    if (!sibling?.invoice) return null;
    return { documentId: sibling.id, invoiceNumber: sibling.invoice.invoice_number, totalAmount: sibling.invoice.total_amount };
  }

  const now = Date.now();
  const cutoff = now - timeoutMinutes * 60 * 1000;

  let retryNoiseCount = 0;
  let withSuccessfulSiblingCount = 0;
  let uniqueNoInvoiceCount = 0;

  console.log('--- Grupos por nombre de archivo normalizado ---\n');
  for (const [key, docs] of byFilename) {
    const sample = docs[0];
    const sibling = await hasSuccessfulSibling(sample.original_filename);
    const isRetryGroup = docs.length > 1;
    if (isRetryGroup) retryNoiseCount += docs.length - (sibling ? 0 : 1); // all but one copy are noise if one succeeded elsewhere
    if (sibling) withSuccessfulSiblingCount += docs.length; else uniqueNoInvoiceCount += isRetryGroup ? 0 : 1;

    console.log(`Archivo: "${sample.original_filename}" (${docs.length} copia(s) sin factura)`);
    if (sibling) {
      console.log(`  ✓ Existe una copia HERMANA que SÍ generó factura: documentId=${sibling.documentId} invoice_number=${sibling.invoiceNumber} total=${sibling.totalAmount.toFixed(2)}€`);
      console.log(`  Propuesta para estas ${docs.length} copia(s): duplicate (ruido de reintento — no requiere acción, la factura real ya existe)`);
    }

    for (const d of docs) {
      const stuckMinutes = Math.round((now - d.updated_at.getTime()) / 60000);
      const isTimedOut = d.processing_status === 'processing' && d.updated_at.getTime() < cutoff;
      const fileInfo = await getFileInfo(d.cloud_storage_path);

      // fileInfo.exists === null means the check itself couldn't run (e.g. no
      // Supabase Storage credentials in this environment) — never treat that
      // as "file confirmed missing". Only a real `false` means confirmed absent.
      let proposal: Proposal;
      if (sibling) proposal = 'duplicate';
      else if (fileInfo.exists === false) proposal = 'invalid_file';
      else if (fileInfo.exists === null) proposal = 'manual_review';
      else if (d.processing_status === 'failed' || isTimedOut) proposal = 'retry';
      else proposal = 'manual_review';

      const storageLabel = fileInfo.exists === null ? 'no verificable en este entorno' : String(fileInfo.exists);
      console.log(
        `    documentId=${d.id} channel=${d.source_channel} status=${d.processing_status}${isTimedOut ? ' (TIMEOUT >' + timeoutMinutes + 'min)' : ''} ` +
        `uploaded=${d.created_at.toISOString()} lastUpdate=${d.updated_at.toISOString()} (${stuckMinutes} min sin actividad) ` +
        `mime=${d.mime_type} storage="${d.cloud_storage_path}" existeEnStorage=${storageLabel}${fileInfo.sizeBytes ? ` tamaño=${(fileInfo.sizeBytes / 1024).toFixed(1)}KB` : ''} ` +
        `PROPUESTA=${proposal}`,
      );
    }
    console.log('');
  }

  console.log('=== RESUMEN ===');
  console.log(`Grupos de archivo distintos: ${byFilename.size}`);
  console.log(`Copias que son ruido de reintento (ya existe factura de una copia hermana): ${withSuccessfulSiblingCount}`);
  console.log(`Documentos ÚNICOS sin ninguna factura en ningún intento (requieren revisión): ${uniqueNoInvoiceCount}`);
  console.log(`Timeout configurado para "atascado": ${timeoutMinutes} minutos`);
  console.log('\nNo se ha modificado ningún dato. Para marcar los "processing" atascados como failed (habilita el botón Reintentar):');
  console.log('  POST /api/admin/diagnostics/stuck-documents  { documentIds: [...], confirm: true }  (requiere sesión admin)');
}

main()
  .catch((e) => { console.error('ERROR:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
