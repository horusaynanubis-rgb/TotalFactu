'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, Mail, Send, CheckCircle, AlertCircle, Bot, Zap, ExternalLink, Loader2, Wifi, WifiOff, Brain } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from '@/lib/i18n/context';

export default function SettingsPage() {
  const [company, setCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [settingWebhook, setSettingWebhook] = useState(false);
  const [telegramBot, setTelegramBot] = useState<any>(null);
  const [webhookInfo, setWebhookInfo] = useState<any>(null);
  const { t } = useTranslation();

  const [formData, setFormData] = useState({
    name: '',
    tax_id: '',
    address: '',
    export_email: '',
    email_forwarding_address: '',
    telegram_bot_token: '',
    ai_provider: 'external',
    ai_api_key: '',
    ai_api_endpoint: '',
  });

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/company/settings');
      const data = await response.json();
      setCompany(data?.company);
      setFormData({
        name: data?.company?.name ?? '',
        tax_id: data?.company?.tax_id ?? '',
        address: data?.company?.address ?? '',
        export_email: data?.company?.export_email ?? '',
        email_forwarding_address: data?.company?.email_forwarding_address ?? '',
        telegram_bot_token: data?.company?.telegram_bot_token ?? '',
        ai_provider: data?.company?.ai_provider ?? 'external',
        ai_api_key: data?.company?.ai_api_key ?? '',
        ai_api_endpoint: data?.company?.ai_api_endpoint ?? '',
      });
    } catch (error: any) {
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

      if (!response.ok) {
        throw new Error(t.settings.saveFailed);
      }

      toast.success(t.settings.saveSuccess);
      fetchSettings();
    } catch (error: any) {
      toast.error(t.settings.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const handleTestTelegram = async () => {
    setTestingTelegram(true);
    setTelegramBot(null);

    try {
      // First save the token
      await fetch('/api/company/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegram_bot_token: formData.telegram_bot_token }),
      });

      const response = await fetch('/api/telegram/test', { method: 'POST' });
      const data = await response.json();

      if (data.connected) {
        setTelegramBot(data.bot);
        setWebhookInfo(data.webhook);
        toast.success(`${t.settings.connectionSuccess} @${data.bot.username}`);
      } else {
        toast.error(`${t.settings.connectionFailed}: ${data.message}`);
      }
    } catch (error: any) {
      toast.error(t.settings.connectionFailed);
    } finally {
      setTestingTelegram(false);
    }
  };

  const handleSetWebhook = async () => {
    setSettingWebhook(true);
    try {
      const webhookUrl = `${window.location.origin}/api/webhooks/telegram`;
      const response = await fetch('/api/telegram/set-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl }),
      });
      const data = await response.json();

      if (data.ok) {
        toast.success(t.settings.webhookSetSuccess);
        // Refresh webhook info
        handleTestTelegram();
      } else {
        toast.error(`${t.settings.webhookSetFailed}: ${data.description}`);
      }
    } catch (error: any) {
      toast.error(t.settings.webhookSetFailed);
    } finally {
      setSettingWebhook(false);
    }
  };

  const handleRemoveWebhook = async () => {
    try {
      const response = await fetch('/api/telegram/set-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete' }),
      });
      const data = await response.json();

      if (data.ok) {
        toast.success(t.settings.webhookRemoved);
        setWebhookInfo(null);
      }
    } catch (error: any) {
      toast.error(t.settings.webhookSetFailed);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <p className="text-center text-gray-500 py-8">{t.common.loading}</p>
      </div>
    );
  }

  const hasWebhook = webhookInfo?.url && webhookInfo.url.length > 0;

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

        {/* Telegram Bot - Primary Channel */}
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Bot className="h-5 w-5 mr-2 text-blue-600" />
              {t.settings.telegramTitle}
            </CardTitle>
            <CardDescription>{t.settings.telegramSubtitle}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Bot Token */}
            <div className="space-y-2">
              <Label htmlFor="telegram_bot_token">{t.settings.botTokenLabel}</Label>
              <Input
                id="telegram_bot_token"
                type="password"
                value={formData.telegram_bot_token}
                onChange={(e: any) => setFormData({ ...formData, telegram_bot_token: e?.target?.value ?? '' })}
                placeholder={t.settings.botTokenPlaceholder}
              />
              <p className="text-xs text-gray-500">{t.settings.botTokenHelp}</p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleTestTelegram}
                disabled={!formData.telegram_bot_token || testingTelegram}
              >
                {testingTelegram ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t.settings.testing}</>
                ) : (
                  <><Wifi className="h-4 w-4 mr-2" />{t.settings.testConnection}</>
                )}
              </Button>

              <Button
                type="button"
                variant="default"
                onClick={handleSetWebhook}
                disabled={!formData.telegram_bot_token || settingWebhook || !telegramBot}
              >
                {settingWebhook ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t.settings.settingWebhook}</>
                ) : (
                  <><Zap className="h-4 w-4 mr-2" />{t.settings.setWebhook}</>
                )}
              </Button>

              {hasWebhook && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleRemoveWebhook}
                  size="sm"
                >
                  <WifiOff className="h-4 w-4 mr-2" />
                  {t.settings.removeWebhook}
                </Button>
              )}
            </div>

            {/* Connection Status */}
            {telegramBot && (
              <div className="bg-white rounded-lg p-4 border border-green-200">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                  <span className="font-medium text-green-700">@{telegramBot.username}</span>
                  <span className="text-sm text-gray-500">({telegramBot.first_name})</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {hasWebhook ? (
                    <><CheckCircle className="h-3 w-3 text-green-500" /><span className="text-green-600">{t.settings.webhookActive}</span></>
                  ) : (
                    <><AlertCircle className="h-3 w-3 text-amber-500" /><span className="text-amber-600">{t.settings.webhookNotSet}</span></>
                  )}
                </div>
              </div>
            )}

            {!telegramBot && !formData.telegram_bot_token && (
              <div className="bg-white rounded-lg p-4 border">
                <p className="text-sm font-medium text-gray-700 mb-2">{t.settings.telegramSetupSteps}</p>
                <div className="space-y-1 text-sm text-gray-600">
                  <p>{t.settings.telegramStep1}</p>
                  <p>{t.settings.telegramStep2}</p>
                  <p>{t.settings.telegramStep3}</p>
                  <p>{t.settings.telegramStep4}</p>
                  <p>{t.settings.telegramStep5}</p>
                </div>
              </div>
            )}

            {/* Webhook URL Info */}
            {formData.telegram_bot_token && (
              <div className="bg-white rounded-lg p-3 border">
                <p className="text-xs text-gray-500 mb-1">{t.settings.webhookUrl}</p>
                <code className="text-xs bg-gray-100 px-2 py-1 rounded border block overflow-x-auto">
                  {typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/telegram
                </code>
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
