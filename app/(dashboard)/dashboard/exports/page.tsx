'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, FileText, Mail, CheckCircle } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';
import { useTranslation } from '@/lib/i18n/context';

export default function ExportsPage() {
  const [exports, setExports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const { t } = useTranslation();

  const fetchExports = async () => {
    try {
      const response = await fetch('/api/exports');
      const data = await response.json();
      setExports(data?.exports ?? []);
    } catch (error: any) {
      toast.error(t.exports.fetchFailed);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExports();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = async (exportType: 'monthly' | 'quarterly') => {
    setGenerating(true);
    try {
      const response = await fetch('/api/exports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exportType }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.message || t.exports.generateFailed);
      }

      toast.success(t.exports.generateSuccess);
      fetchExports();
    } catch (error: any) {
      toast.error(error?.message || t.exports.generateFailed);
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async (exportId: string) => {
    try {
      const response = await fetch(`/api/exports/${exportId}/download`);
      const { downloadUrl } = await response.json();
      
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.click();
      
      toast.success(t.exports.downloadStarted);
    } catch (error: any) {
      toast.error(t.exports.downloadFailed);
    }
  };

  const typeLabels: Record<string, string> = {
    monthly: t.exports.monthlyExport,
    quarterly: t.exports.quarterlyExport,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{t.exports.title}</h1>
        <p className="text-gray-600 mt-1">{t.exports.subtitle}</p>
      </div>

      {/* Generate Section */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <FileText className="h-5 w-5 mr-2" />
              {t.exports.monthlyExport}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-4">
              {t.exports.monthlyDescription}
            </p>
            <Button
              onClick={() => handleGenerate('monthly')}
              disabled={generating}
              className="w-full"
            >
              <Download className="mr-2 h-4 w-4" />
              {t.exports.generateMonthlyCSV}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <FileText className="h-5 w-5 mr-2" />
              {t.exports.quarterlyExport}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-4">
              {t.exports.quarterlyDescription}
            </p>
            <Button
              onClick={() => handleGenerate('quarterly')}
              disabled={generating}
              className="w-full"
            >
              <Download className="mr-2 h-4 w-4" />
              {t.exports.generateQuarterlyCSV}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Export History */}
      <Card>
        <CardHeader>
          <CardTitle>{t.exports.exportHistory}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-gray-500 py-8">{t.common.loading}</p>
          ) : exports && exports.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.exports.exportDate}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.common.type}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.exports.period}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.exports.records}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.exports.emailStatus}</th>
                    <th className="text-left py-3 px-4 font-medium text-gray-700">{t.common.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {exports.map((exp: any) => (
                    <tr key={exp?.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm">{formatDate(exp?.created_at)}</td>
                      <td className="py-3 px-4">
                        <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800">
                          {typeLabels[exp?.export_type] || exp?.export_type}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {formatDate(exp?.period_start)} - {formatDate(exp?.period_end)}
                      </td>
                      <td className="py-3 px-4 text-sm">{exp?.record_count}</td>
                      <td className="py-3 px-4">
                        {exp?.email_sent ? (
                          <CheckCircle className="h-5 w-5 text-green-500" />
                        ) : (
                          <Mail className="h-5 w-5 text-gray-400" />
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDownload(exp?.id)}
                        >
                          <Download className="mr-1 h-4 w-4" />
                          {t.common.download}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center text-gray-500 py-8">{t.exports.noExports}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
