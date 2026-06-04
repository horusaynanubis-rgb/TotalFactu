'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Inbox, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

interface MessageRow {
  id: string;
  subject: string;
  body: string;
  read_at: string | null;
  email_sent: boolean;
  telegram_sent: boolean;
  created_at: string;
  gestoria_company: { id: string; name: string };
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MessageRow | null>(null);

  useEffect(() => {
    fetch('/api/messages')
      .then((r) => r.json())
      .then((data) => setMessages(data.messages ?? []))
      .catch(() => toast.error('Error cargando mensajes'))
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = async (msg: MessageRow) => {
    setSelected(msg);
    if (!msg.read_at) {
      try {
        const res = await fetch(`/api/messages/${msg.id}/read`, { method: 'PATCH' });
        if (res.ok) {
          setMessages((prev) =>
            prev.map((m) => m.id === msg.id ? { ...m, read_at: new Date().toISOString() } : m)
          );
        }
      } catch {
        // non-critical
      }
    }
  };

  const unreadCount = messages.filter((m) => !m.read_at).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Inbox className="h-6 w-6" />
          Mensajes
          {unreadCount > 0 && (
            <Badge className="bg-red-500 hover:bg-red-500 text-white">{unreadCount} nuevos</Badge>
          )}
        </h1>
        <p className="text-muted-foreground">Mensajes de tu gestoría</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : messages.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Inbox className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-30" />
            <p className="text-muted-foreground">No tienes mensajes todavía.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-[320px_1fr] gap-4 items-start">
          {/* Message list */}
          <div className="space-y-1">
            {messages.map((msg) => (
              <button
                key={msg.id}
                onClick={() => handleSelect(msg)}
                className={cn(
                  'w-full text-left rounded-lg border p-3 transition-colors hover:bg-accent',
                  selected?.id === msg.id && 'bg-accent border-primary',
                  !msg.read_at && 'border-primary/40 bg-primary/5',
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className={cn('text-sm font-medium truncate', !msg.read_at && 'font-semibold')}>
                    {msg.gestoria_company.name}
                  </span>
                  {!msg.read_at && (
                    <span className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Badge variant="outline" className="text-xs px-1.5 py-0">{msg.subject}</Badge>
                </div>
                <p className="text-xs text-muted-foreground truncate">{msg.body}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(msg.created_at).toLocaleDateString('es-ES', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })}
                </p>
              </button>
            ))}
          </div>

          {/* Message detail */}
          {selected ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{selected.gestoria_company.name}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {new Date(selected.created_at).toLocaleDateString('es-ES', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                  <Badge variant="outline">{selected.subject}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="bg-muted rounded-lg p-4">
                  <p className="text-sm whitespace-pre-wrap">{selected.body}</p>
                </div>
                {selected.read_at && (
                  <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                    Leído el {new Date(selected.read_at).toLocaleDateString('es-ES')}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="hidden md:flex items-center justify-center h-48 rounded-lg border border-dashed text-muted-foreground text-sm">
              Selecciona un mensaje para leerlo
            </div>
          )}
        </div>
      )}
    </div>
  );
}
