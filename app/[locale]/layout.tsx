import "./globals.css";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";

import LanguageToggle from "./components/LanguageToggle";

export const metadata: Metadata = {
  title: "TaxAiPro",
  description: "AI-powered international tax research assistant",
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Tell next-intl what locale this request is for
  setRequestLocale(locale);

  // Load messages for this request (src/i18n/request.ts)
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <div className="mx-auto max-w-7xl px-4 pt-4">
          <div className="flex justify-end">
            <LanguageToggle />
          </div>
        </div>

        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
