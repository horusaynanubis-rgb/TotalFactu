import { redirect } from "next/navigation";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/admin/platform-admin";
import { AdminControlDashboard } from "./admin-dashboard-client";
import { BarChart3 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminControlPage() {
  const admin = await requirePlatformAdmin();
  if (!admin) redirect("/dashboard");

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Admin Control</h1>
          <p className="text-gray-600 mt-1">Supervisión interna de todas las empresas de TotalFactu — solo lectura.</p>
        </div>
        <Link
          href="/dashboard/admin/reports"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <BarChart3 className="h-4 w-4" /> Ver reportes
        </Link>
      </div>
      <AdminControlDashboard />
    </div>
  );
}
