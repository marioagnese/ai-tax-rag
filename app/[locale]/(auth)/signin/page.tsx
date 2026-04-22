"use client";

import React from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";

type Locale = "en" | "es" | "pt";

const COPY: Record<Locale, any> = {
  en: {
    headline: "Don’t trust a single AI answer on tax questions.",
    sub: "TaxAiPro is not another AI. It cross-checks multiple models to detect missing assumptions, conflicts, and risk.",
    cta: "Start free analysis",
    login: "Log in",
  },
  es: { headline: "No confíes en una sola respuesta de IA.", sub: "", cta: "Probar", login: "Entrar" },
  pt: { headline: "Não confie em uma única resposta de IA.", sub: "", cta: "Testar", login: "Entrar" },
};

function MiniDemo() {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/50 p-4 space-y-3 text-sm">

      <div className="flex items-start gap-2 text-white/70">
        <span>🤖</span>
        <span>“Corporate tax is 34%”</span>
      </div>

      <div className="flex items-start gap-2 text-white/70">
        <span>🤖</span>
        <span>“Depends on regime”</span>
      </div>

      <div className="flex items-start gap-2 text-white/70">
        <span>🤖</span>
        <span>“Multiple taxes apply”</span>
      </div>

      <div className="text-yellow-400 text-xs">
        Models miss key assumptions
      </div>

      <div className="rounded-xl border border-white/20 bg-white/10 p-3">
        <strong>TaxAiPro</strong>
        <div className="text-white/80 text-xs mt-1">
          Flags missing facts and prevents incorrect conclusions.
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const router = useRouter();
  const params = useParams<{ locale?: string }>();

  const locale =
    typeof params?.locale === "string" &&
    ["en", "es", "pt"].includes(params.locale)
      ? (params.locale as Locale)
      : "en";

  const copy = COPY[locale];

  return (
    <div
      className="min-h-screen flex items-center justify-center text-white"
      style={{
        backgroundImage: `url("/landing-bg.png")`,
        backgroundSize: "cover",
      }}
    >
      <div className="absolute inset-0 bg-black/70" />

      <div className="relative w-full max-w-6xl px-6">

        {/* HEADER */}
        <div className="flex justify-between items-center mb-12">
          <Image src="/taxaipro-logo.png" alt="logo" width={160} height={40} />

          <div className="flex gap-3">
            <button
              onClick={() => router.push(`/${locale}/signup?mode=login`)}
              className="text-sm text-white/80"
            >
              {copy.login}
            </button>

            <button
              onClick={() => router.push(`/${locale}/signup`)}
              className="rounded-xl bg-white px-4 py-2 text-black text-sm"
            >
              {copy.cta}
            </button>
          </div>
        </div>

        {/* HERO */}
        <div className="grid lg:grid-cols-2 gap-10 items-center">

          {/* LEFT */}
          <div>
            <h1 className="text-4xl font-semibold leading-tight">
              {copy.headline}
            </h1>

            <p className="mt-4 text-white/70 text-sm">
              {copy.sub}
            </p>

            <button
              onClick={() => router.push(`/${locale}/signup`)}
              className="mt-6 rounded-xl bg-white px-6 py-3 text-black font-medium"
            >
              {copy.cta}
            </button>
          </div>

          {/* RIGHT */}
          <MiniDemo />

        </div>
      </div>
    </div>
  );
}