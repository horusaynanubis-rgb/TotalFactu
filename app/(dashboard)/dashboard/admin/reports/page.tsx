import { redirect } from "next/navigation";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/admin/platform-admin";
import { ReportsClient } from "./reports-client";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  const admin = await requirePlatformAdmin();
  if (!admin) redirect("/dashboard");

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/admin" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-800 mb-3">
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver a Admin Control
        </Link>
        <h1 className="text-3xl font-bold text-gray-900">Reportes</h1>
        <p className="text-gray-600 mt-1">Métricas mensuales y evolución de la plataforma.</p>
      </div>
      <ReportsClient />
    </div>
  );
}
