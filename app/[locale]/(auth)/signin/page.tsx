"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { firebaseClientConfigured } from "@/src/lib/firebase/client";
import LanguageToggle from "../../components/LanguageToggle";

type Locale = "en" | "es" | "pt";

const COPY: Record<Locale, any> = {
  en: {
    headline: "Don’t trust a single AI answer on tax questions.",
    sub: "TaxAiPro cross-checks multiple models and tells you when the answer is incomplete, risky, or needs refinement.",
    cta: "Try it free",
    login: "Log in",
    pricing: "Free · 5/day   Basic · 25/day   Premium · Unlimited",
    prompt: "What taxes apply in Brazil?",
    taxaipro: `This question is too broad to answer reliably without context.

As a starting point:

• Corporate operations: IRPJ, CSLL, PIS/COFINS, and potentially ICMS, ISS or IPI depending on the activity  
• Individuals / payroll: income tax and employment charges  
• Cross-border flows: withholding taxes depending on services, royalties or interest  

A safer approach is to first clarify whether the question relates to corporate income, indirect tax, payroll, or withholding before relying on a conclusion.`,
  },
};

const MODELS = [
  {
    name: "OpenAI",
    logo: "/openai-logo.png",
    text: "Brazil has federal, state and municipal taxes including corporate income tax and indirect taxes.",
  },
  {
    name: "Claude",
    logo: "/claude-logo.png",
    text: "Taxes may include income taxes, indirect taxes like ICMS/ISS, and payroll-related obligations.",
  },
  {
    name: "Perplexity",
    logo: "/perplexity-logo.png",
    text: "Main taxes include IRPJ, CSLL, PIS, COFINS, ICMS, ISS and social contributions.",
  },
  {
    name: "Gemini",
    logo: "/gemini-logo.png",
    text: "Brazil has multiple layers of taxation covering income, consumption and payroll.",
  },
];

function ModelCard({ model }: any) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0F1B2E] p-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="relative h-4 w-4">
          <Image src={model.logo} alt="" fill className="object-contain" />
        </div>
        <span className="text-xs text-white/70">{model.name}</span>
      </div>
      <p className="text-xs text-white/60 leading-5">{model.text}</p>
    </div>
  );
}

export default function SignInPage() {
  const router = useRouter();
  const params = useParams();
  const locale = "en";

  const configured = useMemo(() => firebaseClientConfigured(), []);
  const copy = COPY[locale];

  return (
    <div className="min-h-screen text-white bg-black relative">
      <div className="absolute inset-0 bg-gradient-to-b from-[#0B1220] to-black" />

      {/* HEADER */}
      <header className="relative flex justify-between items-center p-6">
        <div className="relative h-10 w-40">
          <Image src="/taxaipro-logo.png" alt="" fill className="object-contain" />
        </div>
        <LanguageToggle />
      </header>

      {/* HERO */}
      <main className="relative max-w-7xl mx-auto px-6 pt-10 pb-16 grid lg:grid-cols-2 gap-10">

        {/* LEFT */}
        <div>
          <h1 className="text-4xl md:text-5xl font-semibold leading-tight">
            {copy.headline}
          </h1>

          <p className="mt-4 text-white/70 text-lg">
            {copy.sub}
          </p>

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => router.push(`/en/signup`)}
              className="bg-white text-black px-5 py-2 rounded-xl"
            >
              {copy.cta}
            </button>

            <button
              onClick={() => router.push(`/en/signup?mode=login#login`)}
              className="border border-white/20 px-5 py-2 rounded-xl"
            >
              {copy.login}
            </button>
          </div>

          <div className="mt-4 text-xs text-white/50">
            {copy.pricing}
          </div>
        </div>

        {/* RIGHT */}
        <div className="space-y-4">

          {/* PROMPT */}
          <div className="bg-[#111827] p-4 rounded-xl border border-white/10">
            <div className="text-xs text-white/40 mb-1">Same prompt</div>
            <div className="text-sm">{copy.prompt}</div>
          </div>

          {/* MODELS */}
          <div className="grid grid-cols-2 gap-3">
            {MODELS.map((m) => (
              <ModelCard key={m.name} model={m} />
            ))}
          </div>

          {/* TAXAIPRO */}
          <div className="bg-emerald-500/10 border border-emerald-400/30 p-5 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <div className="relative h-5 w-5">
                <Image src="/taxaipro-logo.png" alt="" fill />
              </div>
              <span className="text-emerald-300 text-sm font-medium">
                TaxAiPro
              </span>
            </div>

            <p className="text-sm text-emerald-100/90 leading-6 whitespace-pre-line">
              {copy.taxaipro}
            </p>
          </div>

          {/* VIDEO (REINTRODUCED — SMALL + PREMIUM) */}
          <div className="rounded-xl overflow-hidden border border-white/10">
            <video className="w-full" controls playsInline>
              <source src="/demo-60s.mp4" type="video/mp4" />
            </video>
          </div>

        </div>
      </main>
    </div>
  );
}