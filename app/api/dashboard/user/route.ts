import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/auth-options";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["admin", "member", "viewer"]);

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Authentication required" },
        { status: 401 }
      );
    }

    // Prefer the active company already validated in the JWT (multi-company
    // owner accounts); fall back to the oldest membership for a stale/edge
    // case token, same default as before this feature existed.
    const membership = session.user.companyId
      ? await prisma.membership.findFirst({
          where: { user_id: session.user.id, company_id: session.user.companyId },
          include: {
            company: true,
            user: { select: { id: true, name: true, email: true } },
          },
        })
      : await prisma.membership.findFirst({
          where: { user_id: session.user.id },
          orderBy: { created_at: 'asc' },
          include: {
            company: true,
            user: { select: { id: true, name: true, email: true } },
          },
        });

    if (!membership) {
      return NextResponse.json(
        { error: "MEMBERSHIP_NOT_FOUND", message: "User is not linked to any company" },
        { status: 404 }
      );
    }

    const role = membership.role?.toLowerCase?.() || "viewer";

    if (!ALLOWED_ROLES.has(role)) {
      return NextResponse.json(
        { error: "FORBIDDEN_ROLE", message: "Role is not allowed to access dashboard" },
        { status: 403 }
      );
    }

    const companyId = membership.company_id;

    const [
      documentsCount,
      invoicesCount,
      needsReviewDocs,
      needsReviewInvoices,
      recentDocuments,
      recentInvoices,
      telegramLink,
    ] = await Promise.all([
      prisma.document.count({ where: { company_id: companyId } }),
      prisma.invoice.count({ where: { company_id: companyId } }),
      prisma.document.count({
        where: { company_id: companyId, processing_status: "needs_review" },
      }),
      prisma.invoice.count({
        where: { company_id: companyId, review_status: "pending" },
      }),
      prisma.document.findMany({
        where: { company_id: companyId },
        select: {
          id: true,
          original_filename: true,
          source_channel: true,
          processing_status: true,
          upload_timestamp: true,
        },
        orderBy: { upload_timestamp: "desc" },
        take: 5,
      }),
      prisma.invoice.findMany({
        where: { company_id: companyId },
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
        take: 5,
      }),
      prisma.telegramLink.findFirst({
        where: { user_id: session.user.id, company_id: companyId },
      }),
    ]);

    return NextResponse.json({
      profile: {
        id: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        role,
      },
      company: {
        id: membership.company.id,
        name: membership.company.name,
        taxId: membership.company.tax_id,
        country: membership.company.country,
      },
      integrations: {
        telegramConnected: Boolean(telegramLink),
        aiConnected: Boolean(membership.company.ai_api_key),
        aiProvider: membership.company.ai_provider,
      },
      summary: {
        documentsCount,
        invoicesCount,
        needsReviewCount: needsReviewDocs + needsReviewInvoices,
      },
      recent: {
        documents: recentDocuments,
        invoices: recentInvoices,
      },
    });
  } catch (error) {
    console.error("[api/dashboard/user]", error);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Failed to load dashboard data" },
      { status: 500 }
    );
  }
}
