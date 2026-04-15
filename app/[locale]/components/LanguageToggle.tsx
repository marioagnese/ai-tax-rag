"use client";

import Image from "next/image";
import React from "react";
import { usePathname, useSearchParams } from "next/navigation";

type Locale = "en" | "es" | "pt";
const LOCALES: Locale[] = ["en", "es", "pt"];

const FLAGS: Record<Locale, { src: string; alt: string; title: string }> = {
  en: { src: "/flags/us.svg", alt: "English", title: "English" },
  es: { src: "/flags/es.svg", alt: "Español", title: "Español" },
  pt: { src: "/flags/br.svg", alt: "Português", title: "Português" },
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
  const current = (LOCALES.includes(seg0 as Locale)
    ? (seg0 as Locale)
    : "en") as Locale;

  return (
    <div
      className={[
        "inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-1 backdrop-blur-md",
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
            aria-label={FLAGS[loc].title}
            title={FLAGS[loc].title}
            aria-current={active ? "page" : undefined}
            className={[
              "flex h-9 w-9 items-center justify-center rounded-full transition",
              active
                ? "bg-white/15 ring-1 ring-white/20"
                : "opacity-80 hover:bg-white/10 hover:opacity-100",
            ].join(" ")}
          >
            <Image
              src={FLAGS[loc].src}
              alt={FLAGS[loc].alt}
              width={18}
              height={18}
              className="rounded-full object-cover"
            />
          </a>
        );
      })}
    </div>
  );
}