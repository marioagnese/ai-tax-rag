// app/[locale]/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";

import LanguageToggle from "./components/LanguageToggle";

export const metadata: Metadata = {
  title: "TaxAiPro",
  description: "AI-powered international tax research assistant",
};

async function resolveLocale(params: any): Promise<string> {
  const p = params && typeof params?.then === "function" ? await params : params;
  return typeof p?.locale === "string" ? p.locale : "en";
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: any;
}) {
  const locale = await resolveLocale(params);

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* Keep toggle inside provider so locale-aware client hooks work */}
          <div className="fixed right-6 top-20 z-50">
            <LanguageToggle />
          </div>

          {children}

          <footer
            style={{
              textAlign: "center",
              fontSize: 12,
              color: "#999",
              marginTop: 40,
              paddingBottom: 20,
            }}
          >
            TaxAiPro™ © 2026 Vendetta Global LLC. All rights reserved.
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}