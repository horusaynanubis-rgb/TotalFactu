/**
 * PREPARED BUT NOT INTENDED TO RUN UNATTENDED. Resolves duplicate invoices a
 * human has already confirmed via scripts/audit-byou-duplicates.ts.
 *
 * Safety, in layers (all required to actually change data):
 *   1. --pairs=<principalId>:<duplicateId>,... is mandatory and explicit —
 *      the script never re-derives "which one is the duplicate" itself.
 *   2. Default action is --action=mark: writes an AuditLog entry only,
 *      touches no Invoice/Document row. Nothing is ever deleted by default.
 *   3. --action=delete additionally requires --confirm. Without --confirm,
 *      ANY invocation (including --action=delete) runs as a dry-run: it
 *      prints exactly what it would do and writes nothing.
 *   4. Deletion only ever removes the DUPLICATE Invoice (+ its InvoiceLine
 *      rows, which cascade) inside a transaction, after writing the
 *      AuditLog entry that records the resolution. The duplicate's Document
 *      row is never deleted — it stays as the audit trail (filename,
 *      channel, storage path), just with no Invoice attached anymore. The
 *      principal Invoice is never touched.
 *
 * This script was NOT executed against production during the 2026-07-15
 * remediation — it is delivered ready, dry-run-verified, for a human to run
 * deliberately after reviewing scripts/audit-byou-duplicates.ts output.
 *
 * Uso:
 *   cd nextjs_space
 *   # 1. Dry run (always safe, default) — shows exactly what would happen:
 *   npx tsx --require dotenv/config scripts/resolve-confirmed-duplicates.ts --pairs=clxxx1:clxxx2,clxxx3:clxxx4
 *
 *   # 2. Mark only (writes an AuditLog note, still no data change):
 *   npx tsx --require dotenv/config scripts/resolve-confirmed-duplicates.ts --pairs=clxxx1:clxxx2 --action=mark --confirm
 *
 *   # 3. Delete the confirmed duplicate Invoice rows (irreversible beyond AuditLog):
 *   npx tsx --require dotenv/config scripts/resolve-confirmed-duplicates.ts --pairs=clxxx1:clxxx2 --action=delete --confirm
 */
import { PrismaClient } from '@prisma/client';
import { parseDuplicatePairsArg, ConfirmedDuplicatePair } from '../lib/duplicate-detection';

const prisma = new PrismaClient();

function parseArgs() {
  const pairsArg = process.argv.find((a) => a.startsWith('--pairs='));
  const action = (process.argv.find((a) => a.startsWith('--action='))?.split('=')[1] ?? 'mark') as 'mark' | 'delete';
  const confirm = process.argv.includes('--confirm');
  const dryRun = process.argv.includes('--dry-run') || !confirm;

  if (!pairsArg) {
    console.error('ERROR: --pairs=<principalId>:<duplicateId>,... is required. Nothing to do without an explicit, human-confirmed list.');
    console.error('Get candidate IDs from: npx tsx --require dotenv/config scripts/audit-byou-duplicates.ts');
    process.exit(1);
  }

  const pairs: ConfirmedDuplicatePair[] = parseDuplicatePairsArg(pairsArg.slice('--pairs='.length));

  if (action !== 'mark' && action !== 'delete') {
    console.error(`ERROR: --action must be "mark" or "delete", got "${action}"`);
    process.exit(1);
  }

  return { pairs, action, confirm, dryRun };
}

async function main() {
  const { pairs, action, confirm, dryRun } = parseArgs();

  console.log(`\n=== resolve-confirmed-duplicates ===`);
  console.log(`Modo: ${dryRun ? 'DRY-RUN (nada se modifica)' : `EJECUCIÓN REAL (--confirm) — acción: ${action}`}`);
  console.log(`Pares a procesar: ${pairs.length}\n`);

  for (const { principalId, duplicateId } of pairs) {
    const [principal, duplicate] = await Promise.all([
      prisma.invoice.findUnique({ where: { id: principalId }, include: { document: true } }),
      prisma.invoice.findUnique({ where: { id: duplicateId }, include: { document: true, invoice_lines: true } }),
    ]);

    if (!principal) { console.error(`  ✗ SKIP par (${principalId}:${duplicateId}) — principal ${principalId} no existe.`); continue; }
    if (!duplicate) { console.error(`  ✗ SKIP par (${principalId}:${duplicateId}) — duplicado ${duplicateId} no existe (¿ya resuelto?).`); continue; }

    console.log(`--- Par: principal=${principalId} (${principal.invoice_number}, ${principal.total_amount.toFixed(2)}€) | duplicado=${duplicateId} (${duplicate.invoice_number}, ${duplicate.total_amount.toFixed(2)}€) ---`);

    if (dryRun) {
      console.log(`  [DRY-RUN] Se registraría AuditLog(action='duplicate_resolved', entity_id=${duplicateId}).`);
      if (action === 'delete') {
        console.log(`  [DRY-RUN] Se eliminaría Invoice ${duplicateId} y sus ${duplicate.invoice_lines?.length ?? 0} InvoiceLine asociadas (transacción).`);
        console.log(`  [DRY-RUN] Document ${duplicate.document_id} se conserva (no se borra), queda sin factura asociada.`);
      } else {
        console.log(`  [DRY-RUN] Modo "mark": no se toca ninguna fila de Invoice/Document, solo quedaría la nota en AuditLog.`);
      }
      continue;
    }

    // --confirm was passed from here on.
    const auditPayload = {
      principal_invoice_id: principalId,
      duplicate_invoice_id: duplicateId,
      duplicate_document_id: duplicate.document_id,
      duplicate_invoice_number: duplicate.invoice_number,
      duplicate_total_amount: duplicate.total_amount,
      duplicate_source_channel: duplicate.document?.source_channel ?? null,
      principal_source_channel: principal.document?.source_channel ?? null,
      action,
    };

    if (action === 'mark') {
      await prisma.auditLog.create({
        data: {
          company_id: duplicate.company_id,
          user_id: null,
          entity_type: 'invoice',
          entity_id: duplicateId,
          action: 'duplicate_resolved_marked',
          new_values: JSON.stringify(auditPayload),
        },
      });
      console.log(`  ✓ Marcado en AuditLog. Ninguna fila de Invoice/Document modificada.`);
      continue;
    }

    // action === 'delete'
    await prisma.$transaction([
      prisma.auditLog.create({
        data: {
          company_id: duplicate.company_id,
          user_id: null,
          entity_type: 'invoice',
          entity_id: duplicateId,
          action: 'duplicate_resolved_deleted',
          old_values: JSON.stringify(auditPayload),
        },
      }),
      prisma.invoice.delete({ where: { id: duplicateId } }), // cascades InvoiceLine; Document row is preserved
    ]);
    console.log(`  ✓ Invoice ${duplicateId} eliminada (transacción con AuditLog). Document ${duplicate.document_id} conservado como rastro.`);
  }

  console.log('\nHecho.');
  if (!confirm) {
    console.log('Ningún dato fue modificado (falta --confirm). Revisa el plan anterior y vuelve a ejecutar con --confirm cuando estés seguro.');
  } else {
    console.log('Recuerda: las exportaciones (facturas.csv, resumen_fiscal.csv, paquete trimestral) se generan al vuelo — la próxima descarga ya reflejará este cambio, no requiere regeneración manual.');
  }
}

main()
  .catch((e) => { console.error('ERROR:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
