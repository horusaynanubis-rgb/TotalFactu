/**
 * Fase 1 — Gestión de empresas: escenario de prueba para Jordi (beta).
 *
 * Asocia jordi@totalfactu.com a una SEGUNDA empresa ("Empresa Demo Grupo
 * Jordi") mediante un segundo Membership, sin tocar su empresa existente
 * (Horus Network Solutions) ni ninguna otra compañía (BYOU, GASCON, etc.).
 *
 * Idempotente — se puede ejecutar varias veces sin duplicar nada.
 *
 * Uso:
 *   cd nextjs_space
 *   npx tsx --require dotenv/config scripts/create-jordi-group-demo.ts
 *   npx tsx --require dotenv/config scripts/create-jordi-group-demo.ts --reset   (quita solo la empresa demo + membership)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const JORDI_EMAIL = 'jordi@totalfactu.com';
const DEMO_COMPANY_NAME = 'Empresa Demo Grupo Jordi';
const DEMO_COMPANY_TAX_ID = 'BETA-JO-DEMO-GRUPO';

async function main() {
  const isReset = process.argv.includes('--reset');

  const user = await prisma.user.findUnique({ where: { email: JORDI_EMAIL } });
  if (!user) {
    console.error(`❌ No existe el usuario ${JORDI_EMAIL}. Créalo primero (scripts/create-beta-testers.ts).`);
    process.exit(1);
  }

  if (isReset) {
    const demoCompany = await prisma.company.findFirst({ where: { tax_id: DEMO_COMPANY_TAX_ID } });
    if (!demoCompany) {
      console.log('ℹ️  No hay empresa demo que eliminar.');
      return;
    }
    await prisma.company.delete({ where: { id: demoCompany.id } }); // cascades Membership/Subscription
    console.log(`🗑️  Eliminada: ${DEMO_COMPANY_NAME} (${demoCompany.id})`);
    return;
  }

  const existingMemberships = await prisma.membership.findMany({
    where: { user_id: user.id },
    include: { company: { select: { id: true, name: true, tax_id: true } } },
  });
  console.log(`Empresas actuales de ${JORDI_EMAIL}:`);
  for (const m of existingMemberships) {
    console.log(`  - ${m.company.name} (${m.company.tax_id}) role=${m.role}`);
  }

  let demoCompany = await prisma.company.findFirst({ where: { tax_id: DEMO_COMPANY_TAX_ID } });

  if (!demoCompany) {
    demoCompany = await prisma.company.create({
      data: {
        name: DEMO_COMPANY_NAME,
        tax_id: DEMO_COMPANY_TAX_ID,
        export_email: JORDI_EMAIL,
        company_type: 'individual',
        is_beta: true,
        country: 'ES',
      },
    });
    await prisma.subscription.create({
      data: { company_id: demoCompany.id, plan_name: 'beta', status: 'active' },
    });
    console.log(`✅ Creada empresa: ${DEMO_COMPANY_NAME} (${demoCompany.id})`);
  } else {
    console.log(`ℹ️  Empresa demo ya existe: ${DEMO_COMPANY_NAME} (${demoCompany.id})`);
  }

  const existingMembership = await prisma.membership.findFirst({
    where: { user_id: user.id, company_id: demoCompany.id },
  });

  if (!existingMembership) {
    await prisma.membership.create({
      data: { user_id: user.id, company_id: demoCompany.id, role: 'admin' },
    });
    console.log(`✅ Membership creada: ${JORDI_EMAIL} -> ${DEMO_COMPANY_NAME}`);
  } else {
    console.log('ℹ️  Membership ya existía.');
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Jordi ahora tiene acceso a ${existingMemberships.length + (existingMembership ? 0 : 1)} empresa(s).`);
  console.log('Inicia sesión y visita /dashboard/companies para cambiar entre ellas.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
