/**
 * Script idempotente para crear la cuenta interna "Admin Control" de
 * TotalFactu (backoffice / Admin Control — ver plan en
 * /Users/dexter/.claude/plans/happy-meandering-starfish.md).
 *
 * Crea:
 *  - Company "TotalFactu Internal" (company_type = "internal", excluida de
 *    todas las métricas comerciales del backoffice — ver
 *    lib/admin/company-metrics.ts EXCLUDE_INTERNAL_WHERE).
 *  - User admincontrol@totalfactu.com con una contraseña temporal generada
 *    aleatoriamente en cada ejecución (no hardcodeada — se imprime una sola
 *    vez por consola).
 *  - Membership con role = "platform_admin" (ver lib/admin/platform-admin.ts).
 *    No requiere Stripe ni Subscription: el módulo Admin Control es
 *    accesible sin suscripción para esta empresa interna.
 *
 * Uso:
 *   cd nextjs_space
 *   npx tsx --require dotenv/config scripts/create-platform-admin.ts
 *   npx tsx --require dotenv/config scripts/create-platform-admin.ts --reset
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

const ADMIN_EMAIL = "admincontrol@totalfactu.com";
const ADMIN_NAME = "Admin Control";
const INTERNAL_COMPANY_NAME = "TotalFactu Internal";
const INTERNAL_COMPANY_TAX_ID = "INTERNAL-TOTALFACTU";
const INTERNAL_COMPANY_TYPE = "internal";
const PLATFORM_ADMIN_ROLE = "platform_admin";

function generateTemporaryPassword(): string {
  // base64url — letters/digits/-/_ only, easy to copy-paste, ~144 bits of entropy.
  return randomBytes(18).toString("base64url");
}

async function createOrUpdatePlatformAdmin(): Promise<string | null> {
  const existingUser = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });

  if (existingUser) {
    console.log(`  ⚠️  Usuario ya existe: ${ADMIN_EMAIL} — verificando rol/empresa interna...`);
    const membership = await prisma.membership.findFirst({ where: { user_id: existingUser.id } });
    if (membership) {
      await prisma.company.update({
        where: { id: membership.company_id },
        data: { company_type: INTERNAL_COMPANY_TYPE, name: INTERNAL_COMPANY_NAME },
      });
      if (membership.role !== PLATFORM_ADMIN_ROLE) {
        await prisma.membership.update({ where: { id: membership.id }, data: { role: PLATFORM_ADMIN_ROLE } });
      }
      console.log(`  ✅ Rol platform_admin confirmado para: ${ADMIN_EMAIL}`);
    }
    return null; // no new password generated for an already-existing account
  }

  const password = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: ADMIN_EMAIL, name: ADMIN_NAME, password_hash: passwordHash },
    });

    const company = await tx.company.create({
      data: {
        name: INTERNAL_COMPANY_NAME,
        tax_id: INTERNAL_COMPANY_TAX_ID,
        export_email: ADMIN_EMAIL,
        company_type: INTERNAL_COMPANY_TYPE,
        is_beta: false,
      },
    });

    await tx.membership.create({
      data: { user_id: user.id, company_id: company.id, role: PLATFORM_ADMIN_ROLE },
    });

    console.log(`  ✅ Creado: ${ADMIN_NAME} <${ADMIN_EMAIL}>`);
    console.log(`     Empresa: ${INTERNAL_COMPANY_NAME} (company_type=internal)`);
    console.log(`     Rol: platform_admin`);
  });

  return password;
}

async function resetPlatformAdmin() {
  const user = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!user) {
    console.log(`  ℹ️  No encontrado: ${ADMIN_EMAIL}`);
    return;
  }
  const memberships = await prisma.membership.findMany({ where: { user_id: user.id } });
  for (const m of memberships) {
    const company = await prisma.company.findUnique({ where: { id: m.company_id } });
    // Safety: only delete companies actually marked as internal, never a real client company.
    if (company?.company_type === INTERNAL_COMPANY_TYPE) {
      await prisma.company.delete({ where: { id: m.company_id } });
    }
  }
  await prisma.user.delete({ where: { id: user.id } });
  console.log(`  🗑️  Eliminado: ${ADMIN_EMAIL}`);
}

async function main() {
  const isReset = process.argv.includes("--reset");

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  TotalFactu — Admin Control (platform_admin)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (isReset) {
    console.log("🗑️  Eliminando cuenta Admin Control...\n");
    await resetPlatformAdmin();
    console.log("\nVuelve a ejecutar sin --reset para recrearla.\n");
    return;
  }

  console.log("🚀 Creando/verificando cuenta Admin Control...\n");
  const generatedPassword = await createOrUpdatePlatformAdmin();

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  if (generatedPassword) {
    console.log("  CREDENCIALES DE ACCESO (guárdalas ahora — no se volverán a mostrar)");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`\n  Nombre:     ${ADMIN_NAME}`);
    console.log(`  Email:      ${ADMIN_EMAIL}`);
    console.log(`  Contraseña: ${generatedPassword}`);
    console.log(`\n  Rol: platform_admin — acceso a Admin Control (/dashboard/admin)`);
  } else {
    console.log("  La cuenta ya existía — no se generó una contraseña nueva.");
    console.log("  Para regenerarla: npx tsx --require dotenv/config scripts/create-platform-admin.ts --reset");
    console.log("  y luego vuelve a ejecutar el script sin --reset.");
  }
  console.log("\n  LOCALIZAR:");
  console.log(`  SELECT * FROM "Company" WHERE company_type = 'internal';`);
  console.log(`  SELECT * FROM "Membership" WHERE role = 'platform_admin';`);
  console.log("\n  RESET:");
  console.log("  npx tsx --require dotenv/config scripts/create-platform-admin.ts --reset");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .catch((e) => {
    console.error("❌ Error:", e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
