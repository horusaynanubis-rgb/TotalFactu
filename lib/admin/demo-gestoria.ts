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

// Demo client (empresa cliente asociada a la gestoría demo)
export const DEMO_CLIENT_USER_ID = "demo-client-user-001";
export const DEMO_CLIENT_COMPANY_ID = "demo-client-company-001";
export const DEMO_CLIENT_INVITATION_ID = "demo-client-invitation-001";
export const DEMO_CLIENT_TOKEN = "demo-client-activation-token-000001";
export const DEMO_CLIENT_EMAIL = "demo.cliente@totalfactu.com";
export const DEMO_CLIENT_PASSWORD = "DemoCliente2026!";
export const DEMO_CLIENT_NAME = "Cliente Demo";
export const DEMO_CLIENT_COMPANY_NAME = "Empresa Demo S.L.";
export const DEMO_CLIENT_TAX_ID = "B12345678";

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

// ---------------------------------------------------------------------------
// Demo client
// ---------------------------------------------------------------------------

export async function createDemoClient(prisma: PrismaClient): Promise<DemoGestoriaResult> {
  try {
    // Gestoría must exist first
    const gestoriaCompany = await prisma.company.findUnique({ where: { id: DEMO_COMPANY_ID } });
    if (!gestoriaCompany) {
      return { success: false, message: "La gestoría demo no existe. Ejecuta createDemoGestoria primero." };
    }

    const demoLicense = await prisma.license.findUnique({ where: { id: DEMO_LICENSE_ID } });
    if (!demoLicense) {
      return { success: false, message: "La licencia demo no existe. Ejecuta createDemoGestoria primero." };
    }

    // Guard: if license is already assigned to a DIFFERENT client, abort
    if (demoLicense.client_company_id && demoLicense.client_company_id !== DEMO_CLIENT_COMPANY_ID) {
      return {
        success: false,
        message: `La licencia demo ya está asignada a otra empresa (${demoLicense.client_company_id}). Ejecuta resetDemoGestoria primero.`,
      };
    }

    const existingClientByEmail = await prisma.user.findUnique({ where: { email: DEMO_CLIENT_EMAIL } });
    if (existingClientByEmail && existingClientByEmail.id !== DEMO_CLIENT_USER_ID) {
      return {
        success: false,
        message: `Ya existe un usuario con ${DEMO_CLIENT_EMAIL} y un ID distinto. Ejecuta resetDemoClient primero.`,
      };
    }

    const passwordHash = await bcrypt.hash(DEMO_CLIENT_PASSWORD, 10);

    const clientUser = await prisma.user.upsert({
      where: { id: DEMO_CLIENT_USER_ID },
      update: { email: DEMO_CLIENT_EMAIL, password_hash: passwordHash, name: DEMO_CLIENT_NAME },
      create: {
        id: DEMO_CLIENT_USER_ID,
        email: DEMO_CLIENT_EMAIL,
        password_hash: passwordHash,
        name: DEMO_CLIENT_NAME,
      },
    });

    const clientCompany = await prisma.company.upsert({
      where: { id: DEMO_CLIENT_COMPANY_ID },
      update: { name: DEMO_CLIENT_COMPANY_NAME },
      create: {
        id: DEMO_CLIENT_COMPANY_ID,
        name: DEMO_CLIENT_COMPANY_NAME,
        tax_id: DEMO_CLIENT_TAX_ID,
        address: "Avenida Demo Cliente, 42 — Barcelona, España",
        country: "ES",
        fiscal_year_start: 1,
        export_email: DEMO_CLIENT_EMAIL,
        company_type: "individual",
        ai_provider: "external",
      },
    });

    await prisma.membership.upsert({
      where: { user_id_company_id: { user_id: clientUser.id, company_id: clientCompany.id } },
      update: { role: "admin" },
      create: { user_id: clientUser.id, company_id: clientCompany.id, role: "admin" },
    });

    const existingClientSub = await prisma.subscription.findFirst({ where: { company_id: clientCompany.id } });
    const periodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    if (existingClientSub) {
      await prisma.subscription.update({
        where: { id: existingClientSub.id },
        data: { plan_name: "demo", status: "active", current_period_start: new Date(), current_period_end: periodEnd },
      });
    } else {
      await prisma.subscription.create({
        data: {
          company_id: clientCompany.id,
          plan_name: "demo",
          status: "active",
          current_period_start: new Date(),
          current_period_end: periodEnd,
        },
      });
    }

    // Link the demo license to the client company
    await prisma.license.update({
      where: { id: DEMO_LICENSE_ID },
      data: { status: "assigned", client_company_id: clientCompany.id, assigned_at: new Date() },
    });

    // Bump usage counter on the pack
    await prisma.licensePack.update({
      where: { id: DEMO_PACK_ID },
      data: { licenses_used: 1 },
    });

    // Create or update the invitation record (marked as accepted so it shows in the dashboard)
    const existingInvitation = await prisma.licenseInvitation.findUnique({ where: { id: DEMO_CLIENT_INVITATION_ID } });
    const invitationExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    if (existingInvitation) {
      await prisma.licenseInvitation.update({
        where: { id: DEMO_CLIENT_INVITATION_ID },
        data: { email: DEMO_CLIENT_EMAIL, status: "accepted", accepted_at: new Date(), expires_at: invitationExpiry },
      });
    } else {
      await prisma.licenseInvitation.create({
        data: {
          id: DEMO_CLIENT_INVITATION_ID,
          gestoria_company_id: DEMO_COMPANY_ID,
          license_id: DEMO_LICENSE_ID,
          email: DEMO_CLIENT_EMAIL,
          token: DEMO_CLIENT_TOKEN,
          status: "accepted",
          accepted_at: new Date(),
          expires_at: invitationExpiry,
        },
      });
    }

    // Create sample invoices so the gestoria dashboard shows real activity
    await _createDemoClientInvoices(prisma, clientCompany.id, clientUser.id);

    return { success: true, message: "Cliente demo creado / actualizado correctamente." };
  } catch (error: any) {
    return { success: false, message: error?.message ?? "Error desconocido" };
  }
}

