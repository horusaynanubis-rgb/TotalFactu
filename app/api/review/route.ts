import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/auth-options";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["admin", "member", "viewer"]);

async function getContext() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
  }

  const membership = await prisma.membership.findFirst({
    where: { user_id: session.user.id },
    include: { company: true },
  });

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
          invoice_number: true,
          supplier_name: true,
          total_amount: true,
          currency: true,
          issue_date: true,
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

    if (itemType === "invoice") {
      const review_status = action === "approve" ? "approved" : action === "reject" ? "rejected" : null;
      if (!review_status) {
        return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
      }

      const updated = await prisma.invoice.update({
        where: { id },
        data: { review_status },
      });

      return NextResponse.json({ ok: true, itemType, id: updated.id, status: updated.review_status });
    }

    if (itemType === "document") {
      const processing_status = action === "approve" ? "completed" : action === "reject" ? "failed" : null;
      if (!processing_status) {
        return NextResponse.json({ error: "INVALID_ACTION" }, { status: 400 });
      }

      const updated = await prisma.document.update({
        where: { id },
        data: { processing_status },
      });

      return NextResponse.json({ ok: true, itemType, id: updated.id, status: updated.processing_status });
    }

    return NextResponse.json({ error: "INVALID_ITEM_TYPE" }, { status: 400 });
  } catch (error) {
    console.error("[api/review][PATCH]", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
