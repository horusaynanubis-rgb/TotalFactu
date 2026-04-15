"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type DashboardUserData = {
  profile: { id: string; name: string; email: string; role: string };
  company: { id: string; name: string; taxId: string; country: string };
  integrations: { telegramConnected: boolean; aiConnected: boolean; aiProvider: string };
  summary: { documentsCount: number; invoicesCount: number; needsReviewCount: number };
  recent: {
    documents: Array<{ id: string; original_filename: string; source_channel: string; processing_status: string; upload_timestamp: string }>;
    invoices: Array<{ id: string; invoice_number: string; supplier_name: string; total_amount: number; currency: string; issue_date: string; review_status: string }>;
  };
};

export function DashboardUserContent() {
  const [data, setData] = useState<DashboardUserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/dashboard/user", { cache: "no-store" });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const json = await res.json();
        if (mounted) setData(json);
      } catch (e: any) {
        if (mounted) setError(e?.message || "Error cargando dashboard");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, [reloadKey]);

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 w-56 bg-gray-200 rounded" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-32 bg-gray-100 rounded-xl" />
          <div className="h-32 bg-gray-100 rounded-xl" />
          <div className="h-32 bg-gray-100 rounded-xl" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="h-24 bg-gray-100 rounded-xl" />
          <div className="h-24 bg-gray-100 rounded-xl" />
          <div className="h-24 bg-gray-100 rounded-xl" />
        </div>
        <div className="h-40 bg-gray-100 rounded-xl" />
        <div className="h-40 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <Card className="border-red-200">
          <CardHeader>
            <CardTitle className="text-red-700">No se pudo cargar el dashboard</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-700">{error}</p>
            <Button onClick={() => setReloadKey((k) => k + 1)}>Reintentar</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) {
    return <div className="p-6">No hay datos disponibles.</div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">Panel de Usuario</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle>Perfil / Rol</CardTitle></CardHeader>
          <CardContent>
            <p><strong>Nombre:</strong> {data.profile.name}</p>
            <p><strong>Email:</strong> {data.profile.email}</p>
            <p><strong>Rol:</strong> {data.profile.role}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Empresa</CardTitle></CardHeader>
          <CardContent>
            <p><strong>Nombre:</strong> {data.company.name}</p>
            <p><strong>NIF/CIF:</strong> {data.company.taxId}</p>
            <p><strong>País:</strong> {data.company.country}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Integraciones</CardTitle></CardHeader>
          <CardContent>
            <p><strong>Telegram:</strong> {data.integrations.telegramConnected ? "Conectado" : "No conectado"}</p>
            <p><strong>IA:</strong> {data.integrations.aiConnected ? `Conectado (${data.integrations.aiProvider})` : "No conectado"}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle>Documentos</CardTitle></CardHeader>
          <CardContent>{data.summary.documentsCount}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Facturas</CardTitle></CardHeader>
          <CardContent>{data.summary.invoicesCount}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Pendientes de revisión</CardTitle></CardHeader>
          <CardContent className="text-yellow-700 font-semibold">{data.summary.needsReviewCount}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Documentos recientes</CardTitle></CardHeader>
        <CardContent>
          {data.recent.documents.length === 0 ? (
            <p>No hay documentos recientes.</p>
          ) : (
            <ul className="space-y-2">
              {data.recent.documents.map((d) => (
                <li key={d.id} className="text-sm">
                  {d.original_filename} · {d.source_channel} · {d.processing_status}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Facturas recientes</CardTitle></CardHeader>
        <CardContent>
          {data.recent.invoices.length === 0 ? (
            <p>No hay facturas recientes.</p>
          ) : (
            <ul className="space-y-2">
              {data.recent.invoices.map((i) => (
                <li key={i.id} className="text-sm">
                  #{i.invoice_number} · {i.supplier_name} · {i.total_amount} {i.currency} · {i.review_status}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
