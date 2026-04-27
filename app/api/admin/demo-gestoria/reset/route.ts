import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { resetDemoGestoria } from "@/lib/admin/demo-gestoria";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await resetDemoGestoria(prisma);
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
