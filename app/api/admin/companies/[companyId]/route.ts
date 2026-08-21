import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/admin/platform-admin";
import { getCompanyDetail } from "@/lib/admin/company-detail";

export const dynamic = "force-dynamic";

// GET /api/admin/companies/[companyId] — read-only company detail for
// Admin Control. See lib/admin/company-detail.ts for the query logic
// (shared with the server-rendered detail page, which calls it directly).
export async function GET(_request: NextRequest, { params }: { params: { companyId: string } }) {
  const admin = await requirePlatformAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const detail = await getCompanyDetail(params.companyId);
  if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(detail);
}
