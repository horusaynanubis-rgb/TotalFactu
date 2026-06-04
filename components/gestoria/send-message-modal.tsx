'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

const SUBJECTS = [
  'General',
  'Revisión factura',
  'Exportación CSV',
  'Documentación pendiente',
  'Aviso importante',
  'Otro',
] as const;

const MAX_CHARS = 1000;

interface Props {
  open: boolean;
  onClose: () => void;
  clientCompanyId: string;
  clientName: string;
}

export function SendMessageModal({ open, onClose, clientCompanyId, clientName }: Props) {
  const [subject, setSubject] = useState<string>('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const handleClose = () => {
    if (sending) return;
    setSubject('');
    setMessage('');
    onClose();
  };

  const handleSend = async () => {
    if (!subject) { toast.error('Selecciona un motivo'); return; }
    if (!message.trim()) { toast.error('El mensaje no puede estar vacío'); return; }

    setSending(true);
    try {
      const res = await fetch(`/api/gestoria/clients/${clientCompanyId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Error al enviar el mensaje');
        return;
      }

      const channels: string[] = [];
      if (data.emailSent) channels.push('email');
      if (data.telegramSent) channels.push('Telegram');

      if (channels.length > 0) {
        toast.success(`Mensaje enviado por ${channels.join(' y ')}`);
      } else {
        toast.success('Mensaje registrado (sin canales de entrega configurados)');
      }

      handleClose();
    } catch {
      toast.error('Error inesperado al enviar');
    } finally {
      setSending(false);
    }
  };

  const remaining = MAX_CHARS - message.length;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Enviar mensaje al cliente</DialogTitle>
          <p className="text-sm text-muted-foreground">{clientName}</p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="subject">Motivo</Label>
            <Select value={subject} onValueChange={setSubject}>
              <SelectTrigger id="subject">
                <SelectValue placeholder="Selecciona un motivo..." />
              </SelectTrigger>
              <SelectContent>
                {SUBJECTS.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="message">Mensaje</Label>
            <Textarea
              id="message"
              placeholder="Escribe tu mensaje..."
              rows={6}
              maxLength={MAX_CHARS}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="resize-none"
            />
            <p className={`text-xs text-right ${remaining < 50 ? 'text-orange-500' : 'text-muted-foreground'}`}>
              {remaining} caracteres restantes
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={sending}>
            Cancelar
          </Button>
          <Button onClick={handleSend} disabled={sending || !subject || !message.trim()}>
            {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Enviar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
