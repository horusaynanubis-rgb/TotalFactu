'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { 
  LayoutDashboard, 
  FileText, 
  Receipt, 
  ListChecks,
  Download, 
  Settings, 
  CreditCard,
  LogOut,
  Menu,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { useTranslation } from '@/lib/i18n/context';
import { LanguageSelector } from '@/components/language-selector';

export function DashboardNav() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { t } = useTranslation();

  const navigation = [
    { name: t.nav.dashboard, href: '/dashboard', icon: LayoutDashboard },
    { name: t.nav.documents, href: '/dashboard/documents', icon: FileText },
    { name: t.nav.invoices, href: '/dashboard/invoices', icon: Receipt },
    { name: 'Cola de Revisión', href: '/dashboard/review', icon: ListChecks },
    { name: t.nav.exports, href: '/dashboard/exports', icon: Download },
    { name: t.nav.settings, href: '/dashboard/settings', icon: Settings },
    { name: t.nav.billing, href: '/dashboard/billing', icon: CreditCard },
  ];

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/' });
  };

  return (
    <>
      {/* Desktop Navigation */}
      <div className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0">
        <div className="flex flex-col flex-grow bg-white border-r overflow-y-auto">
          <div className="flex items-center flex-shrink-0 px-4 py-6 border-b">
            <FileText className="h-8 w-8 text-primary" />
            <span className="ml-2 text-xl font-bold">TotalFactu</span>
          </div>
          <div className="flex-grow flex flex-col">
            <nav className="flex-1 px-2 py-4 space-y-1">
              {navigation.map((item: any) => {
                const isActive = pathname === item?.href;
                return (
                  <Link
                    key={item?.href}
                    href={item?.href}
                    className={cn(
                      'group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors',
                      isActive
                        ? 'bg-primary text-white'
                        : 'text-gray-700 hover:bg-gray-100'
                    )}
                  >
                    <item.icon
                      className={cn(
                        'mr-3 h-5 w-5 flex-shrink-0',
                        isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-500'
                      )}
                    />
                    {item?.name}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex-shrink-0 border-t">
            <div className="flex items-center justify-center px-4 py-3">
              <LanguageSelector variant="compact" />
            </div>
            <div className="px-4 pb-4">
              <Button
                variant="ghost"
                className="w-full justify-start text-gray-700 hover:bg-gray-100"
                onClick={handleSignOut}
              >
                <LogOut className="mr-3 h-5 w-5 text-gray-400" />
                {t.common.signOut}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="md:hidden">
        <div className="fixed top-0 left-0 right-0 z-50 bg-white border-b">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center">
              <FileText className="h-7 w-7 text-primary" />
              <span className="ml-2 text-lg font-bold">TotalFactu</span>
            </div>
            <div className="flex items-center gap-2">
              <LanguageSelector variant="compact" />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? (
                  <X className="h-6 w-6" />
                ) : (
                  <Menu className="h-6 w-6" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="fixed inset-0 z-40 bg-white pt-16">
            <nav className="px-2 py-4 space-y-1">
              {navigation.map((item: any) => {
                const isActive = pathname === item?.href;
                return (
                  <Link
                    key={item?.href}
                    href={item?.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'group flex items-center px-3 py-3 text-base font-medium rounded-md',
                      isActive
                        ? 'bg-primary text-white'
                        : 'text-gray-700 hover:bg-gray-100'
                    )}
                  >
                    <item.icon
                      className={cn(
                        'mr-3 h-6 w-6 flex-shrink-0',
                        isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-500'
                      )}
                    />
                    {item?.name}
                  </Link>
                );
              })}
              <Button
                variant="ghost"
                className="w-full justify-start text-gray-700 hover:bg-gray-100 mt-4"
                onClick={handleSignOut}
              >
                <LogOut className="mr-3 h-6 w-6 text-gray-400" />
                {t.common.signOut}
              </Button>
            </nav>
          </div>
        )}
      </div>
    </>
  );
}
