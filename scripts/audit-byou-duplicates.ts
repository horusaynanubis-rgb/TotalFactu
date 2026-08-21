/**
 * READ-ONLY audit: list duplicate-invoice groups for a company/period using
 * the exact same matching logic the live ingestion guard now uses
 * (lib/duplicate-detection.ts#groupDuplicates) — so this script's verdict
 * can never drift from what app/api/documents/[id]/process/route.ts would
 * have blocked/flagged had the guard existed when these were created.
 *
 * Only SELECT queries. Never deletes, updates, or reprocesses anything.
 *
 * Uso:
 *   cd nextjs_space
 *   npx tsx --require dotenv/config scripts/audit-byou-duplicates.ts
 *   npx tsx --require dotenv/config scripts/audit-byou-duplicates.ts --taxId=B26837328 --year=2026 --quarter=2
 */
import { PrismaClient } from '@prisma/client';
import { groupDuplicates, DuplicateInvoiceRef } from '../lib/duplicate-detection';
import { getPeriodRange } from '../lib/fiscal-export-builder';

const prisma = new PrismaClient();

function arg(name: string, fallback: string): string {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=').slice(1).join('=') : fallback;
}

async function main() {
  const taxId = arg('taxId', 'B26837328');
  const year = Number(arg('year', '2026'));
  const quarter = Number(arg('quarter', '2'));

  const company = await prisma.company.findFirst({ where: { tax_id: taxId } });
  if (!company) throw new Error(`Company with tax_id ${taxId} not found`);

  const { start, end, label } = getPeriodRange(year, quarter);
  console.log(`\n=== Auditoría de duplicados (solo lectura) — ${company.name} (${taxId}) — ${label} ===\n`);

  const invoices = await prisma.invoice.findMany({
    where: { company_id: company.id, issue_date: { gte: start, lte: end } },
    select: {
      id: true, document_id: true, invoice_number: true, supplier_name: true, supplier_tax_id: true,
      issue_date: true, total_amount: true, tax_amount: true, created_at: true, review_status: true,
      document: { select: { source_channel: true, original_filename: true, created_at: true } },
    },
    orderBy: { created_at: 'asc' },
  });

  const refs: DuplicateInvoiceRef[] = invoices.map((inv) => ({
    invoiceId: inv.id,
    documentId: inv.document_id,
    invoiceNumber: inv.invoice_number,
    supplierName: inv.supplier_name,
    supplierTaxId: inv.supplier_tax_id,
    issueDate: inv.issue_date,
    totalAmount: inv.total_amount,
    sourceChannel: inv.document?.source_channel ?? null,
    originalFilename: inv.document?.original_filename ?? null,
    createdAt: inv.created_at,
  }));

  const groups = groupDuplicates(refs);

  console.log(`Total facturas en el periodo: ${invoices.length}`);
  console.log(`Grupos de posible duplicado encontrados: ${groups.length}\n`);

  let totalImpact = 0;
  let strongGroups = 0;
  let probableGroups = 0;

  groups.forEach((group, idx) => {
    const sorted = [...group.members].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
    const principal = sorted[0];
    const duplicates = sorted.slice(1);
    const impact = duplicates.reduce((s, d) => s + d.totalAmount, 0);
    totalImpact += impact;
    if (group.matchType === 'strong') strongGroups++; else probableGroups++;

    console.log(`--- Grupo ${idx + 1} [${group.matchType.toUpperCase()}] — coincide en: ${group.matchedOn.join(', ')} ---`);
    console.log(
      `  PRINCIPAL (más antiguo)  invoiceId=${principal.invoiceId}  documentId=${principal.documentId ?? '—'}  ` +
      `proveedor="${principal.supplierName}"  nº="${principal.invoiceNumber}"  fecha=${principal.issueDate?.toISOString().slice(0, 10)}  ` +
      `total=${principal.totalAmount.toFixed(2)}€  origen=${principal.sourceChannel ?? '—'}  creado=${principal.createdAt?.toISOString()}`,
    );
    for (const d of duplicates) {
      console.log(
        `  DUPLICADO                invoiceId=${d.invoiceId}  documentId=${d.documentId ?? '—'}  ` +
        `proveedor="${d.supplierName}"  nº="${d.invoiceNumber}"  fecha=${d.issueDate?.toISOString().slice(0, 10)}  ` +
        `total=${d.totalAmount.toFixed(2)}€  origen=${d.sourceChannel ?? '—'}  creado=${d.createdAt?.toISOString()}`,
      );
    }
    console.log(`  Impacto fiscal de este grupo (suma de los duplicados, excluyendo el principal): ${impact.toFixed(2)} €\n`);
  });

  console.log('=== RESUMEN ===');
  console.log(`Grupos con coincidencia FUERTE (mismo nº factura + proveedor + total): ${strongGroups}`);
  console.log(`Grupos con coincidencia PROBABLE (mismo proveedor + fecha próxima + total, revisar a mano): ${probableGroups}`);
  console.log(`Impacto fiscal total estimado (importe duplicado, si se excluyeran los no-principales): ${totalImpact.toFixed(2)} €`);
  console.log('\nNota: "principal" = registro más antiguo por created_at — es una heurística, no una decisión automática.');
  console.log('No se ha modificado ningún dato. Para resolver duplicados confirmados, usar scripts/resolve-confirmed-duplicates.ts con --dry-run primero.');
}

main()
  .catch((e) => { console.error('ERROR:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
