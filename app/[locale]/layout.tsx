import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

import LanguageToggle from "./components/LanguageToggle";

export const metadata: Metadata = {
  title: "TaxAiPro",
  description: "AI-powered international tax research assistant"
};

export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const messages = await getMessages({ locale });

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <header className="w-full border-b border-white/10">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
              <div className="flex items-center gap-4">
                <Link href={`/${locale}`} className="font-semibold tracking-tight">
                  TaxAiPro
                </Link>

                <nav className="hidden items-center gap-3 text-sm opacity-90 md:flex">
                  <Link href={`/${locale}/crosscheck`} className="hover:underline">
                    Crosscheck
                  </Link>
                  <Link href={`/${locale}/corporate`} className="hover:underline">
                    Corporate
                  </Link>
                  <Link href={`/${locale}/plans`} className="hover:underline">
                    Plans
                  </Link>
                  <Link href={`/${locale}/contact`} className="hover:underline">
                    Contact
                  </Link>
                </nav>
              </div>

              <LanguageToggle />
            </div>
          </header>

          <main className="mx-auto w-full max-w-6xl px-4 py-6">{children}</main>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
