'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import toast from 'react-hot-toast';
import { FileText, Zap } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/context';
import { LanguageSelector } from '@/components/language-selector';

export default function SignupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const plan = searchParams.get('plan') || 'demo';
  const activationToken = searchParams.get('token') || '';
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    companyName: '',
    taxId: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      toast.error(t.auth.passwordsMismatch);
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          companyName: formData.companyName,
          taxId: formData.taxId,
          plan,
          activationToken: activationToken || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data?.message || t.auth.signupFailed);
        return;
      }

      toast.success(t.auth.accountCreated);

      const signInResult = await signIn('credentials', {
        email: formData.email,
        password: formData.password,
        redirect: false,
      });

      if (signInResult?.error) {
        toast.error(t.auth.signInManually);
        router.push('/login');
        return;
      }

      if (plan === 'profesional') {
        // Redirect to Stripe checkout for Profesional plan
        try {
          const checkoutRes = await fetch('/api/stripe/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'plan', plan: 'profesional' }),
          });
          const checkoutData = await checkoutRes.json();
          if (checkoutData.url) {
            window.location.href = checkoutData.url;
            return;
          }
        } catch {
          // If Stripe fails, go to billing page so they can retry
        }
        router.push('/dashboard/billing?checkout=true');
      } else {
        router.push('/dashboard');
      }
    } catch (error: any) {
      toast.error(t.auth.signupError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4 py-8">
      <div className="absolute top-4 right-4">
        <LanguageSelector />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-primary/10 p-3 rounded-lg">
              <FileText className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">{t.auth.createAccount}</CardTitle>
          <CardDescription>{t.auth.createAccountSubtitle}</CardDescription>
          {plan === 'profesional' && (
            <div className="mt-3 flex items-center gap-2 bg-primary/10 text-primary rounded-lg px-3 py-2 text-sm font-medium">
              <Zap className="h-4 w-4 flex-shrink-0" />
              Plan Profesional — €14,99/mes · Se requiere pago tras el registro
            </div>
          )}
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t.auth.fullName}</Label>
              <Input
                id="name"
                type="text"
                placeholder={t.auth.fullNamePlaceholder}
                value={formData.name}
                onChange={(e: any) => setFormData({ ...formData, name: e?.target?.value ?? '' })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t.auth.emailLabel}</Label>
              <Input
                id="email"
                type="email"
                placeholder={t.auth.emailPlaceholder}
                value={formData.email}
                onChange={(e: any) => setFormData({ ...formData, email: e?.target?.value ?? '' })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="companyName">{t.auth.companyName}</Label>
              <Input
                id="companyName"
                type="text"
                placeholder={t.auth.companyNamePlaceholder}
                value={formData.companyName}
                onChange={(e: any) => setFormData({ ...formData, companyName: e?.target?.value ?? '' })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="taxId">{t.auth.taxIdLabel}</Label>
              <Input
                id="taxId"
                type="text"
                placeholder={t.auth.taxIdPlaceholder}
                value={formData.taxId}
                onChange={(e: any) => setFormData({ ...formData, taxId: e?.target?.value ?? '' })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t.auth.passwordLabel}</Label>
              <Input
                id="password"
                type="password"
                placeholder={t.auth.passwordPlaceholder}
                value={formData.password}
                onChange={(e: any) => setFormData({ ...formData, password: e?.target?.value ?? '' })}
                required
                minLength={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t.auth.confirmPassword}</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder={t.auth.passwordPlaceholder}
                value={formData.confirmPassword}
                onChange={(e: any) => setFormData({ ...formData, confirmPassword: e?.target?.value ?? '' })}
                required
                minLength={6}
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col space-y-4">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t.auth.creatingAccount : t.auth.createAccount}
            </Button>
            <p className="text-sm text-center text-muted-foreground">
              {t.auth.hasAccount}{' '}
              <Link href="/login" className="text-primary hover:underline font-medium">
                {t.common.signIn}
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
