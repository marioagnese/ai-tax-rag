// i18n/request.ts
import { getRequestConfig } from "next-intl/server";

const SUPPORTED = new Set(["en", "es", "pt"]);
const DEFAULT_LOCALE = "en";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale =
    typeof requested === "string" && SUPPORTED.has(requested)
      ? requested
      : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});