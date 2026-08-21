import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/admin/platform-admin";
import { getCompanyDetail } from "@/lib/admin/company-detail";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/utils";
import { ArrowLeft, Building2, Users, CreditCard, BarChart3, Activity, AlertTriangle } from "lucide-react";
import { CopyIdButton } from "./copy-id-button";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, "success" | "info" | "warning" | "destructive" | "secondary"> = {
  Activa: "success",
  Beta: "info",
  "Pago pendiente": "warning",
  Cancelada: "destructive",
  Inactiva: "secondary",
  Interna: "secondary",
  "Sin suscripción": "secondary",
};

const BUCKET_LABEL: Record<string, string> = {
  interna: "Empresa interna",
  beta: "Beta",
  gestoria: "Gestoría",
  grupo: "Grupo empresarial",
  pago: "Empresa",
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

export default async function CompanyDetailPage({ params }: { params: { companyId: string } }) {
  const admin = await requirePlatformAdmin();
  if (!admin) redirect("/dashboard");

  const detail = await getCompanyDetail(params.companyId);
  if (!detail) notFound();

  const { company, users, subscription, usage, activity, incidents } = detail;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <Link href="/dashboard/admin" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-800 mb-3">
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver a Admin Control
        </Link>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-900">{company.name}</h1>
          <Badge variant={STATUS_BADGE[company.status] ?? "secondary"}>{company.status}</Badge>
          <Badge variant="outline">{BUCKET_LABEL[company.bucket] ?? company.bucket}</Badge>
        </div>
        <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
          <span>ID: {company.id}</span>
          <CopyIdButton id={company.id} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" /> Datos de la empresa
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-gray-500">CIF/NIF</p>
            <p className="font-medium">{company.taxId}</p>
          </div>
          <div>
            <p className="text-gray-500">Dirección</p>
            <p className="font-medium">{company.address ?? "—"}</p>
          </div>
          <div>
            <p className="text-gray-500">País</p>
            <p className="font-medium">{company.country}</p>
          </div>
          <div>
            <p className="text-gray-500">Tipo</p>
            <p className="font-medium capitalize">{company.companyType}</p>
          </div>
          <div>
            <p className="text-gray-500">Fecha de alta</p>
            <p className="font-medium">{formatDate(company.createdAt)}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" /> Usuarios ({users.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Nombre</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Email</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Rol</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Miembro desde</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="py-2 px-3">{u.name}</td>
                    <td className="py-2 px-3 text-gray-600">{u.email}</td>
                    <td className="py-2 px-3 text-gray-600 capitalize">{u.role}</td>
                    <td className="py-2 px-3 text-gray-600">{formatDate(u.memberSince)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            No se muestra "último login": NextAuth no mantiene un histórico fiable de inicios de sesión.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Suscripción
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          {subscription ? (
            <>
              <div>
                <p className="text-gray-500">Plan</p>
                <p className="font-medium">{subscription.planName}</p>
              </div>
              <div>
                <p className="text-gray-500">Estado Stripe</p>
                <p className="font-medium">{subscription.status}</p>
              </div>
              <div>
                <p className="text-gray-500">Stripe Customer ID</p>
                <p className="font-mono text-xs">{subscription.stripeCustomerId ?? "—"}</p>
              </div>
              <div>
                <p className="text-gray-500">Próximo cobro</p>
                <p className="font-medium">{subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : "—"}</p>
              </div>
            </>
          ) : (
            <p className="text-gray-500 col-span-full">Sin suscripción registrada.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Uso
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Documentos totales</p>
            <p className="font-medium">{usage.documentsTotal}</p>
          </div>
          <div>
            <p className="text-gray-500">Documentos (mes actual)</p>
            <p className="font-medium">{usage.documentsThisMonth}</p>
          </div>
          <div>
            <p className="text-gray-500">Facturas totales</p>
            <p className="font-medium">{usage.invoicesTotal}</p>
          </div>
          <div>
            <p className="text-gray-500">Facturas (mes actual)</p>
            <p className="font-medium">{usage.invoicesThisMonth}</p>
          </div>
          <div>
            <p className="text-gray-500">Telegram vinculado</p>
            <p className="font-medium">{usage.telegramLinked ? "Sí" : "No"}</p>
          </div>
          <div>
            <p className="text-gray-500">Documentación fiscal (tamaño aprox.)</p>
            <p className="font-medium">
              {usage.fiscalDocuments.count} archivos · {formatBytes(usage.fiscalDocuments.approxSizeBytes)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" /> Actividad
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Última subida</p>
            <p className="font-medium">{activity.lastDocumentUpload ? formatDateTime(activity.lastDocumentUpload) : "—"}</p>
          </div>
          <div>
            <p className="text-gray-500">Última factura</p>
            <p className="font-medium">{activity.lastInvoice ? formatDateTime(activity.lastInvoice) : "—"}</p>
          </div>
          <div>
            <p className="text-gray-500">Última exportación</p>
            <p className="font-medium">{activity.lastExport ? formatDateTime(activity.lastExport.at) : "—"}</p>
          </div>
          <div>
            <p className="text-gray-500">Última revisión gestoría</p>
            <p className="font-medium">{activity.lastGestoriaReview ? formatDateTime(activity.lastGestoriaReview) : "—"}</p>
          </div>
        </CardContent>
      </Card>

      {incidents.stuckDocuments > 0 && (
        <Card className="border-amber-300">
          <CardContent className="p-4 flex items-center gap-3 text-amber-800">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <p className="text-sm">
              {incidents.stuckDocuments} documento(s) atascados en procesamiento (ver Admin Demo / diagnostics para más detalle).
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
