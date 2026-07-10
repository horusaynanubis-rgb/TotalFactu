// "Gastos especiales" section of the resumen fiscal (§8). Sourced only from
// FiscalDocument — Invoice.category is free text with no controlled
// vocabulary, so matching against it would invent structure that doesn't
// exist. FiscalDocument.document_type is already a controlled vocabulary
// that maps onto the requested categories.
import { prisma } from './prisma';
import type { SpecialExpenseEntry } from './fiscal-summary';

// document_type -> special-expense bucket label. escritura and
// profesional_notarial are split across "Notaría" and "Servicios
// profesionales" so both requested buckets are populated without
// double-counting the same document.
const CATEGORY_MAP: { label: string; types: string[] }[] = [
  { label: 'Alquiler / contrato del local', types: ['alquiler'] },
  { label: 'Retenciones', types: ['retenciones'] },
  { label: 'Notaría / escritura de constitución', types: ['escritura'] },
  { label: 'Registro Mercantil', types: ['registro_mercantil'] },
  { label: 'Servicios profesionales', types: ['profesional_notarial'] },
  { label: 'Tabaco', types: ['tabaco'] },
  { label: 'Otros', types: ['certificado_fiscal', 'actividad', 'otro'] },
];

export async function buildSpecialExpensesSummary(
  companyId: string,
  fiscalYear: number,
  fiscalPeriod: string, // 'Q1'..'Q4' | 'annual'
): Promise<SpecialExpenseEntry[]> {
  const periodFilter = fiscalPeriod === 'annual' ? undefined : { in: [fiscalPeriod, 'annual'] };

  const counts = await prisma.fiscalDocument.groupBy({
    by: ['document_type'],
    where: {
      company_id: companyId,
      fiscal_year: fiscalYear,
      ...(periodFilter ? { fiscal_period: periodFilter } : {}),
    },
    _count: { _all: true },
  });

  const countByType = new Map(counts.map((c) => [c.document_type, c._count._all]));

  return CATEGORY_MAP.map(({ label, types }) => ({
    label,
    count: types.reduce((sum, t) => sum + (countByType.get(t) ?? 0), 0),
  }));
}
