'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Truck, ArrowLeft, TrendingUp, TrendingDown, Package,
  FileText, Search,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Product {
  normalized_description: string;
  last_description: string;
  first_date: string | null;
  last_date: string | null;
  first_price: number | null;
  last_price: number | null;
  variation_pct: number | null;
  is_price_increase: boolean;
  total_quantity: number;
  appearances: number;
}

interface Invoice {
  id: string;
  invoice_number: string;
  issue_date: string;
  total_amount: number;
  currency: string;
  review_status: string;
}

interface SupplierDetail {
  supplier: { id: string; name: string; tax_id: string | null; created_at: string };
  invoice_count: number;
  total_spend: number;
  invoices: Invoice[];
  products: Product[];
}

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<SupplierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [productSearch, setProductSearch] = useState('');

  useEffect(() => {
    fetch(`/api/suppliers/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error('not found');
        return r.json();
      })
      .then(setData)
      .catch(() => {
        toast.error('No se pudo cargar el proveedor');
        router.push('/dashboard/suppliers');
      })
      .finally(() => setLoading(false));
  }, [id, router]);

  const filteredProducts = useMemo(() => {
    if (!data) return [];
    const q = productSearch.toLowerCase();
    if (!q) return data.products;
    return data.products.filter(
      (p) =>
        p.last_description.toLowerCase().includes(q) ||
        p.normalized_description.includes(q),
    );
  }, [data, productSearch]);

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <p className="text-center text-gray-500 py-12">Cargando...</p>
      </div>
    );
  }

  if (!data) return null;

  const { supplier, invoice_count, total_spend, invoices, products } = data;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Back + header */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-3 text-gray-500 -ml-2"
          onClick={() => router.push('/dashboard/suppliers')}
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Proveedores
        </Button>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Truck className="h-6 w-6 text-primary" />
              {supplier.name}
            </h1>
            {supplier.tax_id && (
              <Badge variant="outline" className="mt-1 text-xs">
                NIF/CIF: {supplier.tax_id}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard label="Facturas recibidas" value={String(invoice_count)} />
        <StatCard label="Gasto total" value={formatCurrency(total_spend, 'EUR')} />
        <StatCard label="Productos detectados" value={String(products.length)} />
      </div>

      {/* Products / Price history */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base">Productos y servicios detectados</CardTitle>
            {products.length > 0 && (
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Buscar producto..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="pl-9 h-8 text-sm"
                />
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {products.length === 0 ? (
            <div className="py-12 text-center px-4">
              <Package className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">
                Cuando subas más facturas de este proveedor, TotalFactu podrá detectar variaciones de precio.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Descripción</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Apariciones</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Precio inicial</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Precio actual</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Variación</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Primera compra</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Última compra</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Uds. totales</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredProducts.map((p) => (
                    <tr key={p.normalized_description} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{p.last_description}</p>
                        {p.last_description.toLowerCase().trim() !== p.normalized_description && (
                          <p className="text-xs text-gray-400">{p.normalized_description}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{p.appearances}</td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {p.first_price !== null ? `${p.first_price.toFixed(2)} €` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">
                        {p.last_price !== null ? `${p.last_price.toFixed(2)} €` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <ProductVariationBadge variation={p.variation_pct} isIncrease={p.is_price_increase} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {p.first_date ? new Date(p.first_date).toLocaleDateString('es-ES') : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {p.last_date ? new Date(p.last_date).toLocaleDateString('es-ES') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        {p.total_quantity > 0 ? p.total_quantity.toFixed(2) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredProducts.length === 0 && (
                <p className="text-center text-gray-400 py-8">Sin resultados para "{productSearch}"</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invoices */}
      {invoices.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-gray-500" />
              Facturas recibidas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Nº Factura</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Total</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{inv.invoice_number}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {new Date(inv.issue_date).toLocaleDateString('es-ES')}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatCurrency(inv.total_amount, inv.currency || 'EUR')}
                      </td>
                      <td className="px-4 py-3">
                        <ReviewBadge status={inv.review_status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-gray-500 mb-1">{label}</p>
        <p className="text-xl font-bold text-gray-900">{value}</p>
      </CardContent>
    </Card>
  );
}

function ProductVariationBadge({ variation, isIncrease }: { variation: number | null; isIncrease: boolean }) {
  if (variation === null) return <span className="text-gray-400 text-xs">—</span>;
  if (isIncrease) {
    return (
      <Badge className="bg-red-100 text-red-700 border-red-200 gap-1 text-xs">
        <TrendingUp className="h-3 w-3" />
        Subida +{variation.toFixed(1)}%
      </Badge>
    );
  }
  if (variation < -5) {
    return (
      <Badge className="bg-green-100 text-green-700 border-green-200 gap-1 text-xs">
        <TrendingDown className="h-3 w-3" />
        Bajada {variation.toFixed(1)}%
      </Badge>
    );
  }
  return (
    <span className="text-gray-500 text-xs">
      {variation > 0 ? '+' : ''}{variation.toFixed(1)}%
    </span>
  );
}

function ReviewBadge({ status }: { status: string }) {
  if (status === 'approved') return <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">Aprobada</Badge>;
  if (status === 'rejected') return <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Rechazada</Badge>;
  return <Badge variant="outline" className="text-xs">Pendiente</Badge>;
}
