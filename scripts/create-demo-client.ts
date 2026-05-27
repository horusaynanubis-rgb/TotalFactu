/**
 * Script idempotente para crear el cliente demo asociado a la gestoría demo.
 * Garantiza que la gestoría demo exista y crea un cliente final de prueba
 * correctamente vinculado mediante licencia + invitación aceptada.
 *
 * Uso:
 *   npx tsx --require dotenv/config scripts/create-demo-client.ts
 *   npx tsx --require dotenv/config scripts/create-demo-client.ts --reset
 */

import { PrismaClient } from "@prisma/client";
import {
  createDemoGestoria,
  createDemoClient,
  resetDemoClient,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_CLIENT_EMAIL,
  DEMO_CLIENT_PASSWORD,
  DEMO_CLIENT_COMPANY_NAME,
  DEMO_CLIENT_NAME,
} from "../lib/admin/demo-gestoria";

const prisma = new PrismaClient();

async function main() {
  const isReset = process.argv.includes("--reset");

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  TotalFactu — Cliente Demo");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (isReset) {
    console.log("🗑️  Eliminando cliente demo...\n");
    const result = await resetDemoClient(prisma);
    if (result.success) {
      console.log("✅", result.message);
      console.log("\nVuelve a ejecutar sin --reset para recrear el cliente.");
    } else {
      console.error("❌", result.message);
      process.exit(1);
    }
    return;
  }

  // 1. Ensure gestoria demo exists
  console.log("🏢 Paso 1/2: Verificando / creando gestoría demo...");
  const gestoriaResult = await createDemoGestoria(prisma);
  if (!gestoriaResult.success) {
    console.error("❌ Gestoría demo:", gestoriaResult.message);
    process.exit(1);
  }
  console.log("✅", gestoriaResult.message, "\n");

  // 2. Create demo client linked to that gestoria
  console.log("👤 Paso 2/2: Creando / actualizando cliente demo...");
  const clientResult = await createDemoClient(prisma);
  if (!clientResult.success) {
    console.error("❌ Cliente demo:", clientResult.message);
    process.exit(1);
  }
  console.log("✅", clientResult.message, "\n");

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  CREDENCIALES GESTORÍA DEMO");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Email:      ${DEMO_EMAIL}`);
  console.log(`  Contraseña: ${DEMO_PASSWORD}`);
  console.log(`  Dashboard:  /dashboard/gestoria/clients`);
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  CREDENCIALES CLIENTE DEMO");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Nombre:     ${DEMO_CLIENT_NAME}`);
  console.log(`  Empresa:    ${DEMO_CLIENT_COMPANY_NAME}`);
  console.log(`  Email:      ${DEMO_CLIENT_EMAIL}`);
  console.log(`  Contraseña: ${DEMO_CLIENT_PASSWORD}`);
  console.log(`  Dashboard:  /dashboard`);
  console.log("");
  console.log("  RESET:");
  console.log("  npx tsx --require dotenv/config scripts/create-demo-client.ts --reset");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .catch((e) => {
    console.error("❌ Error:", e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
