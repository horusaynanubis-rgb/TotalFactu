"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CheckCircle, XCircle, RefreshCw, Plus, Copy, KeyRound, User, Building2, CreditCard, Package } from "lucide-react";
import type { DemoGestoriaStatus } from "@/lib/admin/demo-gestoria";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/lib/admin/demo-gestoria";

interface Props {
  initialStatus: DemoGestoriaStatus;
}

export function AdminDemoPanel({ initialStatus }: Props) {
  const [status, setStatus] = useState<DemoGestoriaStatus>(initialStatus);
  const [loadingCreate, setLoadingCreate] = useState(false);
  const [loadingReset, setLoadingReset] = useState(false);

  async function refreshStatus() {
    const res = await fetch("/api/admin/demo-gestoria/status");
    if (res.ok) {
      const data = await res.json();
      setStatus(data);
    }
  }

  async function handleCreate() {
    setLoadingCreate(true);
    try {
      const res = await fetch("/api/admin/demo-gestoria/create", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        await refreshStatus();
      } else {
        toast.error(data.message ?? "Error al crear la demo");
      }
    } catch {
      toast.error("Error de red. Inténtalo de nuevo.");
    } finally {
      setLoadingCreate(false);
    }
  }

  async function handleReset() {
    setLoadingReset(true);
    try {
      const res = await fetch("/api/admin/demo-gestoria/reset", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        await refreshStatus();
      } else {
        toast.error(data.message ?? "Error al resetear la demo");
      }
    } catch {
      toast.error("Error de red. Inténtalo de nuevo.");
    } finally {
      setLoadingReset(false);
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copiado`));
  }

  return (
    <div className="space-y-5">
      {/* Credentials card */}
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-blue-800">
            <KeyRound className="h-5 w-5" />
            Credenciales de acceso demo
          </CardTitle>
          <CardDescription className="text-blue-700">
            Usa estas credenciales para iniciar sesión en la demo de gestoría.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-md bg-white border border-blue-200 px-4 py-2.5">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-0.5">Usuario</p>
              <p className="font-mono text-sm font-semibold">{DEMO_EMAIL}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-blue-600"
              onClick={() => copyToClipboard(DEMO_EMAIL, "Email")}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center justify-between rounded-md bg-white border border-blue-200 px-4 py-2.5">
            <div>
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-0.5">Contraseña</p>
              <p className="font-mono text-sm font-semibold">{DEMO_PASSWORD}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-blue-600"
              onClick={() => copyToClipboard(DEMO_PASSWORD, "Contraseña")}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Status card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Estado actual de la demo</CardTitle>
            <Badge variant={status.exists ? "default" : "secondary"}>
              {status.exists ? "Activa" : "No existe"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {!status.exists ? (
            <p className="text-sm text-muted-foreground">
              La cuenta demo no existe todavía. Usa el botón de abajo para crearla.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <StatusRow
                icon={<User className="h-4 w-4" />}
                label="Usuario"
                value={status.user?.email ?? "—"}
                sub={status.user ? `Creado ${new Date(status.user.created_at).toLocaleDateString("es-ES")}` : undefined}
              />
              <StatusRow
                icon={<Building2 className="h-4 w-4" />}
                label="Empresa"
                value={status.company?.name ?? "—"}
                sub={status.company?.company_type}
              />
              <StatusRow
                icon={<CreditCard className="h-4 w-4" />}
                label="Suscripción"
                value={status.subscription ? `${status.subscription.plan_name} / ${status.subscription.status}` : "—"}
                sub={
                  status.subscription?.current_period_end
                    ? `Válida hasta ${new Date(status.subscription.current_period_end).toLocaleDateString("es-ES")}`
                    : undefined
                }
                ok={status.subscription?.status === "active"}
              />
              <StatusRow
                icon={<Package className="h-4 w-4" />}
                label="Licencias"
                value={
                  status.pack
                    ? `${status.licensesAvailable} disponibles / ${status.pack.pack_size} total`
                    : "Sin pack"
                }
                sub={status.pack ? `Usadas: ${status.pack.licenses_used}` : undefined}
                ok={status.licensesAvailable > 0}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Acciones</CardTitle>
          <CardDescription>
            "Crear / actualizar" es idempotente y seguro de ejecutar en cualquier momento.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={handleCreate} disabled={loadingCreate || loadingReset}>
            {loadingCreate ? (
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Crear / actualizar demo
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={loadingCreate || loadingReset || !status.exists}>
                {loadingReset ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-2 h-4 w-4" />
                )}
                Resetear demo
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Resetear la cuenta demo?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esto eliminará el usuario, la empresa, la suscripción, el pack y todas las licencias
                  e invitaciones de la demo. La acción no se puede deshacer.
                  <br />
                  <br />
                  Después del reset, podrás volver a crear la demo con el botón
                  &ldquo;Crear / actualizar demo&rdquo;.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleReset}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Sí, resetear
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusRow({
  icon,
  label,
  value,
  sub,
  ok,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  ok?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <p className="text-sm font-medium truncate">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      {ok !== undefined && (
        <div className="mt-0.5">
          {ok ? (
            <CheckCircle className="h-4 w-4 text-green-500" />
          ) : (
            <XCircle className="h-4 w-4 text-orange-400" />
          )}
        </div>
      )}
    </div>
  );
}
