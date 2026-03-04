"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { LOCALES } from "@/i18n/path";

function stripLeadingLocale(pathname: string) {
  const parts = pathname.split("/");
  const maybeLocale = parts[1];
  if (LOCALES.includes(maybeLocale as any)) {
    const rest = "/" + parts.slice(2).join("/");
    return rest === "/" ? "" : rest;
  }
  return pathname === "/" ? "" : pathname;
}

export default function LanguageToggle() {
  const pathname = usePathname() || "/";
  const params = useParams() as { locale?: string };
  const currentLocale = params?.locale && LOCALES.includes(params.locale as any) ? params.locale : "en";
  const rest = stripLeadingLocale(pathname);

  return (
    <div className="flex items-center gap-2 text-sm">
      {LOCALES.map((loc) => (
        <Link
          key={loc}
          href={`/${loc}${rest}`}
          className={loc === currentLocale ? "font-semibold underline" : "underline"}
        >
          {loc.toUpperCase()}
        </Link>
      ))}
    </div>
  );
}
