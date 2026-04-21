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
    badge: string;
    headline: string;
    subheadline: string;
    pain: string;
    body: string;
    benefit1: string;
    benefit2: string;
    benefit3: string;
    authority: string;
    cta: string;
    login: string;
    watchDemo: string;
    demoCaption: string;
    exampleTitle: string;
    exampleQuestionLabel: string;
    exampleQuestion: string;
    exampleRiskTitle: string;
    exampleRiskBody: string;
    exampleOutputTitle: string;
    exampleOutputBody: string;
    pricingLine: string;
  }
> = {
  en: {
    badge: "Built for professionals who need to be right",
    headline: "Don’t trust a single AI answer on tax questions.",
    subheadline:
      "TaxAiPro cross-checks multiple AI models, surfaces disagreements, and returns a more conservative draft.",
    pain: "Most AI tax answers sound confident even when they miss key facts, collapse distinctions, or quietly disagree.",
    body:
      "In tax, false confidence is dangerous. TaxAiPro helps you review an answer before you rely on it.",
    benefit1: "Cross-check multiple AI models in one place",
    benefit2: "Spot disagreements and missing assumptions quickly",
    benefit3: "Generate conservative drafts designed for review",
    authority:
      "Built from real international tax workflow experience.",
    cta: "Try it free",
    login: "Log in",
    watchDemo: "See how it works",
    demoCaption: "Why relying on one AI answer can be risky",
    exampleTitle: "Example cross-check",
    exampleQuestionLabel: "Question",
    exampleQuestion:
      "Does a US company buying FOB from LATAM create PE risk or withholding exposure if support services are also performed locally?",
    exampleRiskTitle: "Why one-model answers can mislead",
    exampleRiskBody:
      "One model says no PE risk. Another says possible PE risk. A third says it depends on local functions. That difference matters.",
    exampleOutputTitle: "TaxAiPro output",
    exampleOutputBody:
      "Potential PE and withholding exposure may arise depending on the nature of local support functions, authority exercised locally, and whether activities go beyond preparatory or auxiliary support. A conservative review should isolate service scope, local personnel functions, and payment flows before relying on a low-risk conclusion.",
    pricingLine: "Free · 5 runs/day   Basic · 25/day   Premium · Unlimited",
  },
  es: {
    badge: "Creado para profesionales que necesitan acertar",
    headline: "No confíes en una sola respuesta de IA para temas fiscales.",
    subheadline:
      "TaxAiPro compara múltiples modelos de IA, muestra diferencias y devuelve un borrador más conservador.",
    pain: "Muchas respuestas fiscales de IA suenan seguras incluso cuando omiten hechos clave, simplifican demasiado o discrepan entre sí.",
    body:
      "En impuestos, la falsa seguridad es riesgosa. TaxAiPro te ayuda a revisar una respuesta antes de confiar en ella.",
    benefit1: "Compara múltiples modelos de IA en un solo lugar",
    benefit2: "Detecta diferencias y supuestos faltantes rápidamente",
    benefit3: "Genera borradores conservadores diseñados para revisión",
    authority:
      "Basado en experiencia real de trabajo tributario internacional.",
    cta: "Probar gratis",
    login: "Iniciar sesión",
    watchDemo: "Ver cómo funciona",
    demoCaption: "Por qué confiar en una sola respuesta de IA puede ser riesgoso",
    exampleTitle: "Ejemplo de validación cruzada",
    exampleQuestionLabel: "Pregunta",
    exampleQuestion:
      "¿Una empresa de EE. UU. que compra FOB desde LATAM genera riesgo de EP o de retención si también se prestan servicios de soporte localmente?",
    exampleRiskTitle: "Por qué una sola respuesta puede confundir",
    exampleRiskBody:
      "Un modelo dice que no hay riesgo de EP. Otro dice que sí puede existir. Un tercero dice que depende de las funciones locales. Esa diferencia importa.",
    exampleOutputTitle: "Salida de TaxAiPro",
    exampleOutputBody:
      "Puede existir exposición a establecimiento permanente y retención dependiendo de la naturaleza de las funciones de soporte locales, la autoridad ejercida localmente y si las actividades exceden funciones preparatorias o auxiliares. Una revisión conservadora debe aislar el alcance del servicio, las funciones del personal local y los flujos de pago antes de asumir una conclusión de bajo riesgo.",
    pricingLine: "Gratis · 5 análisis/día   Basic · 25/día   Premium · Ilimitado",
  },
  pt: {
    badge: "Feito para profissionais que precisam acertar",
    headline: "Não confie em apenas uma resposta de IA para temas tributários.",
    subheadline:
      "O TaxAiPro cruza vários modelos de IA, mostra divergências e entrega um rascunho mais conservador.",
    pain: "Muitas respostas tributárias de IA parecem confiantes mesmo quando ignoram fatos relevantes, simplificam demais ou divergem entre si.",
    body:
      "Em tributos, falsa confiança é arriscada. O TaxAiPro ajuda você a revisar uma resposta antes de confiar nela.",
    benefit1: "Compare vários modelos de IA em um só lugar",
    benefit2: "Identifique divergências e premissas faltantes rapidamente",
    benefit3: "Gere rascunhos conservadores feitos para revisão",
    authority:
      "Baseado em experiência real de trabalho tributário internacional.",
    cta: "Testar grátis",
    login: "Entrar",
    watchDemo: "Ver como funciona",
    demoCaption: "Por que confiar em apenas uma resposta de IA pode ser arriscado",
    exampleTitle: "Exemplo de cross-check",
    exampleQuestionLabel: "Pergunta",
    exampleQuestion:
      "Uma empresa dos EUA comprando FOB da América Latina gera risco de estabelecimento permanente ou retenção se serviços de suporte também forem prestados localmente?",
    exampleRiskTitle: "Por que uma única resposta pode induzir ao erro",
    exampleRiskBody:
      "Um modelo diz que não há risco de EP. Outro diz que pode haver. Um terceiro diz que depende das funções locais. Essa diferença importa.",
    exampleOutputTitle: "Saída do TaxAiPro",
    exampleOutputBody:
      "Pode haver exposição a estabelecimento permanente e retenção dependendo da natureza das funções locais de suporte, da autoridade exercida localmente e se as atividades excedem funções preparatórias ou auxiliares. Uma revisão conservadora deve isolar o escopo dos serviços, as funções da equipe local e os fluxos de pagamento antes de apoiar uma conclusão de baixo risco.",
    pricingLine: "Grátis · 5 análises/dia   Basic · 25/dia   Premium · Ilimitado",
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
      <div className="absolute inset-0 bg-[#081120]/65" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(39,91,255,0.18),transparent_35%)]" />

      {demoOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
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
              className="rounded-xl bg-black/80 px-4 py-2 text-xs text-white"
              title={t("howItWorksTitle")}
            >
              {t("howItWorks")}
            </button>

            <button
              onClick={() => router.push(`/${locale}/contact`)}
              className="rounded-xl bg-black/80 px-4 py-2 text-xs text-white"
            >
              {t("contact")}
            </button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-7xl px-6 pb-16 pt-14">
        <div className="grid items-stretch gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-3xl border border-white/10 bg-black/45 p-8 backdrop-blur-md">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white/72">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              {copy.badge}
            </div>

            <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
              {copy.headline}
            </h1>

            <p className="mt-5 max-w-2xl text-lg leading-8 text-white/74">
              {copy.subheadline}
            </p>

            <p className="mt-5 text-sm leading-7 text-red-300">
              {copy.pain}
            </p>

            <p className="mt-5 max-w-2xl text-sm leading-7 text-white/78">
              {copy.body}
            </p>

            <ul className="mt-6 space-y-2 text-sm text-white/78">
              <li>• {copy.benefit1}</li>
              <li>• {copy.benefit2}</li>
              <li>• {copy.benefit3}</li>
            </ul>

            <div className="mt-6 text-sm text-white/65">{copy.authority}</div>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button
                onClick={() => router.push(`/${locale}/signup`)}
                className="rounded-xl bg-white px-5 py-2.5 font-medium text-black hover:bg-white/90 disabled:opacity-50"
                disabled={!configured}
                title={!configured ? t("firebaseMissing") : ""}
              >
                {copy.cta}
              </button>

              <button
                onClick={() => setDemoOpen(true)}
                className="rounded-xl border border-white/20 px-5 py-2.5 text-white hover:bg-white/10"
                title={t("watchGuideTitle")}
              >
                {copy.watchDemo}
              </button>

              <button
                onClick={() => router.push(`/${locale}/signup?mode=login#login`)}
                className="rounded-xl border border-white/20 px-5 py-2.5 text-white hover:bg-white/10 disabled:opacity-50"
                disabled={!configured}
                title={!configured ? t("firebaseMissing") : ""}
              >
                {copy.login}
              </button>
            </div>

            <div className="mt-5 text-xs text-white/56">{copy.pricingLine}</div>
            <div className="mt-4 text-xs text-white/50">{t("disclaimer")}</div>
          </div>

          <div className="flex h-full flex-col rounded-3xl border border-white/10 bg-black/45 p-8 backdrop-blur-md">
            <p className="mb-5 text-center text-sm text-white/62">
              {copy.demoCaption}
            </p>

            <div className="rounded-2xl border border-white/10 bg-[#0B162A] p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-white/86">
                  {copy.exampleTitle}
                </div>
                <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs text-white/56">
                  Conservative output
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-white/38">
                  {copy.exampleQuestionLabel}
                </div>
                <div className="text-sm leading-7 text-white/84">
                  {copy.exampleQuestion}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 p-4">
                <div className="mb-1 text-sm font-medium text-red-200">
                  {copy.exampleRiskTitle}
                </div>
                <div className="text-sm leading-6 text-red-100/85">
                  {copy.exampleRiskBody}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                <div className="mb-1 text-sm font-medium text-emerald-200">
                  {copy.exampleOutputTitle}
                </div>
                <div className="text-sm leading-6 text-emerald-100/85">
                  {copy.exampleOutputBody}
                </div>
              </div>
            </div>

            <div className="mt-5 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
              <video className="h-full w-full object-cover" controls playsInline>
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