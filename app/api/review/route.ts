import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/auth-options";
import { prisma } from "@/lib/prisma";
import { resolveActiveCompanyId } from "@/lib/active-company";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["admin", "member", "viewer"]);

async function getContext() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
  }

  const companyId = await resolveActiveCompanyId(session);
  const membership = companyId
    ? await prisma.membership.findFirst({
        where: { user_id: session.user.id, company_id: companyId },
        include: { company: true },
      })
    : null;

  if (!membership) {
    return { error: NextResponse.json({ error: "MEMBERSHIP_NOT_FOUND" }, { status: 404 }) };
  }

  const role = (membership.role || "viewer").toLowerCase();
  if (!ALLOWED_ROLES.has(role)) {
    return { error: NextResponse.json({ error: "FORBIDDEN_ROLE" }, { status: 403 }) };
  }

  return { membership, role };
}

export async function GET() {
  try {
    const ctx = await getContext();
    if ("error" in ctx) return ctx.error;

    const companyId = ctx.membership.company_id;

    const [pendingInvoices, pendingDocuments] = await Promise.all([
      prisma.invoice.findMany({
        where: { company_id: companyId, review_status: "pending" },
        select: {
          id: true,
          document_id: true,
          invoice_number: true,
          invoice_type: true,
          supplier_name: true,
          supplier_tax_id: true,
          customer_name: true,
          customer_tax_id: true,
          total_amount: true,
          subtotal: true,
          tax_amount: true,
          tax_rate: true,
          currency: true,
          issue_date: true,
          due_date: true,
          payment_method: true,
          category: true,
          notes: true,
          extraction_confidence: true,
          review_status: true,
        },
        orderBy: { issue_date: "desc" },
        take: 100,
      }),
      prisma.document.findMany({
        where: { company_id: companyId, processing_status: "needs_review" },
        select: {
          id: true,
          original_filename: true,
          source_channel: true,
          processing_status: true,
          upload_timestamp: true,
          mime_type: true,
        },
        orderBy: { upload_timestamp: "desc" },
        take: 100,
      }),
    ]);

    return NextResponse.json({
      summary: {
        pendingInvoices: pendingInvoices.length,
        pendingDocuments: pendingDocuments.length,
        total: pendingInvoices.length + pendingDocuments.length,
      },
      invoices: pendingInvoices,
      documents: pendingDocuments,
    });
  } catch (error) {
    console.error("[api/review][GET]", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getContext();
    if ("error" in ctx) return ctx.error;

    if (ctx.role === "viewer") {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json();
    const { itemType, id, action } = body || {};

    if (!itemType || !id || !action) {
      return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
    }

    const companyId = ctx.membership.company_id;
    const userId = ctx.membership.user_id;

    if (itemType === "invoice") {
      const review_status = action === "approve" ? "approved" : action === "reject" ? "rejected" : null;
      if (!review_status) {
        return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
      }

      // Multi-tenant guard
      const existing = await prisma.invoice.findFirst({ where: { id, company_id: companyId } });
      if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

      const updated = await prisma.invoice.update({
        where: { id },
        data: { review_status },
      });

      await prisma.auditLog.create({
        data: {
          company_id: companyId,
          user_id: userId,
          entity_type: "invoice",
          entity_id: id,
          action: "review",
          old_values: JSON.stringify({ review_status: existing.review_status }),
          new_values: JSON.stringify({ review_status }),
        },
      });

      return NextResponse.json({ ok: true, itemType, id: updated.id, status: updated.review_status });
    }

    if (itemType === "document") {
      const processing_status = action === "approve" ? "completed" : action === "reject" ? "failed" : null;
      if (!processing_status) {
        return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
      }

      // Multi-tenant guard
      const existing = await prisma.document.findFirst({ where: { id, company_id: companyId } });
      if (!existing) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

      const updated = await prisma.document.update({
        where: { id },
        data: { processing_status },
      });

      await prisma.auditLog.create({
        data: {
          company_id: companyId,
          user_id: userId,
          entity_type: "document",
          entity_id: id,
          action: "review",
          old_values: JSON.stringify({ processing_status: existing.processing_status }),
          new_values: JSON.stringify({ processing_status }),
        },
      });

      return NextResponse.json({ ok: true, itemType, id: updated.id, status: updated.processing_status });
    }

    return NextResponse.json({ error: "INVALID_ITEM_TYPE" }, { status: 400 });
  } catch (error) {
    console.error("[api/review][PATCH]", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
