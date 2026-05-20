'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Truck, Search, TrendingUp, TrendingDown, ArrowRight, Package,
  AlertTriangle, BarChart2, ShoppingCart, Euro,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import toast from 'react-hot-toast';

interface SupplierRow {
  id: string;
  name: string;
  tax_id: string | null;
  invoice_count: number;
  total_spend: number;
  product_count: number;
  alerts_count: number;
  max_variation: number | null;
  last_activity: string | null;
}

interface Kpis {
  supplier_count: number;
  product_count: number;
  alerts_count: number;
  total_spend: number;
}

type Filter = 'all' | 'alerts' | 'stable';

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const router = useRouter();

  useEffect(() => {
    fetch('/api/suppliers')
      .then((r) => r.json())
      .then((d) => {
        setSuppliers(d.suppliers ?? []);
        setKpis(d.kpis ?? null);
      })
      .catch(() => toast.error('Error al cargar proveedores'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = suppliers;

    // Text search
    const q = search.toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.tax_id ?? '').toLowerCase().includes(q),
      );
    }

    // Status filter
    if (filter === 'alerts') list = list.filter((s) => s.alerts_count > 0);
    if (filter === 'stable') list = list.filter((s) => s.alerts_count === 0);

    return list;
  }, [suppliers, search, filter]);

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <p className="text-center text-gray-500 py-12">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Truck className="h-8 w-8 text-primary" />
          Proveedores
        </h1>
        <p className="text-gray-500 mt-1">
          Control de precios y seguimiento de compras por proveedor
        </p>
      </div>

      {/* KPI cards */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="Proveedores"
            value={String(kpis.supplier_count)}
            icon={<Truck className="h-4 w-4 text-primary" />}
          />
          <KpiCard
            label="Productos monitorizados"
            value={String(kpis.product_count)}
            icon={<BarChart2 className="h-4 w-4 text-blue-500" />}
          />
          <KpiCard
            label="Subidas detectadas"
            value={String(kpis.alerts_count)}
            icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
            highlight={kpis.alerts_count > 0}
          />
          <KpiCard
            label="Gasto total registrado"
            value={formatCurrency(kpis.total_spend, 'EUR')}
            icon={<Euro className="h-4 w-4 text-green-600" />}
          />
        </div>
      )}

      {suppliers.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Package className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600 font-medium">Aún no hay proveedores registrados</p>
            <p className="text-gray-400 text-sm mt-1">
              Cuando proceses facturas recibidas, TotalFactu identificará automáticamente tus proveedores.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Buscar proveedor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            <div className="flex rounded-md border divide-x overflow-hidden text-sm">
              {(['all', 'alerts', 'stable'] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 transition-colors ${
                    filter === f
                      ? 'bg-primary text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {f === 'all' ? 'Todos' : f === 'alerts' ? 'Con subidas' : 'Estables'}
                </button>
              ))}
            </div>
            <p className="text-sm text-gray-400 ml-auto">
              {filtered.length} proveedor{filtered.length !== 1 ? 'es' : ''}
            </p>
          </div>

          {/* Table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                Lista de proveedores
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-gray-50">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Proveedor</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Facturas</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Gasto total</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Productos</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">Subidas</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Última actividad</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Var. máx.</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{s.name}</p>
                          {s.tax_id && (
                            <p className="text-xs text-gray-400">{s.tax_id}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">{s.invoice_count}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">
                          {formatCurrency(s.total_spend, 'EUR')}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">{s.product_count}</td>
                        <td className="px-4 py-3 text-right">
                          {s.alerts_count > 0 ? (
                            <Badge className="bg-red-100 text-red-700 border-red-200 gap-1 text-xs">
                              <AlertTriangle className="h-3 w-3" />
                              {s.alerts_count}
                            </Badge>
                          ) : (
                            <span className="text-gray-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {s.last_activity
                            ? new Date(s.last_activity).toLocaleDateString('es-ES')
                            : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <VariationBadge variation={s.max_variation} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => router.push(`/dashboard/suppliers/${s.id}`)}
                          >
                            Ver detalle <ArrowRight className="ml-1 h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filtered.length === 0 && (
                  <p className="text-center text-gray-400 py-10">
                    {search ? `Sin resultados para "${search}"` : 'No hay proveedores en esta categoría.'}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function KpiCard({
  label, value, icon, highlight = false,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-red-200 bg-red-50' : ''}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-gray-500">{label}</p>
          {icon}
        </div>
        <p className={`text-2xl font-bold ${highlight ? 'text-red-700' : 'text-gray-900'}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function VariationBadge({ variation }: { variation: number | null }) {
  if (variation === null) return <span className="text-gray-400 text-xs">—</span>;
  if (variation > 5) {
    return (
      <Badge className="bg-red-100 text-red-700 border-red-200 gap-1 text-xs">
        <TrendingUp className="h-3 w-3" />
        +{variation.toFixed(1)}%
      </Badge>
    );
  }
  if (variation < -5) {
    return (
      <Badge className="bg-green-100 text-green-700 border-green-200 gap-1 text-xs">
        <TrendingDown className="h-3 w-3" />
        {variation.toFixed(1)}%
      </Badge>
    );
  }
  return (
    <span className="text-gray-500 text-xs">
      {variation > 0 ? '+' : ''}{variation.toFixed(1)}%
    </span>
  );
}
