'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Truck, ArrowLeft, TrendingUp, TrendingDown, Package,
  FileText, Search, AlertTriangle, ShieldCheck,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import toast from 'react-hot-toast';

type AlertLevel = 'none' | 'minor' | 'major';
type ProductFilter = 'all' | 'alerts' | 'stable';

interface Product {
  normalized_description: string;
  last_description: string;
  appearances: number;
  first_date: string | null;
  last_date: string | null;
  first_price: number | null;
  prev_price: number | null;
  last_price: number | null;
  variation_vs_prev: number | null;
  variation_vs_initial: number | null;
  alert_level: AlertLevel;
  total_quantity: number;
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
  const [productFilter, setProductFilter] = useState<ProductFilter>('all');

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
    let list = data.products;

    // Text search
    const q = productSearch.toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.last_description.toLowerCase().includes(q) ||
          p.normalized_description.includes(q),
      );
    }

    // Status filter
    if (productFilter === 'alerts') list = list.filter((p) => p.alert_level !== 'none');
    if (productFilter === 'stable') list = list.filter((p) => p.alert_level === 'none');

    return list;
  }, [data, productSearch, productFilter]);

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <p className="text-center text-gray-500 py-12">Cargando...</p>
      </div>
    );
  }

  if (!data) return null;

  const { supplier, invoice_count, total_spend, invoices, products } = data;
  const alerts = products.filter((p) => p.alert_level === 'major');
  const alertsMinor = products.filter((p) => p.alert_level === 'minor');
  const monitored = products.filter((p) => p.appearances >= 2);

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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Facturas recibidas" value={String(invoice_count)} />
        <StatCard label="Gasto total" value={formatCurrency(total_spend, 'EUR')} />
        <StatCard label="Productos detectados" value={String(products.length)} />
        <StatCard
          label="Subidas relevantes"
          value={String(alerts.length)}
          highlight={alerts.length > 0}
        />
      </div>

      {/* Alerts section */}
      {(alerts.length > 0 || alertsMinor.length > 0) && (
        <Card className={alerts.length > 0 ? 'border-red-200 bg-red-50' : 'border-yellow-200 bg-yellow-50'}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-sm flex items-center gap-2 ${alerts.length > 0 ? 'text-red-800' : 'text-yellow-800'}`}>
              <AlertTriangle className="h-4 w-4" />
              Alertas de precio
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.map((p) => (
              <AlertItem key={p.normalized_description} product={p} level="major" />
            ))}
            {alertsMinor.map((p) => (
              <AlertItem key={p.normalized_description} product={p} level="minor" />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Products table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Productos y servicios</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Filter tabs */}
              <div className="flex rounded-md border divide-x overflow-hidden text-xs">
                {(['all', 'alerts', 'stable'] as ProductFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setProductFilter(f)}
                    className={`px-3 py-1.5 transition-colors ${
                      productFilter === f
                        ? 'bg-primary text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {f === 'all' ? 'Todos' : f === 'alerts' ? 'Con subidas' : 'Estables'}
                  </button>
                ))}
              </div>
              {/* Search */}
              <div className="relative w-48">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <Input
                  placeholder="Buscar producto..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>
            </div>
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
                    <th className="text-left px-4 py-3 font-medium text-gray-600 min-w-[180px]">Producto</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Compras</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">P. inicial</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">P. anterior</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">P. actual</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Vs anterior</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Última compra</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredProducts.map((p) => (
                    <tr
                      key={p.normalized_description}
                      className={`hover:bg-gray-50 ${p.alert_level === 'major' ? 'bg-red-50/40' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 leading-snug">{p.last_description}</p>
                        {p.last_description.toLowerCase().trim() !== p.normalized_description && (
                          <p className="text-xs text-gray-400 mt-0.5">{p.normalized_description}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{p.appearances}</td>
                      <td className="px-4 py-3 text-right text-gray-500 text-xs">
                        {p.first_price !== null ? `${p.first_price.toFixed(2)} €` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 text-xs">
                        {p.prev_price !== null ? `${p.prev_price.toFixed(2)} €` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-900">
                        {p.last_price !== null ? `${p.last_price.toFixed(2)} €` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <VsPrevBadge variation={p.variation_vs_prev} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {p.last_date ? new Date(p.last_date).toLocaleDateString('es-ES') : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge level={p.alert_level} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredProducts.length === 0 && (
                <p className="text-center text-gray-400 py-8">
                  {productSearch
                    ? `Sin resultados para "${productSearch}"`
                    : 'No hay productos en esta categoría.'}
                </p>
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label, value, highlight = false,
}: {
  label: string; value: string; highlight?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-red-200 bg-red-50' : ''}>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-gray-500 mb-1">{label}</p>
        <p className={`text-xl font-bold ${highlight ? 'text-red-700' : 'text-gray-900'}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function AlertItem({ product, level }: { product: Product; level: 'major' | 'minor' }) {
  const isMajor = level === 'major';
  const varPrev  = product.variation_vs_prev;
  const varInit  = product.variation_vs_initial;

  const mainVar = varPrev !== null ? varPrev : varInit;
  const isVsPrev = varPrev !== null;

  return (
    <div className={`flex items-start gap-2 text-sm ${isMajor ? 'text-red-800' : 'text-yellow-800'}`}>
      <AlertTriangle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${isMajor ? 'text-red-500' : 'text-yellow-500'}`} />
      <p>
        <span className="font-medium">{product.last_description}</span>
        {mainVar !== null && (
          <>
            {' '}ha subido{' '}
            <span className="font-semibold">+{mainVar.toFixed(1)}%</span>
            {isVsPrev ? ' respecto a la compra anterior' : ' respecto al precio inicial'}
            {product.last_price !== null && (
              <> (precio actual: <span className="font-semibold">{product.last_price.toFixed(2)} €</span>)</>
            )}
            .
          </>
        )}
      </p>
    </div>
  );
}

function VsPrevBadge({ variation }: { variation: number | null }) {
  if (variation === null) return <span className="text-gray-400 text-xs">—</span>;
  if (variation > 5) {
    return (
      <span className="inline-flex items-center gap-1 text-red-600 font-medium text-xs">
        <TrendingUp className="h-3 w-3" />+{variation.toFixed(1)}%
      </span>
    );
  }
  if (variation < -5) {
    return (
      <span className="inline-flex items-center gap-1 text-green-600 font-medium text-xs">
        <TrendingDown className="h-3 w-3" />{variation.toFixed(1)}%
      </span>
    );
  }
  if (variation > 0) {
    return <span className="text-orange-500 text-xs">+{variation.toFixed(1)}%</span>;
  }
  return <span className="text-gray-500 text-xs">{variation.toFixed(1)}%</span>;
}

function StatusBadge({ level }: { level: AlertLevel }) {
  if (level === 'major') {
    return (
      <Badge className="bg-red-100 text-red-700 border-red-200 gap-1 text-xs whitespace-nowrap">
        <TrendingUp className="h-3 w-3" />
        Subida relevante
      </Badge>
    );
  }
  if (level === 'minor') {
    return (
      <Badge className="bg-orange-100 text-orange-700 border-orange-200 gap-1 text-xs whitespace-nowrap">
        <TrendingUp className="h-3 w-3" />
        Subida leve
      </Badge>
    );
  }
  return (
    <Badge className="bg-green-100 text-green-700 border-green-200 gap-1 text-xs">
      <ShieldCheck className="h-3 w-3" />
      Estable
    </Badge>
  );
}

function ReviewBadge({ status }: { status: string }) {
  if (status === 'approved') {
    return <Badge className="bg-green-100 text-green-700 border-green-200 text-xs">Aprobada</Badge>;
  }
  if (status === 'rejected') {
    return <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Rechazada</Badge>;
  }
  return <Badge variant="outline" className="text-xs">Pendiente</Badge>;
}
