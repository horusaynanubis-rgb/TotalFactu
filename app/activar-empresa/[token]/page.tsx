'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signIn } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

// NEW MODEL acceptance page — mirrors app/activate/[token]/page.tsx (the
// LEGACY license-invitation flow) but talks to the new
// GestoriaCompanyInvitation endpoints and supports BOTH plan section
// 5/6 flows from one page:
//   - not logged in  -> same signup form as legacy, but with
//     gestoriaInvitationToken instead of activationToken (creates a
//     GestoriaClientRelation instead of touching License).
//   - already logged in -> pick which of your own companies to link,
//     via the authenticated accept endpoint. Never auto-associates by
//     email alone — see that route's comments.

interface InvitationInfo {
  valid: boolean;
  email: string;
  mode: string;
  gestoria_name: string;
  expires_at: string;
}

interface OwnedCompany {
  id: string;
  name: string;
  tax_id: string;
  role: string;
}

export default function ActivarEmpresaPage({ params }: { params: { token: string } }) {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();

  const [invitation, setInvitation] = useState<InvitationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validating, setValidating] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Signup-form state (not-logged-in path)
  const [formData, setFormData] = useState({
    name: '',
    password: '',
    confirmPassword: '',
    companyName: '',
    taxId: '',
  });

  // Existing-company path
  const [ownedCompanies, setOwnedCompanies] = useState<OwnedCompany[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  useEffect(() => {
    fetch(`/api/gestoria/company-invitations/token/${params.token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.valid) setInvitation(data);
        else setError(data.error || 'Enlace no válido');
      })
      .catch(() => setError('Error al validar el enlace'))
      .finally(() => setValidating(false));
  }, [params.token]);

  useEffect(() => {
    if (sessionStatus !== 'authenticated' || !invitation) return;
    setLoadingCompanies(true);
    fetch('/api/company/list')
      .then((r) => r.json())
      .then((data) => {
        const admin = (data.companies ?? []).filter((c: OwnedCompany) => c.role === 'admin');
        setOwnedCompanies(admin);
        if (admin.length === 1) setSelectedCompanyId(admin[0].id);
      })
      .catch(() => toast.error('No se pudieron cargar tus empresas'))
      .finally(() => setLoadingCompanies(false));
  }, [sessionStatus, invitation]);

  const handleAcceptExisting = async () => {
    if (!selectedCompanyId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/gestoria/company-invitations/token/${params.token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: selectedCompanyId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Error al vincular la empresa');
        return;
      }
      toast.success('Empresa vinculada correctamente');
      router.push('/dashboard');
    } catch {
      toast.error('Error inesperado');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
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
          gestoriaInvitationToken: params.token,
          plan: 'demo',
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

  if (validating || sessionStatus === 'loading') {
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

  // Already logged in — pick which company to link.
  if (sessionStatus === 'authenticated') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4 py-8">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-1 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              <span className="text-sm text-green-600 font-medium">Invitación válida</span>
            </div>
            <CardTitle className="text-2xl font-bold">Vincular empresa</CardTitle>
            <CardDescription>
              <span className="font-medium text-foreground">{invitation?.gestoria_name}</span> quiere gestionar
              una de tus empresas. Elige cuál — tu suscripción y datos no cambian.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingCompanies ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : ownedCompanies.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No tienes ninguna empresa donde seas administrador. Inicia sesión con la cuenta correcta o crea una
                empresa nueva.
              </p>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="company-select">Tu empresa</Label>
                <select
                  id="company-select"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={selectedCompanyId}
                  onChange={(e) => setSelectedCompanyId(e.target.value)}
                >
                  <option value="" disabled>Selecciona una empresa</option>
                  {ownedCompanies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.tax_id})</option>
                  ))}
                </select>
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              disabled={!selectedCompanyId || submitting}
              onClick={handleAcceptExisting}
            >
              {submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Vinculando...</> : 'Vincular empresa'}
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Not logged in — same signup shape as the legacy activation page.
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
          <CardTitle className="text-2xl font-bold">Crea tu cuenta</CardTitle>
          <CardDescription>
            Invitado por <span className="font-medium text-foreground">{invitation?.gestoria_name}</span>
            <br />
            Cuenta: <span className="font-medium text-foreground">{invitation?.email}</span>
            <br />
            <span className="text-xs">Tu empresa contrata su propia suscripción Profesional directamente con TotalFactu.</span>
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSignupSubmit}>
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
                'Crear cuenta y vincular'
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
