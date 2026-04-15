'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import toast from 'react-hot-toast';
import { FileText } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/context';
import { LanguageSelector } from '@/components/language-selector';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await signIn('credentials', {
        email: formData.email,
        password: formData.password,
        redirect: false,
      });

      if (result?.error) {
        toast.error(t.auth.invalidCredentials);
      } else {
        toast.success(t.auth.loginSuccess);
        router.push('/dashboard');
      }
    } catch (error: any) {
      toast.error(t.auth.loginError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4">
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
          <CardTitle className="text-2xl font-bold">{t.auth.welcomeBack}</CardTitle>
          <CardDescription>{t.auth.signInToAccount}</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
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
              <Label htmlFor="password">{t.auth.passwordLabel}</Label>
              <Input
                id="password"
                type="password"
                placeholder={t.auth.passwordPlaceholder}
                value={formData.password}
                onChange={(e: any) => setFormData({ ...formData, password: e?.target?.value ?? '' })}
                required
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col space-y-4">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t.auth.signingIn : t.common.signIn}
            </Button>
            <p className="text-sm text-center text-muted-foreground">
              {t.auth.noAccount}{' '}
              <Link href="/signup" className="text-primary hover:underline font-medium">
                {t.common.signUp}
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
