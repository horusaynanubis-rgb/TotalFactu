import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import { getDemoGestoriaStatus } from "@/lib/admin/demo-gestoria";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const status = await getDemoGestoriaStatus(prisma);
    return NextResponse.json(status);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Error" }, { status: 500 });
  }
}
