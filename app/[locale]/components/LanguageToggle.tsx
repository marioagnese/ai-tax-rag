"use client";

import React from "react";
import { usePathname, useSearchParams } from "next/navigation";

type Locale = "en" | "es" | "pt";
const LOCALES: Locale[] = ["en", "es", "pt"];

const LABEL: Record<Locale, string> = {
  en: "EN",
  es: "ES",
  pt: "BR",
};

function replaceLocaleInPath(pathname: string, nextLocale: Locale) {
  const parts = pathname.split("/").filter(Boolean);

  if (parts.length === 0) return `/${nextLocale}`;

  const first = parts[0];
  if (LOCALES.includes(first as Locale)) {
    parts[0] = nextLocale;
    return "/" + parts.join("/");
  }

  return `/${nextLocale}/` + parts.join("/");
}

export default function LanguageToggle({
  className = "",
}: {
  className?: string;
}) {
  const pathname = usePathname() || "/";
  const sp = useSearchParams();
  const qs = sp?.toString();

  const hrefWithQs = (p: string) => (qs ? `${p}?${qs}` : p);

  const seg0 = pathname.split("/").filter(Boolean)[0];
  const current = (LOCALES.includes(seg0 as Locale) ? (seg0 as Locale) : "en") as Locale;

  return (
    <div
      className={[
        "inline-flex items-center gap-1 rounded-full border border-white/20 bg-black/35 px-2 py-2 shadow-lg backdrop-blur-md",
        className,
      ].join(" ")}
      aria-label="Language selector"
    >
      {LOCALES.map((loc) => {
        const active = loc === current;
        const nextPath = hrefWithQs(replaceLocaleInPath(pathname, loc));

        return (
          <a
            key={loc}
            href={nextPath}
            aria-label={LABEL[loc]}
            title={LABEL[loc]}
            aria-current={active ? "page" : undefined}
            className={[
              "flex h-11 min-w-[44px] items-center justify-center rounded-full border px-3 text-sm font-semibold transition",
              active
                ? "border-white/70 bg-white/15 text-white"
                : "border-white/15 bg-transparent text-white/85 hover:bg-white/10",
            ].join(" ")}
          >
            {LABEL[loc]}
          </a>
        );
      })}
    </div>
  );
}
