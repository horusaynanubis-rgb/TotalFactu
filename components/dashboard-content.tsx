'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { FileText, AlertCircle, TrendingUp, Download, Upload, Calendar } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n/context';
import { DemoUpgradeBanner, DEMO_INVOICE_LIMIT } from '@/components/demo-upgrade-banner';

interface DashboardContentProps {
  company: any;
  stats: {
    totalInvoices: number;
    pendingReview: number;
    documentsThisMonth: number;
    totalVAT: number;
    exportsGenerated: number;
  };
  recentDocs: any[];
  subscription?: { plan_name: string };
}

export function DashboardContent({ company, stats, recentDocs, subscription }: DashboardContentProps) {
  const { t } = useTranslation();
  const isDemo = subscription?.plan_name === 'demo';

  const statusLabels: Record<string, string> = {
    processing: t.statusBadges.processing,
    completed: t.statusBadges.completed,
    needs_review: t.statusBadges.needsReview,
    failed: t.statusBadges.failed,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{t.dashboard.title}</h1>
        <p className="text-gray-600 mt-1">{t.dashboard.welcomeBack} {company?.name}.</p>
      </div>

      {/* Demo upgrade banner */}
      {isDemo && (
        <DemoUpgradeBanner
          invoiceCount={stats?.totalInvoices ?? 0}
          variant={stats?.totalInvoices >= DEMO_INVOICE_LIMIT ? 'blocked' : 'banner'}
        />
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">{t.dashboard.invoicesThisMonth}</CardTitle>
            <Calendar className="h-4 w-4 text-gray-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.documentsThisMonth ?? 0}</div>
            <p className="text-xs text-gray-500 mt-1">{t.dashboard.documentsUploaded}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">{t.dashboard.pendingReview}</CardTitle>
            <AlertCircle className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{stats?.pendingReview ?? 0}</div>
            <p className="text-xs text-gray-500 mt-1">{t.dashboard.needsAttention}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">{t.dashboard.totalVatMonth}</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats?.totalVAT ?? 0, 'EUR')}</div>
            <p className="text-xs text-gray-500 mt-1">{t.dashboard.taxDetected}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">{t.dashboard.exportsGenerated}</CardTitle>
            <Download className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.exportsGenerated ?? 0}</div>
            <p className="text-xs text-gray-500 mt-1">{t.dashboard.csvReports}</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>{t.dashboard.quickActions}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Link href="/dashboard/documents">
            <Button>
              <Upload className="mr-2 h-4 w-4" />
              {t.dashboard.uploadInvoice}
            </Button>
          </Link>
          <Link href="/dashboard/invoices?filter=pending">
            <Button variant="outline">
              <AlertCircle className="mr-2 h-4 w-4" />
              {t.dashboard.reviewPending} ({stats?.pendingReview ?? 0})
            </Button>
          </Link>
          <Link href="/dashboard/exports">
            <Button variant="outline">
              <Download className="mr-2 h-4 w-4" />
              {t.dashboard.generateExport}
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>{t.dashboard.recentUploads}</CardTitle>
        </CardHeader>
        <CardContent>
          {recentDocs && recentDocs.length > 0 ? (
            <div className="space-y-4">
              {recentDocs.map((doc: any) => (
                <div key={doc?.id} className="flex items-center justify-between py-3 border-b last:border-0">
                  <div className="flex items-center space-x-3">
                    <FileText className="h-5 w-5 text-gray-400" />
                    <div>
                      <p className="text-sm font-medium">{doc?.original_filename}</p>
                      <p className="text-xs text-gray-500">
                        {formatDate(doc?.upload_timestamp)} • {doc?.source_channel}
                      </p>
                    </div>
                  </div>
                  <div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      doc?.processing_status === 'completed' ? 'bg-green-100 text-green-800' :
                      doc?.processing_status === 'processing' ? 'bg-blue-100 text-blue-800' :
                      doc?.processing_status === 'needs_review' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {statusLabels[doc?.processing_status] || doc?.processing_status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">{t.dashboard.noRecentDocuments}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
