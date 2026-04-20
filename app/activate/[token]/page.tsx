'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface InvitationInfo {
  valid: boolean;
  email: string;
  gestoria_name: string;
  expires_at: string;
}

export default function ActivatePage({ params }: { params: { token: string } }) {
  const router = useRouter();
  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    password: '',
    confirmPassword: '',
    companyName: '',
    taxId: '',
  });

  useEffect(() => {
    fetch(`/api/activate/${params.token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.valid) {
          setInvitation(data);
        } else {
          setError(data.error || 'Enlace no válido');
        }
      })
      .catch(() => setError('Error al validar el enlace'))
      .finally(() => setValidating(false));
  }, [params.token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      toast.error('Las contraseñas no coinciden');
      return;
    }

    if (!invitation) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: invitation.email,
          password: formData.password,
          companyName: formData.companyName,
          taxId: formData.taxId,
          activationToken: params.token,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message || 'Error al crear la cuenta');
        return;
      }

      toast.success('¡Cuenta creada correctamente!');

      const signInResult = await signIn('credentials', {
        email: invitation.email,
        password: formData.password,
        redirect: false,
      });

      if (signInResult?.error) {
        router.push('/login');
      } else {
        router.push('/dashboard');
      }
    } catch {
      toast.error('Error inesperado. Inténtalo de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  if (validating) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <XCircle className="h-12 w-12 text-destructive" />
            </div>
            <CardTitle>Enlace no válido</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button variant="outline" onClick={() => router.push('/login')}>
              Ir al inicio de sesión
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-primary/10 p-3 rounded-lg">
              <FileText className="h-8 w-8 text-primary" />
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 mb-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <span className="text-sm text-green-600 font-medium">Invitación válida</span>
          </div>
          <CardTitle className="text-2xl font-bold">Activa tu cuenta</CardTitle>
          <CardDescription>
            Invitado por <span className="font-medium text-foreground">{invitation?.gestoria_name}</span>
            <br />
            Cuenta: <span className="font-medium text-foreground">{invitation?.email}</span>
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Tu nombre</Label>
              <Input
                id="name"
                type="text"
                placeholder="Juan García"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyName">Nombre de tu empresa</Label>
              <Input
                id="companyName"
                type="text"
                placeholder="Mi Empresa S.L."
                value={formData.companyName}
                onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="taxId">NIF / CIF</Label>
              <Input
                id="taxId"
                type="text"
                placeholder="B12345678"
                value={formData.taxId}
                onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Repite la contraseña"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                required
                minLength={6}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creando cuenta...</>
              ) : (
                'Activar y entrar'
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
