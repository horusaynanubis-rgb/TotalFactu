"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";

type ReviewData = {
  summary: { pendingInvoices: number; pendingDocuments: number; total: number };
  invoices: Array<{ id: string; invoice_number: string; supplier_name: string; total_amount: number; currency: string; review_status: string }>;
  documents: Array<{ id: string; original_filename: string; source_channel: string; processing_status: string }>;
};

export default function ReviewQueuePage() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/review", { cache: "no-store" });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e?.message || "Error loading review queue");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const act = async (itemType: "invoice" | "document", id: string, action: "approve" | "reject") => {
    try {
      const res = await fetch("/api/review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemType, id, action }),
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      toast.success("Actualizado");
      load();
    } catch (e: any) {
      toast.error(e?.message || "Acción fallida");
    }
  };

  if (loading) return <div className="p-6">Cargando cola de revisión...</div>;
  if (error) return <div className="p-6 text-red-600">{error}</div>;
  if (!data) return <div className="p-6">Sin datos.</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">Cola de Revisión</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardHeader><CardTitle>Facturas pendientes</CardTitle></CardHeader><CardContent>{data.summary.pendingInvoices}</CardContent></Card>
        <Card><CardHeader><CardTitle>Documentos pendientes</CardTitle></CardHeader><CardContent>{data.summary.pendingDocuments}</CardContent></Card>
        <Card><CardHeader><CardTitle>Total pendientes</CardTitle></CardHeader><CardContent>{data.summary.total}</CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Facturas pendientes de revisión</CardTitle></CardHeader>
        <CardContent>
          {data.invoices.length === 0 ? (
            <p>No hay facturas pendientes.</p>
          ) : (
            <div className="space-y-2">
              {data.invoices.map((i) => (
                <div key={i.id} className="flex items-center justify-between border rounded p-3">
                  <div className="text-sm">#{i.invoice_number} · {i.supplier_name} · {i.total_amount} {i.currency}</div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => act("invoice", i.id, "approve")}>Aprobar</Button>
                    <Button size="sm" variant="outline" onClick={() => act("invoice", i.id, "reject")}>Rechazar</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Documentos que requieren revisión</CardTitle></CardHeader>
        <CardContent>
          {data.documents.length === 0 ? (
            <p>No hay documentos pendientes.</p>
          ) : (
            <div className="space-y-2">
              {data.documents.map((d) => (
                <div key={d.id} className="flex items-center justify-between border rounded p-3">
                  <div className="text-sm">{d.original_filename} · {d.source_channel} · {d.processing_status}</div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => act("document", d.id, "approve")}>Aprobar</Button>
                    <Button size="sm" variant="outline" onClick={() => act("document", d.id, "reject")}>Rechazar</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