async function _createDemoClientInvoices(prisma: PrismaClient, companyId: string, userId: string) {
  // Idempotent: skip if documents already exist for this company
  const existingCount = await prisma.document.count({ where: { company_id: companyId } });
  if (existingCount > 0) return;

  const samples: Array<{
    filename: string;
    channel: string;
    status: string;
    confidence: number | null;
    invoiceType: string;
    invoiceNumber: string;
    issueDate: Date;
    dueDate: Date;
    supplierName: string;
    supplierTaxId: string;
    customerName: string;
    customerTaxId: string;
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
    currency: string;
    taxRate: number;
    category: string;
    reviewStatus: string;
  }> = [
    {
      filename: "factura_proveedor_luz_mayo2026.pdf",
      channel: "web",
      status: "completed",
      confidence: 0.94,
      invoiceType: "received",
      invoiceNumber: "LUZ-2026-001122",
      issueDate: new Date("2026-05-02"),
      dueDate: new Date("2026-06-02"),
      supplierName: "Endesa Energía S.A.",
      supplierTaxId: "A81948077",
      customerName: DEMO_CLIENT_COMPANY_NAME,
      customerTaxId: DEMO_CLIENT_TAX_ID,
      subtotal: 320.0,
      taxAmount: 67.2,
      totalAmount: 387.2,
      currency: "EUR",
      taxRate: 21.0,
      category: "Suministros",
      reviewStatus: "approved",
    },
    {
      filename: "factura_alquiler_oficina_mayo2026.pdf",
      channel: "telegram",
      status: "completed",
      confidence: 0.91,
      invoiceType: "received",
      invoiceNumber: "ALQ-2026-00045",
      issueDate: new Date("2026-05-01"),
      dueDate: new Date("2026-05-31"),
      supplierName: "Inmobiliaria Demo S.L.",
      supplierTaxId: "B87654321",
      customerName: DEMO_CLIENT_COMPANY_NAME,
      customerTaxId: DEMO_CLIENT_TAX_ID,
      subtotal: 1200.0,
      taxAmount: 252.0,
      totalAmount: 1452.0,
      currency: "EUR",
      taxRate: 21.0,
      category: "Alquiler",
      reviewStatus: "approved",
    },
    {
      filename: "factura_gestor_asesoria_abr2026.pdf",
      channel: "email",
      status: "completed",
      confidence: 0.88,
      invoiceType: "received",
      invoiceNumber: "ASE-2026-0312",
      issueDate: new Date("2026-04-30"),
      dueDate: new Date("2026-05-30"),
      supplierName: DEMO_COMPANY_NAME,
      supplierTaxId: "B-DEMO-GESTORIA",
      customerName: DEMO_CLIENT_COMPANY_NAME,
      customerTaxId: DEMO_CLIENT_TAX_ID,
      subtotal: 250.0,
      taxAmount: 52.5,
      totalAmount: 302.5,
      currency: "EUR",
      taxRate: 21.0,
      category: "Asesoría",
      reviewStatus: "approved",
    },
    {
      filename: "factura_software_contabilidad.pdf",
      channel: "web",
      status: "needs_review",
      confidence: 0.67,
      invoiceType: "received",
      invoiceNumber: "SW-2026-8899",
      issueDate: new Date("2026-05-10"),
      dueDate: new Date("2026-06-10"),
      supplierName: "Sage España S.L.",
      supplierTaxId: "B12348765",
      customerName: DEMO_CLIENT_COMPANY_NAME,
      customerTaxId: DEMO_CLIENT_TAX_ID,
      subtotal: 89.0,
      taxAmount: 18.69,
      totalAmount: 107.69,
      currency: "EUR",
      taxRate: 21.0,
      category: "Software",
      reviewStatus: "pending",
    },
    {
      filename: "factura_emitida_cliente_abc.pdf",
      channel: "web",
      status: "completed",
      confidence: 0.97,
      invoiceType: "issued",
      invoiceNumber: "EMP-2026-0001",
      issueDate: new Date("2026-05-05"),
      dueDate: new Date("2026-06-05"),
      supplierName: DEMO_CLIENT_COMPANY_NAME,
      supplierTaxId: DEMO_CLIENT_TAX_ID,
      customerName: "Cliente ABC Corp S.A.",
      customerTaxId: "A98765432",
      subtotal: 3500.0,
      taxAmount: 735.0,
      totalAmount: 4235.0,
      currency: "EUR",
      taxRate: 21.0,
      category: "Servicios",
      reviewStatus: "approved",
    },
  ];

  for (const s of samples) {
    const doc = await prisma.document.create({
      data: {
        company_id: companyId,
        user_id: userId,
        source_channel: s.channel,
        original_filename: s.filename,
        mime_type: "application/pdf",
        processing_status: s.status,
        confidence_score: s.confidence,
        cloud_storage_path: `demo/${companyId}/${s.filename}`,
        is_public: false,
      },
    });

    if (s.status !== "processing") {
      await prisma.invoice.create({
        data: {
          document_id: doc.id,
          company_id: companyId,
          invoice_type: s.invoiceType,
          invoice_number: s.invoiceNumber,
          issue_date: s.issueDate,
          due_date: s.dueDate,
          supplier_name: s.supplierName,
          supplier_tax_id: s.supplierTaxId,
          customer_name: s.customerName,
          customer_tax_id: s.customerTaxId,
          subtotal: s.subtotal,
          tax_amount: s.taxAmount,
          total_amount: s.totalAmount,
          currency: s.currency,
          tax_rate: s.taxRate,
          category: s.category,
          extraction_confidence: s.confidence ?? 0.5,
          review_status: s.reviewStatus,
        },
      });
    }
  }
}

