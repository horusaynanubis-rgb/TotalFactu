/**
 * Backfill Invoice.fiscal_status for existing rows using ONLY local
 * classification (lib/iva-classification.ts + lib/fiscal-status.ts) — no AI
 * calls. Run once after applying prisma/migrations/add_fiscal_status.sql.
 *
 * Every existing row already defaults to 'pending_classification' from the
 * migration; this script upgrades the ones local classification CAN resolve
 * to 'classified'/'mixed_vat', leaving genuinely unresolvable ones as-is.
 * Only touches invoices where vat_reclassification_attempted = false, so
 * it's safe to re-run and never overwrites a completed AI second pass.
 *
 * Uso:
 *   cd nextjs_space
 *   npx tsx --require dotenv/config scripts/backfill-fiscal-status.ts
 *   npx tsx --require dotenv/config scripts/backfill-fiscal-status.ts --company=<companyId>
 */

import { PrismaClient } from '@prisma/client';
import { classifyInvoiceRate, IvaLineInput } from '../lib/iva-classification';
import { computeFiscalStatus } from '../lib/fiscal-status';

const prisma = new PrismaClient();

async function main() {
  const companyArg = process.argv.find((a) => a.startsWith('--company='));
  const companyId = companyArg ? companyArg.split('=')[1] : undefined;

  const invoices = await prisma.invoice.findMany({
    where: {
      vat_reclassification_attempted: false,
      ...(companyId ? { company_id: companyId } : {}),
    },
    select: {
      id: true,
      fiscal_status: true,
      tax_rate: true,
      subtotal: true,
      tax_amount: true,
      invoice_lines: { select: { tax_rate: true, total_amount: true } },
    },
  });

  console.log(`Found ${invoices.length} invoice(s) to (re)classify${companyId ? ` for company ${companyId}` : ''}.`);

  const counts: Record<string, number> = { classified: 0, pending_classification: 0, mixed_vat: 0, manual_review: 0 };
  let unchanged = 0;

  for (const inv of invoices) {
    const lines: IvaLineInput[] = inv.invoice_lines.map((l) => ({ tax_rate: l.tax_rate, total_amount: l.total_amount }));
    const classification = classifyInvoiceRate(inv.tax_rate, lines, inv.subtotal, inv.tax_amount);
    const { fiscal_status, fiscal_status_reason } = computeFiscalStatus(classification);

    counts[fiscal_status] = (counts[fiscal_status] ?? 0) + 1;

    if (inv.fiscal_status === fiscal_status) {
      unchanged++;
      continue;
    }

    await prisma.invoice.update({
      where: { id: inv.id },
      data: { fiscal_status, fiscal_status_reason },
    });
  }

  console.log('\nResult:');
  console.log(`  classified:              ${counts.classified}`);
  console.log(`  pending_classification:  ${counts.pending_classification}`);
  console.log(`  mixed_vat:               ${counts.mixed_vat}`);
  console.log(`  manual_review:           ${counts.manual_review}`);
  console.log(`  (unchanged from default: ${unchanged})`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
