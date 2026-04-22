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
    <div className="rounded-2xl border border-white/10 bg-black/50 p-5 space-y-4 text-sm">

      {/* AI RESPONSES */}
      <div className="space-y-3">

        <div className="flex items-start gap-2">
          <Image src="/gpt.png" alt="gpt" width={18} height={18} />
          <span className="text-white/70">
            “Brazil corporate tax is 34%”
          </span>
        </div>

        <div className="flex items-start gap-2">
          <Image src="/claude.png" alt="claude" width={18} height={18} />
          <span className="text-white/70">
            “Depends on regime and company type”
          </span>
        </div>

        <div className="flex items-start gap-2">
          <Image src="/perplexity.png" alt="perplexity" width={18} height={18} />
          <span className="text-white/70">
            “Federal + state taxes may apply”
          </span>
        </div>

      </div>

      {/* PROBLEM */}
      <div className="text-yellow-400 text-xs">
        Models sound right — but miss key assumptions
      </div>

      {/* TAXAIPRO ANSWER */}
      <div className="rounded-xl border border-white/20 bg-white/10 p-4">
        <strong>TaxAiPro</strong>
        <div className="mt-1 text-white/80 text-xs space-y-1">
          <div>• “34%” is incomplete and can mislead decisions</div>
          <div>• Outcome depends on tax regime (Real vs Presumido)</div>
          <div>• Missing: revenue, activity, jurisdiction</div>
          <div className="text-white font-medium pt-1">
            → Answer is not reliable without more facts
          </div>
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
        <div className="flex justify-between items-center mb-10">
          <Image src="/taxaipro-logo.png" alt="logo" width={160} height={40} />

          <div className="flex gap-4 items-center">
            <button
              onClick={() => router.push(`/${locale}/signup?mode=login`)}
              className="text-sm text-white/80"
            >
              {copy.login}
            </button>

            <button
              onClick={() => router.push(`/${locale}/signup`)}
              className="rounded-xl bg-white px-4 py-2 text-black text-sm font-medium"
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

            {/* VIDEO (BACK, BUT CONTROLLED) */}
            <div className="mt-6 rounded-xl overflow-hidden border border-white/10 max-w-sm">
              <video
                src="/demo-60s.mp4"
                autoPlay
                muted
                loop
                playsInline
                className="w-full"
              />
            </div>
          </div>

          {/* RIGHT */}
          <MiniDemo />

        </div>
      </div>
    </div>
  );
}