export async function resetDemoClient(prisma: PrismaClient): Promise<DemoGestoriaResult> {
  try {
    // Remove client invoices + documents
    const docs = await prisma.document.findMany({
      where: { company_id: DEMO_CLIENT_COMPANY_ID },
      select: { id: true },
    });
    for (const doc of docs) {
      await prisma.invoice.deleteMany({ where: { document_id: doc.id } });
    }
    await prisma.document.deleteMany({ where: { company_id: DEMO_CLIENT_COMPANY_ID } });

    // Detach license from client
    await prisma.license.updateMany({
      where: { client_company_id: DEMO_CLIENT_COMPANY_ID },
      data: { status: "available", client_company_id: null, assigned_at: null },
    });

    // Reset pack usage
    await prisma.licensePack.updateMany({
      where: { id: DEMO_PACK_ID },
      data: { licenses_used: 0 },
    });

    // Remove invitation
    await prisma.licenseInvitation.deleteMany({ where: { id: DEMO_CLIENT_INVITATION_ID } });

    // Remove membership + subscription + company + user
    await prisma.membership.deleteMany({ where: { company_id: DEMO_CLIENT_COMPANY_ID } });
    await prisma.subscription.deleteMany({ where: { company_id: DEMO_CLIENT_COMPANY_ID } });
    await prisma.company.deleteMany({ where: { id: DEMO_CLIENT_COMPANY_ID } });
    await prisma.user.deleteMany({ where: { id: DEMO_CLIENT_USER_ID } });

    return { success: true, message: "Cliente demo eliminado correctamente." };
  } catch (error: any) {
    return { success: false, message: error?.message ?? "Error desconocido" };
  }
}
