"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { firebaseClientConfigured } from "@/src/lib/firebase/client";
import LanguageToggle from "../../components/LanguageToggle";

type Locale = "en" | "es" | "pt";

const COPY: Record<
  Locale,
  {
    pain: string;
    benefit1: string;
    benefit2: string;
    benefit3: string;
    authority: string;
    cta: string;
    login: string;
    watchDemo: string;
    demoCaption: string;
  }
> = {
  en: {
    pain: "Most AI tax answers miss assumptions, ignore key facts, or sound more certain than they should.",
    benefit1: "Cross-check multiple AI models instantly",
    benefit2: "Surface disagreements and missing facts",
    benefit3: "Generate conservative, audit-ready drafts",
    authority: "Built by an international tax executive with 20+ years experience.",
    cta: "Start free analysis",
    login: "Log in",
    watchDemo: "Watch demo",
    demoCaption: "See how professionals validate AI answers in seconds",
  },
  es: {
    pain: "Muchas respuestas fiscales de IA omiten supuestos, ignoran hechos clave o suenan más seguras de lo que deberían.",
    benefit1: "Compara múltiples modelos de IA al instante",
    benefit2: "Detecta diferencias y hechos faltantes",
    benefit3: "Genera borradores conservadores y listos para revisión",
    authority: "Desarrollado por un ejecutivo fiscal internacional con más de 20 años de experiencia.",
    cta: "Comenzar análisis gratis",
    login: "Iniciar sesión",
    watchDemo: "Ver demo",
    demoCaption: "Mira cómo los profesionales validan respuestas de IA en segundos",
  },
  pt: {
    pain: "Muitas respostas tributárias de IA ignoram premissas, deixam de lado fatos importantes ou parecem mais certas do que deveriam.",
    benefit1: "Compare vários modelos de IA instantaneamente",
    benefit2: "Identifique divergências e fatos faltantes",
    benefit3: "Gere rascunhos conservadores e prontos para revisão",
    authority: "Desenvolvido por um executivo tributário internacional com mais de 20 anos de experiência.",
    cta: "Começar análise grátis",
    login: "Entrar",
    watchDemo: "Ver demo",
    demoCaption: "Veja como profissionais validam respostas de IA em segundos",
  },
};

export default function SignInPage() {
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale =
    typeof params?.locale === "string" &&
    ["en", "es", "pt"].includes(params.locale)
      ? (params.locale as Locale)
      : "en";

  const t = useTranslations("auth.signin");
  const configured = useMemo(() => firebaseClientConfigured(), []);
  const [demoOpen, setDemoOpen] = useState(false);

  const copy = COPY[locale];

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDemoOpen(false);
    }

    if (demoOpen) {
      window.addEventListener("keydown", onKeyDown);
      document.body.style.overflow = "hidden";
    }

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [demoOpen]);

  return (
    <div
      className="relative min-h-screen overflow-hidden text-white"
      style={{
        backgroundImage: `url("/landing-bg.png")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="absolute inset-0 bg-black/40" />

      {demoOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
          onClick={() => setDemoOpen(false)}
        >
          <div
            className="relative w-[92vw] max-w-[1100px] rounded-3xl border border-white/10 bg-[#0A0F1A] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setDemoOpen(false)}
              className="absolute right-4 top-4 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-sm text-white/80 hover:bg-white/10"
            >
              ✕
            </button>

            <video className="w-full rounded-2xl" controls autoPlay playsInline>
              <source src="/TaxAIProGuide.mp4" type="video/mp4" />
              {t("videoFallback")}
            </video>
          </div>
        </div>
      )}

      <header className="relative px-6 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="relative h-16 w-56">
            <Image
              src="/taxaipro-logo.png"
              alt="TaxAiPro™"
              fill
              priority
              className="object-contain"
            />
          </div>

          <div className="flex items-center gap-2">
            <LanguageToggle />

            <button
              onClick={() => router.push(`/${locale}/how-it-works`)}
              className="rounded-xl bg-black/90 px-4 py-2 text-xs text-white"
              title={t("howItWorksTitle")}
            >
              {t("howItWorks")}
            </button>

            <button
              onClick={() => router.push(`/${locale}/contact`)}
              className="rounded-xl bg-black/90 px-4 py-2 text-xs text-white"
            >
              {t("contact")}
            </button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-6 pt-16">
        <div className="grid items-stretch gap-10 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-black/50 p-8 backdrop-blur-md">
            <h1 className="text-4xl font-semibold leading-tight md:text-5xl">
              {t("headline")}
              <span className="block text-white/60">{t("subheadline")}</span>
            </h1>

            <p className="mt-4 text-sm text-red-300">{copy.pain}</p>

            <p className="mt-5 text-sm leading-relaxed text-white/80">
              {t("bodyPrefix")}{" "}
              <span className="font-semibold text-white">{t("bodyEmphasis")}</span>{" "}
              {t("bodySuffix")}
            </p>

            <ul className="mt-5 space-y-2 text-sm text-white/75">
              <li>• {copy.benefit1}</li>
              <li>• {copy.benefit2}</li>
              <li>• {copy.benefit3}</li>
            </ul>

            <div className="mt-5 text-sm text-white/70">{copy.authority}</div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                onClick={() => router.push(`/${locale}/signup`)}
                className="rounded-xl bg-white px-5 py-2 font-medium text-black hover:bg-white/90 disabled:opacity-50"
                disabled={!configured}
                title={!configured ? t("firebaseMissing") : ""}
              >
                {copy.cta}
              </button>

              <button
                onClick={() => setDemoOpen(true)}
                className="rounded-xl border border-white/20 px-5 py-2 text-white hover:bg-white/10"
                title={t("watchGuideTitle")}
              >
                {copy.watchDemo}
              </button>

              <button
                onClick={() => router.push(`/${locale}/signup?mode=login#login`)}
                className="rounded-xl border border-white/20 px-5 py-2 text-white hover:bg-white/10 disabled:opacity-50"
                disabled={!configured}
                title={!configured ? t("firebaseMissing") : ""}
              >
                {copy.login}
              </button>
            </div>

            <div className="mt-4 text-xs text-white/60">{t("disclaimer")}</div>
          </div>

          <div className="flex h-full flex-col rounded-3xl border border-white/10 bg-black/50 p-8 backdrop-blur-md">
            <p className="mb-4 text-center text-sm text-white/60">
              {copy.demoCaption}
            </p>

            <div className="flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
              <video
                className="h-full w-full object-cover"
                controls
                playsInline
              >
                <source src="/demo-60s.mp4" type="video/mp4" />
                {t("videoFallback")}
              </video>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}