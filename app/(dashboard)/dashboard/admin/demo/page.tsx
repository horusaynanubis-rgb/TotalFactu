import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { getDemoGestoriaStatus } from "@/lib/admin/demo-gestoria";
import { prisma } from "@/lib/prisma";
import { AdminDemoPanel } from "./admin-panel";

export const dynamic = "force-dynamic";

export default async function AdminDemoPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/dashboard");

  const initialStatus = await getDemoGestoriaStatus(prisma);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Administración — Demo</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Gestiona la cuenta demo de gestoría para presentaciones comerciales.
        </p>
      </div>
      <AdminDemoPanel initialStatus={initialStatus} />
    </div>
  );
}
