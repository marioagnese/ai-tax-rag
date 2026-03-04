import { notFound } from "next/navigation";
import { getRequestConfig } from "next-intl/server";

const SUPPORTED = ["en", "es", "pt"] as const;
type SupportedLocale = (typeof SUPPORTED)[number];

function isSupportedLocale(v: unknown): v is SupportedLocale {
  return typeof v === "string" && (SUPPORTED as readonly string[]).includes(v);
}

export default getRequestConfig(async ({ locale }) => {
  const resolved: SupportedLocale = isSupportedLocale(locale) ? locale : "en";

  if (!isSupportedLocale(resolved)) notFound();

  return {
    locale: resolved,
    messages: (await import(`./messages/${resolved}.json`)).default
  };
});
