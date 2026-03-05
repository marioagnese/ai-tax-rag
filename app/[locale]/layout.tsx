// app/[locale]/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";

export const metadata: Metadata = {
  title: "TaxAiPro",
  description: "AI-powered international tax research assistant",
};

async function resolveLocale(params: any): Promise<string> {
  // Handles either: params = { locale: "en" } OR params = Promise<{ locale: "en" }>
  const p = params && typeof params?.then === "function" ? await params : params;
  const locale = typeof p?.locale === "string" ? p.locale : "en";
  return locale;
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: any; // <- avoids Next/Turbopack type mismatch
}) {
  const locale = await resolveLocale(params);

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}