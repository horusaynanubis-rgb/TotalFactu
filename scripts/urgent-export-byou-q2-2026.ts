// URGENT, temporary, read-only export for BYOU Coffee House (NIF B26837328)
// Q2 2026, requested by GASCON for the trimestral declaration.
//
// Read-only: only SELECT queries against Prisma. Writes nothing to the
// database. Reuses the exact same lib/ functions the product's "Centro de
// Exportación" now uses (lib/fiscal-summary.ts, lib/iva-detalle.ts,
// lib/caja-csv.ts, lib/tpv-control.ts, lib/csv-generator.ts) — no logic is
// duplicated here, this only wires them together and writes plain CSVs to a
// local folder instead of a ZIP download.
//
// Run with:
//   cd /Users/dexter/Totalfactu/nextjs_space
//   npx tsx --require dotenv/config scripts/urgent-export-byou-q2-2026.ts
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { buildFiscalSummary, generateResumenCSV } from '../lib/fiscal-summary';
import { buildSpecialExpensesSummary } from '../lib/special-expenses';
import { buildIvaDetalle, generateIvaDetalleCSV } from '../lib/iva-detalle';
import { generateCajaCSV } from '../lib/caja-csv';
import { buildTpvControlReport, generateTpvControlCSV } from '../lib/tpv-control';
import { generateCSV } from '../lib/csv-generator';

const prisma = new PrismaClient();

const COMPANY_TAX_ID = 'B26837328';
const PERIOD_START = new Date('2026-04-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-06-30T23:59:59.999Z');
const PERIOD_LABEL = 'Q2 2026';
const OUT_DIR = path.join(__dirname, '..', 'tmp', 'byou-q2-2026-export');

async function main() {
  const company = await prisma.company.findFirst({ where: { tax_id: COMPANY_TAX_ID } });
  if (!company) {
    throw new Error(`Company with tax_id ${COMPANY_TAX_ID} not found`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const [summary, specialExpenses, ivaDetalle, registers, tpvReport, invoices] = await Promise.all([
    buildFiscalSummary(company.id, PERIOD_START, PERIOD_END, PERIOD_LABEL),
    buildSpecialExpensesSummary(company.id, 2026, 'Q2'),
    buildIvaDetalle(company.id, PERIOD_START, PERIOD_END),
    prisma.dailyCashRegister.findMany({
      where: { company_id: company.id, date: { gte: PERIOD_START, lte: PERIOD_END }, status: 'confirmed' },
      orderBy: { date: 'asc' },
      include: { document: { select: { source_channel: true } } },
    }),
    buildTpvControlReport(company.id, PERIOD_START, PERIOD_END, PERIOD_LABEL),
    prisma.invoice.findMany({
      where: { company_id: company.id, issue_date: { gte: PERIOD_START, lte: PERIOD_END } },
      include: { document: true },
      orderBy: { issue_date: 'asc' },
    }),
  ]);

  const files: Record<string, string> = {
    'resumen_fiscal_Q2_2026.csv': generateResumenCSV(summary, specialExpenses),
    'detalle_iva_trimestre.csv': generateIvaDetalleCSV(ivaDetalle),
    'caja_tpv_trimestre.csv': generateCajaCSV(registers as any),
    'control_tpv_vs_facturacion.csv': generateTpvControlCSV(tpvReport),
    'facturas.csv': generateCSV(invoices as any),
  };

  for (const [filename, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT_DIR, filename), content, 'utf-8');
  }

  console.log(`\nExportado a: ${OUT_DIR}\n`);
  for (const filename of Object.keys(files)) {
    console.log(`  - ${filename}`);
  }

  console.log('\n=== RESUMEN RÁPIDO ===');
  console.log(`Efectivo: ${summary.caja.cash.toFixed(2)} €`);
  console.log(`Tarjeta/TPV: ${summary.caja.card.toFixed(2)} €`);
  console.log(`Bizum: ${summary.caja.bizum.toFixed(2)} €`);
  console.log(`Transferencia: ${summary.caja.transfer.toFixed(2)} €`);
  console.log(`Total Caja/TPV: ${summary.caja.total.toFixed(2)} €`);
  console.log(`\nIVA repercutido (solo facturas emitidas, no incluye Caja/TPV): ${summary.ivaRepercutido.toFixed(2)} €`);
  console.log(`IVA soportado (compras): ${summary.ivaSoportado.toFixed(2)} €`);
  console.log(`Facturas de compra sin tipo de IVA clasificado: ${summary.sinClasificarComprasCount}`);
  console.log(`Facturas de venta sin tipo de IVA clasificado: ${summary.sinClasificarVentasCount}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
