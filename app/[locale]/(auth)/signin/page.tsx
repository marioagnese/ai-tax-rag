"use client";

import React, { useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";

type Locale = "en" | "es" | "pt";

const COPY: Record<Locale, any> = {
  en: {
    headline: "Don’t trust a single AI answer on tax questions.",
    sub: "See what happens when models disagree — and what they miss.",
    cta: "Run your own crosscheck →",
    login: "Log in",
    prompt: "What are the taxes in Brazil?",
    taxaipro: "TaxAiPro Crosscheck™",
  },
  es: {
    headline: "No confíes en una sola respuesta de IA.",
    sub: "Descubre lo que los modelos no te dicen.",
    cta: "Probar análisis →",
    login: "Entrar",
    prompt: "¿Cuáles son los impuestos en Brasil?",
    taxaipro: "Análisis TaxAiPro™",
  },
  pt: {
    headline: "Não confie em uma única resposta de IA.",
    sub: "Veja o que os modelos ignoram.",
    cta: "Testar análise →",
    login: "Entrar",
    prompt: "Quais são os impostos no Brasil?",
    taxaipro: "Análise TaxAiPro™",
  },
};

function InteractiveDemo() {
  const [step, setStep] = useState(0);

  const runDemo = () => {
    setStep(0);
    setTimeout(() => setStep(1), 800);
    setTimeout(() => setStep(2), 2000);
    setTimeout(() => setStep(3), 3500);
    setTimeout(() => setStep(4), 5000);
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-black/50 p-6 backdrop-blur-md">

      {/* Input */}
      <div className="flex gap-2">
        <input
          defaultValue="What are the taxes in Brazil?"
          className="flex-1 rounded-xl bg-black/60 px-4 py-2 text-white"
        />
        <button
          onClick={runDemo}
          className="rounded-xl bg-white px-4 py-2 text-black font-medium"
        >
          Run
        </button>
      </div>

      {/* Flow */}
      <div className="mt-6 space-y-3 text-sm">

        {step >= 1 && (
          <div className="rounded-xl bg-white/5 p-3 animate-fadeIn">
            🤖 GPT: Brazil corporate tax is ~34%
          </div>
        )}

        {step >= 2 && (
          <div className="rounded-xl bg-white/5 p-3 animate-fadeIn">
            🤖 Claude: Depends on tax regime and entity type
          </div>
        )}

        {step >= 2 && (
          <div className="rounded-xl bg-white/5 p-3 animate-fadeIn">
            🤖 Perplexity: Federal, state, and municipal taxes apply
          </div>
        )}

        {step >= 3 && (
          <div className="text-yellow-300 text-xs">
            Models miss key assumptions
          </div>
        )}

        {step >= 4 && (
          <div className="rounded-xl border border-white/20 bg-white/10 p-4 animate-fadeIn">
            <strong>TaxAiPro Crosscheck™</strong>
            <ul className="mt-2 space-y-1 text-white/80">
              <li>• Corporate rate alone is incomplete</li>
              <li>• Depends on regime (Real vs Presumido)</li>
              <li>• Missing facts: revenue, activity, jurisdiction</li>
            </ul>
          </div>
        )}
      </div>

      {step >= 4 && (
        <button className="mt-4 w-full rounded-xl bg-white px-4 py-2 text-black font-medium">
          Run your own analysis →
        </button>
      )}
    </div>
  );
}

export default function LandingPage() {
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
      className="relative min-h-screen text-white"
      style={{
        backgroundImage: `url("/landing-bg.png")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 bg-black/60" />

      {/* HEADER */}
      <header className="relative flex items-center justify-between px-6 pt-6">
        <Image src="/taxaipro-logo.png" alt="logo" width={160} height={40} />

        <button
          onClick={() => router.push(`/${locale}/signup?mode=login`)}
          className="rounded-xl border border-white/20 px-4 py-2 text-sm"
        >
          {copy.login}
        </button>
      </header>

      {/* HERO */}
      <main className="relative mx-auto max-w-6xl px-6 pt-20">
        <div className="grid gap-10 lg:grid-cols-2">

          {/* LEFT */}
          <div>
            <h1 className="text-4xl font-semibold leading-tight md:text-5xl">
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

            {/* SMALL VIDEO (reintroduced, but subtle) */}
            <div className="mt-6 rounded-2xl overflow-hidden border border-white/10">
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

          {/* RIGHT (INTERACTIVE DEMO) */}
          <InteractiveDemo />

        </div>
      </main>
    </div>
  );
}