'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tags, Plus, Pencil, Trash2, Power, PowerOff, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface AliasRow {
  id: string;
  alias: string;
  alias_normalized: string;
  alias_type: string;
  active: boolean;
  created_at: string;
}

const ALIAS_TYPES = [
  { value: 'fiscal', label: 'Fiscal' },
  { value: 'comercial', label: 'Comercial' },
  { value: 'marca', label: 'Marca' },
  { value: 'otro', label: 'Otro' },
] as const;

function typeBadge(type: string) {
  const map: Record<string, string> = {
    fiscal: 'bg-blue-100 text-blue-700',
    comercial: 'bg-purple-100 text-purple-700',
    marca: 'bg-pink-100 text-pink-700',
    otro: 'bg-gray-100 text-gray-600',
  };
  const label = ALIAS_TYPES.find((t) => t.value === type)?.label ?? type;
  const cls = map[type] ?? map['otro'];
  return <Badge className={`${cls} hover:${cls} text-xs`}>{label}</Badge>;
}

interface AliasFormProps {
  open: boolean;
  initial?: AliasRow | null;
  onClose: () => void;
  onSaved: (alias: AliasRow) => void;
}

function AliasFormDialog({ open, initial, onClose, onSaved }: AliasFormProps) {
  const [alias, setAlias] = useState('');
  const [aliasType, setAliasType] = useState('otro');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAlias(initial?.alias ?? '');
      setAliasType(initial?.alias_type ?? 'otro');
    }
  }, [open, initial]);

  const handleSave = async () => {
    if (alias.trim().length < 3) {
      toast.error('El alias debe tener al menos 3 caracteres');
      return;
    }
    setSaving(true);
    try {
      let res: Response;
      if (initial) {
        res = await fetch(`/api/company/aliases/${initial.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alias: alias.trim(), alias_type: aliasType }),
        });
      } else {
        res = await fetch('/api/company/aliases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alias: alias.trim(), alias_type: aliasType }),
        });
      }
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Error al guardar');
        return;
      }
      onSaved(data.alias);
      onClose();
      toast.success(initial ? 'Alias actualizado' : 'Alias creado');
    } catch {
      toast.error('Error inesperado');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{initial ? 'Editar alias' : 'Añadir alias'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="alias-input">Nombre del alias</Label>
            <Input
              id="alias-input"
              placeholder="Ej: BYOU, CAFETERIA BYOU, BARBARA..."
              value={alias}
              maxLength={100}
              onChange={(e) => setAlias(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Tal como aparece en las facturas. Mínimo 3 caracteres.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alias-type">Tipo</Label>
            <Select value={aliasType} onValueChange={setAliasType}>
              <SelectTrigger id="alias-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALIAS_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || alias.trim().length < 3}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {initial ? 'Guardar cambios' : 'Añadir alias'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CompanyAliases() {
  const [aliases, setAliases] = useState<AliasRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AliasRow | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchAliases = useCallback(async () => {
    try {
      const res = await fetch('/api/company/aliases');
      const data = await res.json();
      setAliases(data.aliases ?? []);
    } catch {
      toast.error('Error cargando alias');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAliases(); }, [fetchAliases]);

  const handleSaved = (alias: AliasRow) => {
    setAliases((prev) => {
      const idx = prev.findIndex((a) => a.id === alias.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = alias;
        return next;
      }
      return [...prev, alias];
    });
  };

  const handleToggle = async (alias: AliasRow) => {
    setTogglingId(alias.id);
    try {
      const res = await fetch(`/api/company/aliases/${alias.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !alias.active }),
      });
      if (!res.ok) { toast.error('Error al actualizar'); return; }
      const data = await res.json();
      handleSaved(data.alias);
      toast.success(data.alias.active ? 'Alias activado' : 'Alias desactivado');
    } catch {
      toast.error('Error inesperado');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este alias? Esta acción no se puede deshacer.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/company/aliases/${id}`, { method: 'DELETE' });
      if (!res.ok) { toast.error('Error al eliminar'); return; }
      setAliases((prev) => prev.filter((a) => a.id !== id));
      toast.success('Alias eliminado');
    } catch {
      toast.error('Error inesperado');
    } finally {
      setDeletingId(null);
    }
  };

  const openAdd = () => { setEditTarget(null); setDialogOpen(true); };
  const openEdit = (alias: AliasRow) => { setEditTarget(alias); setDialogOpen(true); };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Tags className="h-5 w-5" />
                Alias fiscales y comerciales
              </CardTitle>
              <CardDescription className="mt-1">
                Nombres alternativos con los que tu empresa aparece en facturas. TotalFactu los asociará
                automáticamente sin enviar el documento a revisión.
              </CardDescription>
            </div>
            <Button type="button" size="sm" onClick={openAdd}>
              <Plus className="h-4 w-4 mr-1.5" />
              Añadir alias
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : aliases.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground px-6">
              <Tags className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">Sin alias configurados</p>
              <p className="text-xs mt-1">
                Añade los nombres alternativos que aparecen en tus facturas para evitar revisiones
                manuales.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alias</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aliases.map((alias) => (
                  <TableRow key={alias.id} className={!alias.active ? 'opacity-50' : undefined}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{alias.alias}</p>
                        <p className="text-xs text-muted-foreground font-mono">{alias.alias_normalized}</p>
                      </div>
                    </TableCell>
                    <TableCell>{typeBadge(alias.alias_type)}</TableCell>
                    <TableCell>
                      {alias.active ? (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100 text-xs">Activo</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground text-xs">Inactivo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(alias)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={togglingId === alias.id}
                          title={alias.active ? 'Desactivar' : 'Activar'}
                          onClick={() => handleToggle(alias)}
                        >
                          {togglingId === alias.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : alias.active ? (
                            <PowerOff className="h-3.5 w-3.5 text-orange-500" />
                          ) : (
                            <Power className="h-3.5 w-3.5 text-green-500" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={deletingId === alias.id}
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(alias.id)}
                        >
                          {deletingId === alias.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AliasFormDialog
        open={dialogOpen}
        initial={editTarget}
        onClose={() => setDialogOpen(false)}
        onSaved={handleSaved}
      />
    </>
  );
}
