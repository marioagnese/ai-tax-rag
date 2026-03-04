export const LOCALES = ["en", "es", "pt"] as const;
export type Locale = (typeof LOCALES)[number];

export function withLocale(locale: string, path: string) {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `/${locale}${clean === "/" ? "" : clean}`;
}
