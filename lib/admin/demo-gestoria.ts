import type { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

export const DEMO_USER_ID = "demo-gestoria-user-001";
export const DEMO_COMPANY_ID = "demo-gestoria-company-001";
export const DEMO_PACK_ID = "demo-gestoria-pack-001";
export const DEMO_LICENSE_ID = "demo-gestoria-license-001";

export const DEMO_EMAIL = "demo-gestoria@totalfactu.com";
export const DEMO_PASSWORD = "DemoTotalFactu2026!";
export const DEMO_NAME = "Demo Gestoría";
export const DEMO_COMPANY_NAME = "Gestoría Demo";

export interface DemoGestoriaStatus {
  exists: boolean;
  user: { id: string; email: string; name: string; created_at: Date } | null;
  company: { id: string; name: string; company_type: string; created_at: Date } | null;
  subscription: { plan_name: string; status: string; current_period_end: Date | null } | null;
  pack: { id: string; pack_size: number; licenses_used: number; status: string } | null;
  licensesAvailable: number;
}

export interface DemoGestoriaResult {
  success: boolean;
  message: string;
}

export async function getDemoGestoriaStatus(prisma: PrismaClient): Promise<DemoGestoriaStatus> {
  const user = await prisma.user.findUnique({
    where: { id: DEMO_USER_ID },
    select: { id: true, email: true, name: true, created_at: true },
  });

  if (!user) {
    return { exists: false, user: null, company: null, subscription: null, pack: null, licensesAvailable: 0 };
  }

  const company = await prisma.company.findUnique({
    where: { id: DEMO_COMPANY_ID },
    select: { id: true, name: true, company_type: true, created_at: true },
  });

  const subscription = company
    ? await prisma.subscription.findFirst({
        where: { company_id: DEMO_COMPANY_ID },
        select: { plan_name: true, status: true, current_period_end: true },
      })
    : null;

  const pack = await prisma.licensePack.findUnique({
    where: { id: DEMO_PACK_ID },
    select: { id: true, pack_size: true, licenses_used: true, status: true },
  });

  return {
    exists: true,
    user,
    company,
    subscription,
    pack,
    licensesAvailable: pack ? pack.pack_size - pack.licenses_used : 0,
  };
}

export async function createDemoGestoria(prisma: PrismaClient): Promise<DemoGestoriaResult> {
  try {
    const existingByEmail = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
    if (existingByEmail && existingByEmail.id !== DEMO_USER_ID) {
      return {
        success: false,
        message: `Ya existe un usuario con ${DEMO_EMAIL} y un ID distinto. Ejecuta reset primero.`,
      };
    }

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

    const user = await prisma.user.upsert({
      where: { id: DEMO_USER_ID },
      update: { email: DEMO_EMAIL, password_hash: passwordHash, name: DEMO_NAME },
      create: { id: DEMO_USER_ID, email: DEMO_EMAIL, password_hash: passwordHash, name: DEMO_NAME },
    });

    const company = await prisma.company.upsert({
      where: { id: DEMO_COMPANY_ID },
      update: { name: DEMO_COMPANY_NAME, company_type: "gestoria" },
      create: {
        id: DEMO_COMPANY_ID,
        name: DEMO_COMPANY_NAME,
        tax_id: "B-DEMO-GESTORIA",
        address: "Calle Demo, 1 — Madrid, España",
        country: "ES",
        fiscal_year_start: 1,
        export_email: DEMO_EMAIL,
        company_type: "gestoria",
        ai_provider: "external",
      },
    });

    await prisma.membership.upsert({
      where: { user_id_company_id: { user_id: user.id, company_id: company.id } },
      update: { role: "admin" },
      create: { user_id: user.id, company_id: company.id, role: "admin" },
    });

    const existingSub = await prisma.subscription.findFirst({ where: { company_id: company.id } });
    const periodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    if (existingSub) {
      await prisma.subscription.update({
        where: { id: existingSub.id },
        data: { plan_name: "gestoria", status: "active", current_period_start: new Date(), current_period_end: periodEnd },
      });
    } else {
      await prisma.subscription.create({
        data: {
          company_id: company.id,
          plan_name: "gestoria",
          status: "active",
          current_period_start: new Date(),
          current_period_end: periodEnd,
        },
      });
    }

    await prisma.licensePack.upsert({
      where: { id: DEMO_PACK_ID },
      update: { pack_size: 1, licenses_used: 0, status: "active" },
      create: {
        id: DEMO_PACK_ID,
        gestoria_company_id: company.id,
        pack_size: 1,
        licenses_used: 0,
        status: "active",
        period_start: new Date(),
        period_end: periodEnd,
      },
    });

    await prisma.license.upsert({
      where: { id: DEMO_LICENSE_ID },
      update: { status: "available", client_company_id: null, assigned_at: null, revoked_at: null },
      create: { id: DEMO_LICENSE_ID, pack_id: DEMO_PACK_ID, status: "available" },
    });

    return { success: true, message: "Cuenta demo creada / actualizada correctamente." };
  } catch (error: any) {
    return { success: false, message: error?.message ?? "Error desconocido" };
  }
}

export async function resetDemoGestoria(prisma: PrismaClient): Promise<DemoGestoriaResult> {
  try {
    await prisma.licenseInvitation.deleteMany({ where: { gestoria_company_id: DEMO_COMPANY_ID } });
    await prisma.license.deleteMany({ where: { pack_id: DEMO_PACK_ID } });
    await prisma.licensePack.deleteMany({ where: { id: DEMO_PACK_ID } });
    await prisma.subscription.deleteMany({ where: { company_id: DEMO_COMPANY_ID } });
    await prisma.membership.deleteMany({ where: { company_id: DEMO_COMPANY_ID } });
    await prisma.company.deleteMany({ where: { id: DEMO_COMPANY_ID } });
    await prisma.user.deleteMany({ where: { id: DEMO_USER_ID } });

    return { success: true, message: "Cuenta demo eliminada. Usa 'Crear / actualizar' para recrearla." };
  } catch (error: any) {
    return { success: false, message: error?.message ?? "Error desconocido" };
  }
}
