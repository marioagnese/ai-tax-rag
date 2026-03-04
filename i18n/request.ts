// i18n/request.ts
import { getRequestConfig } from "next-intl/server";

const SUPPORTED = new Set(["en", "es", "pt"]);
const DEFAULT_LOCALE = "en";

export default getRequestConfig(async ({ locale }) => {
  // next-intl types allow locale to be possibly undefined, so force a safe string
  const safeLocale =
    typeof locale === "string" && SUPPORTED.has(locale) ? locale : DEFAULT_LOCALE;

  return {
    locale: safeLocale,
    messages: (await import(`../messages/${safeLocale}.json`)).default,
  };
});