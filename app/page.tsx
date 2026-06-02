'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ArrowRight,
  FileText,
  Zap,
  Shield,
  BarChart3,
  CheckCircle,
  Send,
  Upload,
  Mail,
  Search,
  ClipboardList,
  Download,
  Building2,
  Rocket,
  Gift,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n/context';
import { LanguageSelector } from '@/components/language-selector';
import { GestoriaContactPopup } from '@/components/gestoria-contact-popup';

export default function LandingPage() {
  const { t } = useTranslation();
  const [gestoriaPopupOpen, setGestoriaPopupOpen] = useState(false);

  const steps = [
    { num: '1', icon: Send, title: t.landing.step1Title, desc: t.landing.step1Description },
    { num: '2', icon: Zap, title: t.landing.step2Title, desc: t.landing.step2Description },
    { num: '3', icon: Search, title: t.landing.step3Title, desc: t.landing.step3Description },
    { num: '4', icon: Download, title: t.landing.step4Title, desc: t.landing.step4Description },
  ];

  const features = [
    { icon: Send, title: t.landing.feature1Title, desc: t.landing.feature1Description },
    { icon: Zap, title: t.landing.feature2Title, desc: t.landing.feature2Description },
    { icon: BarChart3, title: t.landing.feature3Title, desc: t.landing.feature3Description },
    { icon: Shield, title: t.landing.feature4Title, desc: t.landing.feature4Description },
    { icon: ClipboardList, title: t.landing.feature5Title, desc: t.landing.feature5Description },
    { icon: FileText, title: t.landing.feature6Title, desc: t.landing.feature6Description },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-blue-50">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-2">
              <FileText className="h-8 w-8 text-primary" />
              <span className="text-xl font-bold">TotalFactu</span>
            </div>
            <div className="flex items-center space-x-3">
              <LanguageSelector variant="compact" />
              <Link href="/login">
                <Button variant="ghost">{t.common.signIn}</Button>
              </Link>
              <Link href="/signup">
                <Button>{t.common.getStarted}</Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Promotional Banner */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8">
        <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 rounded-2xl px-6 py-5 text-white shadow-lg shadow-blue-500/30 border border-blue-500/20">
          <div className="flex flex-col md:flex-row items-center justify-between gap-5">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 rounded-xl p-2.5 flex-shrink-0">
                <Rocket className="h-6 w-6 text-yellow-300" />
              </div>
              <div>
                <div className="text-yellow-300 font-bold text-xs uppercase tracking-widest mb-1">
                  Promoción de lanzamiento
                </div>
                <div className="text-white text-sm sm:text-base font-medium leading-snug">
                  Prueba TotalFactu sin compromiso y empieza a automatizar tu contabilidad hoy mismo
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="text-center px-5 py-2.5 bg-white/15 rounded-xl border border-white/25">
                <div className="text-2xl font-bold text-yellow-300 leading-none">30 días</div>
                <div className="text-xs text-blue-100 mt-0.5">gratis · autónomos y empresas</div>
              </div>
              <div className="text-blue-300 font-light text-xl hidden sm:block">·</div>
              <div className="text-center px-5 py-2.5 bg-white/15 rounded-xl border border-white/25">
                <div className="text-2xl font-bold text-yellow-300 leading-none">60 días</div>
                <div className="text-xs text-blue-100 mt-0.5">gratis · gestorías</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 text-primary text-sm font-medium px-4 py-1.5 rounded-full mb-6">
            <Send className="h-4 w-4" />
            {t.landing.heroBadge}
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
            {t.landing.heroTitle1}{' '}
            <span className="text-primary">{t.landing.heroTitle2}</span>
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            {t.landing.heroDescription}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/signup">
              <Button size="lg" className="w-full sm:w-auto">
                {t.landing.startFreeTrial} <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="#how-it-works">
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                {t.landing.howItWorksTitle}
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
            {t.landing.howItWorksTitle}
          </h2>
          <p className="text-lg text-gray-600">{t.landing.howItWorksSubtitle}</p>
        </div>

        <div className="grid md:grid-cols-4 gap-8">
          {steps.map((step, idx) => (
            <div key={idx} className="text-center">
              <div className="relative mx-auto mb-5">
                <div className="bg-primary w-14 h-14 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-primary/20">
                  <step.icon className="h-7 w-7 text-white" />
                </div>
                <span className="absolute -top-2 -right-2 bg-white border-2 border-primary text-primary text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center">
                  {step.num}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{step.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{step.desc}</p>
              {idx < steps.length - 1 && (
                <div className="hidden md:block absolute top-1/2 right-0 transform translate-x-1/2">
                  <ArrowRight className="h-5 w-5 text-gray-300" />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Why TotalFactu */}
      <section className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
              {t.landing.whyTitle}
            </h2>
            <p className="text-lg text-gray-600">{t.landing.whySubtitle}</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((f, idx) => (
              <Card key={idx} className="border hover:border-primary/40 transition-all hover:shadow-md">
                <CardHeader>
                  <div className="bg-primary/10 w-11 h-11 rounded-lg flex items-center justify-center mb-3">
                    <f.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-base">{f.title}</CardTitle>
                  <CardDescription className="text-sm leading-relaxed">{f.desc}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Also available — secondary channels */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{t.landing.alsoAvailableTitle}</h2>
          <p className="text-gray-600">{t.landing.alsoAvailableDescription}</p>
        </div>
        <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          <div className="flex items-start gap-4 p-5 rounded-xl border bg-white">
            <div className="bg-gray-100 w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0">
              <Upload className="h-5 w-5 text-gray-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">{t.landing.webUpload}</h3>
              <p className="text-sm text-gray-600">{t.landing.webUploadDesc}</p>
            </div>
          </div>
          <div className="flex items-start gap-4 p-5 rounded-xl border bg-white">
            <div className="bg-gray-100 w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0">
              <Mail className="h-5 w-5 text-gray-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">{t.landing.emailForwarding}</h3>
              <p className="text-sm text-gray-600">{t.landing.emailForwardingDesc}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
              {t.landing.pricingTitle}
            </h2>
            <p className="text-lg text-gray-600">{t.landing.pricingSubtitle}</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto items-start">

            {/* Demo / Prueba */}
            <Card className="relative border-2 border-border hover:shadow-lg transition-all">
              <CardHeader className="text-center pb-6">
                <div className="inline-flex items-center justify-center bg-gray-100 text-gray-600 text-xs font-medium px-3 py-1 rounded-full mb-3 mx-auto">
                  {t.landing.demoPlanLabel}
                </div>
                <CardTitle className="text-2xl mb-1">Demo</CardTitle>
                <CardDescription className="text-sm">Autónomos y PYMEs que quieren probar</CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold">Gratis</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 mb-8">
                  {t.planFeatures.demo.map((feature: string, idx: number) => (
                    <li key={idx} className="flex items-start">
                      <CheckCircle className="h-5 w-5 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/signup?plan=demo">
                  <Button className="w-full" variant="outline">
                    Probar gratis
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Profesional — destacado en el centro */}
            <Card className="relative border-2 border-primary shadow-xl scale-105 hover:shadow-2xl transition-all">
              <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                <span className="bg-primary text-white px-4 py-1 rounded-full text-sm font-semibold">
                  {t.landing.mostPopular}
                </span>
              </div>
              <CardHeader className="text-center pb-6">
                <CardTitle className="text-2xl mb-1">Profesional</CardTitle>
                <CardDescription className="text-sm">Para autónomos y PYMEs</CardDescription>
                <div className="mt-3 mb-1 flex justify-center">
                  <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 border border-green-200 text-xs font-bold px-3 py-1 rounded-full">
                    <Gift className="h-3.5 w-3.5" />
                    30 días GRATIS
                  </span>
                </div>
                <div className="mt-2">
                  <span className="text-4xl font-bold">€14,99</span>
                  <span className="text-gray-600">{t.common.perMonth}</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 mb-8">
                  {t.planFeatures.profesional.map((feature: string, idx: number) => (
                    <li key={idx} className="flex items-start">
                      <CheckCircle className="h-5 w-5 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/signup?plan=profesional">
                  <Button className="w-full">
                    Empieza gratis <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Gestoria */}
            <Card className="relative border-2 border-border hover:shadow-lg transition-all">
              <CardHeader className="text-center pb-6">
                <div className="inline-flex items-center justify-center bg-blue-50 text-primary text-xs font-medium px-3 py-1 rounded-full mb-3 mx-auto gap-1.5">
                  <Building2 className="h-3.5 w-3.5" /> Gestorías
                </div>
                <CardTitle className="text-2xl mb-1">Gestoría</CardTitle>
                <CardDescription className="text-sm">Para despachos y gestorías con múltiples clientes</CardDescription>
                <div className="mt-3 mb-1 flex justify-center">
                  <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold px-3 py-1 rounded-full">
                    <Rocket className="h-3.5 w-3.5" />
                    60 días GRATIS
                  </span>
                </div>
                <div className="mt-2">
                  <span className="text-2xl font-bold text-primary">Packs de licencias</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">10 · 30 · 50 clientes</p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 mb-8">
                  {t.planFeatures.gestoria.map((feature: string, idx: number) => (
                    <li key={idx} className="flex items-start">
                      <CheckCircle className="h-5 w-5 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
                      <span className="text-gray-700">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => setGestoriaPopupOpen(true)}
                >
                  <Building2 className="h-4 w-4 mr-2" />
                  Ver packs y precios
                </Button>
              </CardContent>
            </Card>

          </div>
        </div>
      </section>

      <GestoriaContactPopup open={gestoriaPopupOpen} onClose={() => setGestoriaPopupOpen(false)} />

      {/* CTA Section */}
      <section className="bg-primary text-white py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">{t.landing.ctaTitle}</h2>
          <p className="text-xl mb-8 text-blue-100">{t.landing.ctaSubtitle}</p>
          <Link href="/signup">
            <Button size="lg" variant="secondary" className="text-primary">
              {t.landing.startFreeTrial} <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Support & Contact */}
      <section className="bg-gray-50 border-t py-14">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-primary/10 rounded-xl mb-4">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">{t.landing.supportTitle}</h2>
          <p className="text-gray-600 mb-5 leading-relaxed">{t.landing.supportDescription}</p>
          <a
            href="mailto:info@horusayn.com"
            className="inline-flex items-center gap-2 bg-white border border-gray-200 hover:border-primary/40 hover:shadow-sm text-primary font-medium px-5 py-2.5 rounded-lg transition-all text-sm"
          >
            <Mail className="h-4 w-4" />
            info@horusayn.com
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="flex items-center space-x-2 mb-4 md:mb-0">
              <FileText className="h-6 w-6 text-primary" />
              <span className="text-white font-semibold">TotalFactu</span>
            </div>
            <div className="text-sm">
              © 2026 TotalFactu. {t.landing.allRightsReserved}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
