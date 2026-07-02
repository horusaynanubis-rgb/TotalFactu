/**
 * Script idempotente para crear las cuentas Beta Tester de TotalFactu.
 *
 * Uso:
 *   cd nextjs_space
 *   npx tsx --require dotenv/config scripts/create-beta-testers.ts
 *   npx tsx --require dotenv/config scripts/create-beta-testers.ts --reset
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const BETA_ACCOUNTS = [
  {
    name: "Antonia Carceller",
    email: "antonia.carceller@totalfactu.com",
    password: "B3t@Ant0n!a#2026",
    companyName: "Antonia Carceller",
    taxId: "BETA-AC-001",
  },
  {
    name: "Fernando Martinez",
    email: "fernando.martinez@totalfactu.com",
    password: "B3t@F3rn@nd0#2026",
    companyName: "Fernando Martinez",
    taxId: "BETA-FM-002",
  },
  {
    name: "Jordi",
    email: "jordi@totalfactu.com",
    password: "B3t@J0rd!#2026",
    companyName: "TotalFactu Interno - Jordi",
    taxId: "BETA-JO-003",
  },
];

async function createBetaAccount(account: (typeof BETA_ACCOUNTS)[0]) {
  const { name, email, password, companyName, taxId } = account;

  // Check if user already exists
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    console.log(`  ⚠️  Usuario ya existe: ${email} — actualizando plan beta...`);

    // Ensure is_beta and plan_name are correct
    const membership = await prisma.membership.findFirst({
      where: { user_id: existingUser.id },
    });
    if (membership) {
      await prisma.company.update({
        where: { id: membership.company_id },
        data: { is_beta: true },
      });
      await prisma.subscription.updateMany({
        where: { company_id: membership.company_id },
        data: {
          plan_name: "beta",
          status: "active",
          current_period_start: null,
          current_period_end: null,
          stripe_customer_id: null,
          stripe_subscription_id: null,
        },
      });
      console.log(`  ✅ Plan beta activado para: ${email}`);
    }
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.$transaction(async (tx) => {
    // 1. Create user
    const user = await tx.user.create({
      data: {
        email,
        name,
        password_hash: passwordHash,
      },
    });

    // 2. Create company with is_beta = true
    const company = await tx.company.create({
      data: {
        name: companyName,
        tax_id: taxId,
        export_email: email,
        company_type: "individual",
        is_beta: true,
        country: "ES",
      },
    });

    // 3. Create membership (admin)
    await tx.membership.create({
      data: {
        user_id: user.id,
        company_id: company.id,
        role: "admin",
      },
    });

    // 4. Create beta subscription (no Stripe, no expiry)
    await tx.subscription.create({
      data: {
        company_id: company.id,
        plan_name: "beta",
        status: "active",
        // No stripe_customer_id, no stripe_subscription_id, no period_end
      },
    });

    console.log(`  ✅ Creado: ${name} <${email}>`);
    console.log(`     Empresa: ${companyName} (is_beta=true)`);
    console.log(`     Plan: beta / active / sin expiración`);
  });
}

async function resetBetaAccount(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.log(`  ℹ️  No encontrado: ${email}`);
    return;
  }

  const memberships = await prisma.membership.findMany({
    where: { user_id: user.id },
  });

  for (const m of memberships) {
    await prisma.company.delete({ where: { id: m.company_id } });
  }
  await prisma.user.delete({ where: { id: user.id } });
  console.log(`  🗑️  Eliminado: ${email}`);
}

async function main() {
  const isReset = process.argv.includes("--reset");

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  TotalFactu — Beta Testers");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (isReset) {
    console.log("🗑️  Eliminando cuentas beta...\n");
    for (const account of BETA_ACCOUNTS) {
      await resetBetaAccount(account.email);
    }
    console.log("\nVuelve a ejecutar sin --reset para recrear las cuentas.\n");
    return;
  }

  console.log("🚀 Creando cuentas Beta Tester...\n");
  for (const account of BETA_ACCOUNTS) {
    await createBetaAccount(account);
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  CREDENCIALES DE ACCESO");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  for (const account of BETA_ACCOUNTS) {
    console.log(`\n  ${account.name}`);
    console.log(`  Email:      ${account.email}`);
    console.log(`  Contraseña: ${account.password}`);
  }
  console.log("\n  Plan: Beta Tester — acceso completo, sin Stripe, sin expiración");
  console.log("\n  LOCALIZAR USUARIOS BETA:");
  console.log("  SELECT * FROM \"Company\" WHERE is_beta = true;");
  console.log("  SELECT * FROM \"Subscription\" WHERE plan_name = 'beta';");
  console.log("\n  CONVERTIR A PROFESIONAL:");
  console.log("  UPDATE \"Company\" SET is_beta = false WHERE id = '<company_id>';");
  console.log("  UPDATE \"Subscription\" SET plan_name = 'profesional', stripe_customer_id = '<id>', stripe_subscription_id = '<id>' WHERE company_id = '<company_id>';");
  console.log("\n  RESET:");
  console.log("  npx tsx --require dotenv/config scripts/create-beta-testers.ts --reset");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .catch((e) => {
    console.error("❌ Error:", e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
