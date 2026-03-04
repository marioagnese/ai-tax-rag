import { getRequestConfig } from "next-intl/server";
import { notFound } from "next/navigation";

const SUPPORTED = ["en", "es", "pt"] as const;
type Locale = (typeof SUPPORTED)[number];

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = (await requestLocale) as Locale | undefined;

  if (!locale || !SUPPORTED.includes(locale)) notFound();

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
