"use client";

import React from "react";
import { usePathname, useSearchParams } from "next/navigation";

type Locale = "en" | "es" | "pt";
const LOCALES: Locale[] = ["en", "es", "pt"];

function replaceLocaleInPath(pathname: string, nextLocale: Locale) {
  // Expected paths like: /en, /en/crosscheck, /es/plans, etc.
  // If no locale segment found, we prefix it.
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

  // Infer current locale from the first path segment
  const seg0 = pathname.split("/").filter(Boolean)[0];
  const current = (LOCALES.includes(seg0 as Locale) ? (seg0 as Locale) : "en") as Locale;

  return (
    <div
      className={[
        "inline-flex items-center rounded-xl border border-white/15 bg-white/5 p-1",
        className,
      ].join(" ")}
      aria-label="Language"
    >
      {LOCALES.map((loc) => {
        const active = loc === current;
        const nextPath = hrefWithQs(replaceLocaleInPath(pathname, loc));
        return (
          <a
            key={loc}
            href={nextPath}
            className={[
              "px-3 py-1.5 text-xs font-semibold rounded-lg transition",
              active
                ? "bg-white text-black"
                : "text-white/80 hover:bg-white/10",
            ].join(" ")}
            aria-current={active ? "page" : undefined}
          >
            {loc.toUpperCase()}
          </a>
        );
      })}
    </div>
  );
}
