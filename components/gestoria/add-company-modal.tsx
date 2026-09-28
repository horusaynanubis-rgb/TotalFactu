'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Copy, CheckCircle, Loader2, Mail } from 'lucide-react';
import toast from 'react-hot-toast';

// NEW MODEL equivalent of InviteClientModal — no license/seat involved, no
// "licencias disponibles" concept. The invited company brings its own
// Profesional subscription; this only creates the management relation once
// they accept. See app/api/gestoria/company-invitations/route.ts.

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddCompanyModal({ open, onClose, onSuccess }: Props) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [activationUrl, setActivationUrl] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) setEmail('');
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/gestoria/company-invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Error al crear la invitación');
        return;
      }
      setActivationUrl(data.activation_url);
      setEmailSent(Boolean(data.email_sent));
      onSuccess();
    } catch {
      toast.error('Error inesperado');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!activationUrl) return;
    await navigator.clipboard.writeText(activationUrl);
    setCopied(true);
    toast.success('Enlace copiado');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    setEmail('');
    setActivationUrl(null);
    setEmailSent(false);
    setCopied(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Añadir empresa</DialogTitle>
          <DialogDescription>
            Se generará un enlace de invitación único válido por 7 días. La empresa contrata su propia
            suscripción Profesional directamente con TotalFactu — tú solo la gestionas.
          </DialogDescription>
        </DialogHeader>

        {!activationUrl ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="add-company-email">Email de la empresa</Label>
              <Input
                id="add-company-email"
                type="email"
                placeholder="cliente@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generando...</> : <>
                  <Mail className="mr-2 h-4 w-4" /> Generar enlace
                </>}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <Alert>
              <CheckCircle className="h-4 w-4 text-green-500" />
              <AlertDescription>
                {emailSent
                  ? <>Invitación enviada por email a <strong>{email}</strong>.</>
                  : <>Invitación creada para <strong>{email}</strong>. No se pudo enviar el email automáticamente — comparte este enlace tú mismo:</>}
              </AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Input value={activationUrl} readOnly className="text-xs font-mono" />
              <Button type="button" variant="outline" size="icon" onClick={handleCopy}>
                {copied ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              El enlace expira en 7 días. Si la empresa ya usa TotalFactu, puede iniciar sesión y aceptar
              desde ahí; si no, el enlace le lleva a crear su cuenta.
            </p>
            <DialogFooter>
              <Button onClick={handleClose}>Cerrar</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
