"use client";

import { useTranslation } from "@/lib/i18n/context";
import { locales, localeNames, localeFlags, Locale } from "@/lib/i18n";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

interface LanguageSelectorProps {
  variant?: "default" | "compact";
  className?: string;
}

export function LanguageSelector({ variant = "default", className }: LanguageSelectorProps) {
  const { locale, setLocale } = useTranslation();

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Globe className="h-4 w-4 text-gray-500" />
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className={cn(
          "rounded-md border bg-white px-2 py-1 text-sm",
          variant === "compact" ? "text-xs" : "text-sm"
        )}
        aria-label="Idioma / Language"
      >
        {locales.map((loc: Locale) => (
          <option key={loc} value={loc}>
            {localeFlags[loc]} {localeNames[loc]}
          </option>
        ))}
      </select>
    </div>
  );
}
