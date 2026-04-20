'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Copy, CheckCircle, Loader2, Mail } from 'lucide-react';
import toast from 'react-hot-toast';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  availableLicenses: number;
}

export function InviteClientModal({ open, onClose, onSuccess, availableLicenses }: Props) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [activationUrl, setActivationUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/gestoria/invitations', {
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
    setCopied(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invitar cliente</DialogTitle>
          <DialogDescription>
            Se generará un enlace de activación único válido por 72 horas.
            Quedan <strong>{availableLicenses}</strong> licencias disponibles.
          </DialogDescription>
        </DialogHeader>

        {!activationUrl ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email del cliente</Label>
              <Input
                id="invite-email"
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
                Invitación creada para <strong>{email}</strong>. Comparte este enlace con tu cliente:
              </AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Input value={activationUrl} readOnly className="text-xs font-mono" />
              <Button type="button" variant="outline" size="icon" onClick={handleCopy}>
                {copied ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              El enlace expira en 72 horas. El cliente debe usarlo para crear su cuenta.
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
