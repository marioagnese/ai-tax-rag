import "./globals.css";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";

export const metadata: Metadata = {
  title: "TaxAiPro",
  description: "AI consensus and tax research workbench for professionals",
};

async function resolveLocale(params: any): Promise<string> {
  const p =
    params && typeof params?.then === "function" ? await params : params;

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
          {children}

          <footer
            style={{
              textAlign: "center",
              fontSize: 12,
              color: "rgba(255,255,255,0.32)",
              marginTop: 0,
              padding: "20px 16px 28px",
              background: "#07101d",
            }}
          >
            TaxAiPro™ © 2026 Vendetta Global LLC. All rights reserved.
          </footer>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}