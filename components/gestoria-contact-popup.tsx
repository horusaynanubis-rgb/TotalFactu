'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { CheckCircle, Users, Loader2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/context';
import toast from 'react-hot-toast';

const PACKS = [
  {
    size: 10,
    labelKey: 'gestoriaPackBasic' as const,
    price: 89,
    features: ['10 licencias de cliente', 'Portal de gestión incluido', 'Invitaciones por enlace', 'Soporte prioritario'],
    featuresEn: ['10 client licenses', 'Management portal included', 'Link-based invitations', 'Priority support'],
  },
  {
    size: 30,
    labelKey: 'gestoriaPackPro' as const,
    price: 229,
    popular: true,
    features: ['30 licencias de cliente', 'Portal de gestión incluido', 'Invitaciones por enlace', 'Soporte prioritario', 'Ahorro vs. Pack Básico'],
    featuresEn: ['30 client licenses', 'Management portal included', 'Link-based invitations', 'Priority support', 'Savings vs. Basic Pack'],
  },
  {
    size: 50,
    labelKey: 'gestoriaPackBusiness' as const,
    price: 349,
    features: ['50 licencias de cliente', 'Portal de gestión incluido', 'Invitaciones por enlace', 'Gestor de cuenta dedicado', 'Mayor ahorro por licencia'],
    featuresEn: ['50 client licenses', 'Management portal included', 'Link-based invitations', 'Dedicated account manager', 'Best per-license savings'],
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function GestoriaContactPopup({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [selectedPack, setSelectedPack] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [contact, setContact] = useState({ name: '', email: '', company: '', message: '' });

  const handlePay = async (packSize: number) => {
    if (!contact.name || !contact.email || !contact.company) {
      toast.error('Por favor rellena tu nombre, email y empresa antes de continuar.');
      return;
    }
    setLoading(true);
    setSelectedPack(packSize);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'gestoria_pack',
          pack_size: packSize,
          contact,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        toast.error(data.error || 'Error al iniciar el pago. Prueba de nuevo o contacta con nosotros.');
        return;
      }
      window.location.href = data.url;
    } catch {
      toast.error('Error inesperado. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
      setSelectedPack(null);
    }
  };

  const isEs = typeof window !== 'undefined' && (localStorage.getItem('locale') || 'es') === 'es';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">{t.landing.gestoriaPopupTitle}</DialogTitle>
          <DialogDescription className="text-base mt-1">
            {t.landing.gestoriaPopupSubtitle}
          </DialogDescription>
        </DialogHeader>

        {/* Contact fields */}
        <div className="grid sm:grid-cols-3 gap-4 mt-2">
          <div className="space-y-1">
            <Label>{t.landing.gestoriaContactName}</Label>
            <Input
              placeholder="Ana García"
              value={contact.name}
              onChange={(e) => setContact({ ...contact, name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>{t.landing.gestoriaContactEmail}</Label>
            <Input
              type="email"
              placeholder="ana@gestoría.es"
              value={contact.email}
              onChange={(e) => setContact({ ...contact, email: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>{t.landing.gestoriaContactCompany}</Label>
            <Input
              placeholder="Gestoría García S.L."
              value={contact.company}
              onChange={(e) => setContact({ ...contact, company: e.target.value })}
            />
          </div>
        </div>

        {/* Pack cards */}
        <div className="grid sm:grid-cols-3 gap-5 mt-4">
          {PACKS.map((pack) => (
            <Card
              key={pack.size}
              className={`relative border-2 transition-all ${pack.popular ? 'border-primary' : 'border-border'}`}
            >
              {pack.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-primary text-white text-xs font-semibold px-3 py-1 rounded-full">
                    {t.landing.mostPopular}
                  </span>
                </div>
              )}
              <CardHeader className="text-center pb-2">
                <CardTitle className="text-lg">{t.landing[pack.labelKey]}</CardTitle>
                <CardDescription className="text-xs">{pack.size} {t.landing.gestoriaPackLicenses}</CardDescription>
                <div className="mt-2">
                  <span className="text-3xl font-bold">€{pack.price}</span>
                  <span className="text-gray-500 text-xs">/mes</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {(pack.price / pack.size).toFixed(0)}€ {t.landing.gestoriaPackPerLicense}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-1.5">
                  {(isEs ? pack.features : pack.featuresEn).map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                      <CheckCircle className="h-3.5 w-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  variant={pack.popular ? 'default' : 'outline'}
                  disabled={loading}
                  onClick={() => handlePay(pack.size)}
                >
                  {loading && selectedPack === pack.size ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Redirigiendo...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Users className="h-4 w-4" /> {t.landing.gestoriaPackPayNow}
                    </span>
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Optional message */}
        <div className="mt-2 space-y-1">
          <Label className="text-sm text-muted-foreground">{t.landing.gestoriaContactQuestion}</Label>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[72px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder={t.landing.gestoriaContactPlaceholder}
            value={contact.message}
            onChange={(e) => setContact({ ...contact, message: e.target.value })}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
