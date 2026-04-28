'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, Mail, Send, CheckCircle, Bot, ExternalLink, Loader2, Brain, RefreshCw, Unlink, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from '@/lib/i18n/context';

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'totalfactu_helper_bot';

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { t } = useTranslation();

  const [formData, setFormData] = useState({
    name: '',
    tax_id: '',
    address: '',
    export_email: '',
    email_forwarding_address: '',
    ai_provider: 'external',
    ai_api_key: '',
    ai_api_endpoint: '',
  });

  // Telegram link state
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramUsername, setTelegramUsername] = useState<string | null>(null);
  const [telegramFirstName, setTelegramFirstName] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<Date | null>(null);
  const [generatingCode, setGeneratingCode] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      const [settingsRes, statusRes] = await Promise.all([
        fetch('/api/company/settings'),
        fetch('/api/telegram/status'),
      ]);
      const data = await settingsRes.json();
      const statusData = await statusRes.json();

      setFormData({
        name: data?.company?.name ?? '',
        tax_id: data?.company?.tax_id ?? '',
        address: data?.company?.address ?? '',
        export_email: data?.company?.export_email ?? '',
        email_forwarding_address: data?.company?.email_forwarding_address ?? '',
        ai_provider: data?.company?.ai_provider ?? 'external',
        ai_api_key: data?.company?.ai_api_key ?? '',
        ai_api_endpoint: data?.company?.ai_api_endpoint ?? '',
      });

      setTelegramLinked(statusData?.linked ?? false);
      setTelegramUsername(statusData?.username ?? null);
      setTelegramFirstName(statusData?.firstName ?? null);
    } catch {
      toast.error(t.settings.fetchFailed);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const response = await fetch('/api/company/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!response.ok) throw new Error();
      toast.success(t.settings.saveSuccess);
      fetchSettings();
    } catch {
      toast.error(t.settings.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateCode = async () => {
    setGeneratingCode(true);
    setLinkCode(null);
    try {
      const res = await fetch('/api/telegram/generate-code', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setLinkCode(data.code);
      setCodeExpiresAt(new Date(data.expiresAt));
      toast.success(t.settings.telegramCodeGenerated);
    } catch {
      toast.error(t.settings.telegramCodeFailed);
    } finally {
      setGeneratingCode(false);
    }
  };

  const handleUnlink = async () => {
    setUnlinking(true);
    try {
      const res = await fetch('/api/telegram/unlink', { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setTelegramLinked(false);
      setTelegramUsername(null);
      setTelegramFirstName(null);
      setLinkCode(null);
      toast.success(t.settings.telegramUnlinked);
    } catch {
      toast.error(t.settings.telegramUnlinkFailed);
    } finally {
      setUnlinking(false);
    }
  };

  const handleCopyCode = () => {
    if (linkCode) {
      navigator.clipboard.writeText(`/start ${linkCode}`);
      toast.success('Comando copiado');
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <p className="text-center text-gray-500 py-8">{t.common.loading}</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{t.settings.title}</h1>
        <p className="text-gray-600 mt-1">{t.settings.subtitle}</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Company Profile */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Building2 className="h-5 w-5 mr-2" />
              {t.settings.companyProfile}
            </CardTitle>
            <CardDescription>{t.settings.companyInfo}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t.settings.companyNameLabel}</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e: any) => setFormData({ ...formData, name: e?.target?.value ?? '' })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tax_id">{t.settings.taxIdLabel}</Label>
              <Input
                id="tax_id"
                value={formData.tax_id}
                onChange={(e: any) => setFormData({ ...formData, tax_id: e?.target?.value ?? '' })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">{t.settings.addressLabel}</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e: any) => setFormData({ ...formData, address: e?.target?.value ?? '' })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Telegram — Bot oficial único */}
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Bot className="h-5 w-5 mr-2 text-blue-600" />
              {t.settings.telegramTitle}
            </CardTitle>
            <CardDescription>{t.settings.telegramSubtitle}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Bot oficial */}
            <div className="bg-white rounded-lg p-4 border flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-700">{t.settings.telegramOfficialBot}</p>
                <p className="text-base font-bold text-blue-700 mt-0.5">@{BOT_USERNAME}</p>
              </div>
              <a
                href={`https://t.me/${BOT_USERNAME}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button type="button" variant="outline" size="sm">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {t.settings.telegramOpenBot}
                </Button>
              </a>
            </div>

            {/* Estado de vinculación */}
            {telegramLinked ? (
              <div className="bg-white rounded-lg p-4 border border-green-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <div>
                      <p className="font-medium text-green-700">{t.settings.telegramLinked}</p>
                      {(telegramUsername || telegramFirstName) && (
                        <p className="text-sm text-gray-500">
                          {t.settings.telegramLinkedAs}{' '}
                          <span className="font-medium">
                            {telegramUsername ? `@${telegramUsername}` : telegramFirstName}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleUnlink}
                    disabled={unlinking}
                    className="text-red-600 border-red-200 hover:bg-red-50"
                  >
                    {unlinking ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Unlink className="h-4 w-4 mr-2" />
                    )}
                    {t.settings.telegramUnlink}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-lg p-4 border border-amber-200 space-y-3">
                <p className="text-sm font-medium text-amber-800">{t.settings.telegramNotLinked}</p>

                {/* Código de vinculación */}
                {linkCode ? (
                  <div className="space-y-2">
                    <p className="text-sm text-gray-600">{t.settings.telegramCodeInstruction}</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-gray-100 px-3 py-2 rounded border text-sm font-mono font-bold tracking-widest">
                        /start {linkCode}
                      </code>
                      <Button type="button" variant="outline" size="sm" onClick={handleCopyCode}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    {codeExpiresAt && (
                      <p className="text-xs text-gray-400">
                        {t.settings.telegramCodeExpires}{' '}
                        {codeExpiresAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">{t.settings.telegramLinkInstruction}</p>
                )}

                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={handleGenerateCode}
                  disabled={generatingCode}
                >
                  {generatingCode ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t.settings.telegramGeneratingCode}</>
                  ) : (
                    <><RefreshCw className="h-4 w-4 mr-2" />{t.settings.telegramGenerateCode}</>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Provider Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Brain className="h-5 w-5 mr-2" />
              {t.settings.aiProviderTitle}
            </CardTitle>
            <CardDescription>{t.settings.aiProviderSubtitle}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai_provider">{t.settings.aiProviderLabel}</Label>
              <select
                id="ai_provider"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={formData.ai_provider}
                onChange={(e: any) => setFormData({ ...formData, ai_provider: e?.target?.value ?? 'external' })}
              >
                <option value="local">Local (Ollama)</option>
                <option value="external">{t.settings.aiProviderExternal}</option>
              </select>
              <p className="text-xs text-gray-500">{t.settings.aiProviderHelp}</p>
            </div>

            {formData.ai_provider === 'external' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="ai_api_endpoint">{t.settings.aiApiEndpointLabel}</Label>
                  <Input
                    id="ai_api_endpoint"
                    value={formData.ai_api_endpoint}
                    onChange={(e: any) => setFormData({ ...formData, ai_api_endpoint: e?.target?.value ?? '' })}
                    placeholder={t.settings.aiApiEndpointPlaceholder}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai_api_key">{t.settings.aiApiKeyLabel}</Label>
                  <Input
                    id="ai_api_key"
                    type="password"
                    value={formData.ai_api_key}
                    onChange={(e: any) => setFormData({ ...formData, ai_api_key: e?.target?.value ?? '' })}
                    placeholder={t.settings.aiApiKeyPlaceholder}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Export Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Mail className="h-5 w-5 mr-2" />
              {t.settings.exportEmailSettings}
            </CardTitle>
            <CardDescription>{t.settings.exportEmailDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="export_email">{t.settings.exportRecipientEmail}</Label>
              <Input
                id="export_email"
                type="email"
                value={formData.export_email}
                onChange={(e: any) => setFormData({ ...formData, export_email: e?.target?.value ?? '' })}
                required
              />
              <p className="text-xs text-gray-500">{t.settings.exportEmailHelp}</p>
            </div>
          </CardContent>
        </Card>

        {/* Other Integrations */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Send className="h-5 w-5 mr-2" />
              {t.settings.integrationSettings}
            </CardTitle>
            <CardDescription>{t.settings.connectServices}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email_forwarding_address">{t.settings.emailForwarding}</Label>
              <Input
                id="email_forwarding_address"
                type="email"
                value={formData.email_forwarding_address}
                onChange={(e: any) =>
                  setFormData({ ...formData, email_forwarding_address: e?.target?.value ?? '' })
                }
                placeholder={t.settings.emailForwardingPlaceholder}
              />
              <div className="bg-gray-50 p-4 rounded-md mt-2">
                <p className="text-sm text-gray-600 mb-2">
                  <strong>{t.settings.webhookUrl}</strong>
                </p>
                <code className="text-xs bg-white px-2 py-1 rounded border">
                  {typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/email
                </code>
                <p className="text-xs text-gray-500 mt-2">{t.settings.forwardInvoicesHelp}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? t.common.saving : t.settings.saveSettings}
          </Button>
        </div>
      </form>
    </div>
  );
}
