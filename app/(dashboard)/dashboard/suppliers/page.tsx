'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Truck, Search, TrendingUp, TrendingDown, ArrowRight, Package } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import toast from 'react-hot-toast';

interface SupplierRow {
  id: string;
  name: string;
  tax_id: string | null;
  invoice_count: number;
  total_spend: number;
  product_count: number;
  last_invoice_date: string | null;
  max_variation: number | null;
  created_at: string;
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetch('/api/suppliers')
      .then((r) => r.json())
      .then((d) => setSuppliers(d.suppliers ?? []))
      .catch(() => toast.error('Error al cargar proveedores'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.tax_id ?? '').toLowerCase().includes(q),
    );
  }, [suppliers, search]);

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <p className="text-center text-gray-500 py-12">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Truck className="h-8 w-8 text-primary" />
          Proveedores
        </h1>
        <p className="text-gray-500 mt-1">
          Histórico de compras y seguimiento de precios por proveedor
        </p>
      </div>

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
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Buscar proveedor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <p className="text-sm text-gray-500">{filtered.length} proveedor{filtered.length !== 1 ? 'es' : ''}</p>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-gray-700">Lista de proveedores</CardTitle>
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
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Última factura</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Variación máx.</th>
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
                        <td className="px-4 py-3 text-right text-gray-700">{s.invoice_count}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">
                          {formatCurrency(s.total_spend, 'EUR')}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">{s.product_count}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {s.last_invoice_date
                            ? new Date(s.last_invoice_date).toLocaleDateString('es-ES')
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
              </div>
              {filtered.length === 0 && (
                <p className="text-center text-gray-400 py-8">Sin resultados para "{search}"</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function VariationBadge({ variation }: { variation: number | null }) {
  if (variation === null) return <span className="text-gray-400 text-xs">—</span>;
  if (variation > 5) {
    return (
      <Badge className="bg-red-100 text-red-700 border-red-200 gap-1">
        <TrendingUp className="h-3 w-3" />
        +{variation.toFixed(1)}%
      </Badge>
    );
  }
  if (variation < -5) {
    return (
      <Badge className="bg-green-100 text-green-700 border-green-200 gap-1">
        <TrendingDown className="h-3 w-3" />
        {variation.toFixed(1)}%
      </Badge>
    );
  }
  return <span className="text-gray-500 text-xs">{variation > 0 ? '+' : ''}{variation.toFixed(1)}%</span>;
}
