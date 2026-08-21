/**
 * Resetea ÚNICAMENTE la contraseña del usuario admincontrol@totalfactu.com.
 * No toca role, company, ni ningún otro usuario — solo actualiza
 * User.password_hash de esa fila.
 *
 * Uso:
 *   cd nextjs_space
 *   npx tsx --require dotenv/config scripts/reset-platform-admin-password.ts
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

const ADMIN_EMAIL = "admincontrol@totalfactu.com";

function generateTemporaryPassword(): string {
  return randomBytes(18).toString("base64url");
}

async function main() {
  const user = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!user) {
    console.error(`❌ No existe ningún usuario con email ${ADMIN_EMAIL}`);
    process.exit(1);
  }

  const password = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.update({
    where: { id: user.id },
    data: { password_hash: passwordHash },
  });

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Contraseña reseteada — Admin Control");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`\n  Email:      ${ADMIN_EMAIL}`);
  console.log(`  Contraseña: ${password}`);
  console.log("\n  Guárdala ahora — no se volverá a mostrar.");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .catch((e) => {
    console.error("❌ Error:", e.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
