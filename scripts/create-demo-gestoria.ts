/**
 * Script idempotente para crear/resetear la cuenta de Gestoría Demo de TotalFactu.
 * La lógica principal vive en lib/admin/demo-gestoria.ts y se comparte con la UI.
 *
 * Uso:
 *   npx tsx --require dotenv/config scripts/create-demo-gestoria.ts
 *   npx tsx --require dotenv/config scripts/create-demo-gestoria.ts --reset
 */

import { PrismaClient } from "@prisma/client";
import {
  createDemoGestoria,
  resetDemoGestoria,
  getDemoGestoriaStatus,
  DEMO_EMAIL,
  DEMO_PASSWORD,
} from "../lib/admin/demo-gestoria";

const prisma = new PrismaClient();

async function main() {
  const isReset = process.argv.includes("--reset");

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  TotalFactu — Gestoría Demo");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (isReset) {
    console.log("🗑️  Reseteando cuenta demo...\n");
    const result = await resetDemoGestoria(prisma);
    if (result.success) {
      console.log("✅", result.message);
      console.log("\nVuelve a ejecutar sin --reset para recrear la demo.");
    } else {
      console.error("❌", result.message);
      process.exit(1);
    }
    return;
  }

  console.log("🚀 Creando / actualizando cuenta demo...\n");
  const result = await createDemoGestoria(prisma);

  if (!result.success) {
    console.error("❌", result.message);
    process.exit(1);
  }

  console.log("✅", result.message, "\n");

  const status = await getDemoGestoriaStatus(prisma);

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  CREDENCIALES DE ACCESO");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Email:      ${DEMO_EMAIL}`);
  console.log(`  Contraseña: ${DEMO_PASSWORD}`);
  console.log("");
  console.log("  ESTADO");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Usuario     → ${status.user?.name} <${status.user?.email}>`);
  console.log(`  Empresa     → ${status.company?.name} (${status.company?.company_type})`);
  console.log(`  Suscripción → ${status.subscription?.plan_name} / ${status.subscription?.status}`);
  console.log(`  Licencias   → ${status.licensesAvailable} disponibles / ${status.pack?.pack_size} total`);
  console.log("");
  console.log("  RESET:");
  console.log("  npx tsx --require dotenv/config scripts/create-demo-gestoria.ts --reset");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .catch((e) => {
    console.error("❌ Error:", e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
