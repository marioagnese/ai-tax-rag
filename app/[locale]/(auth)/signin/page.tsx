"use client";

import React from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import LanguageToggle from "../../components/LanguageToggle";

type Locale = "en" | "es" | "pt";

const COPY: Record<
  Locale,
  {
    headline: string;
    sub: string;
    cta: string;
    login: string;
    disclaimer: string;
    exampleWarning: string;
    taxaiproTitle: string;
    taxaiproLines: string[];
  }
> = {
  en: {
    headline: "Don’t trust a single AI answer on tax questions.",
    sub: "TaxAiPro is not another AI. It cross-checks multiple models to detect missing assumptions, conflicts, and risk.",
    cta: "Start free analysis",
    login: "Log in",
    disclaimer:
      "TaxAiPro provides informational cross-checking support only. It does not provide legal or tax advice.",
    exampleWarning: "Models sound right — but miss key assumptions",
    taxaiproTitle: "TaxAiPro",
    taxaiproLines: [
      '“34%” is incomplete and can mislead decisions',
      "Outcome depends on tax regime (Real vs Presumido)",
      "Missing: revenue, activity, jurisdiction",
      "Answer is not reliable without more facts",
    ],
  },
  es: {
    headline: "No confíes en una sola respuesta de IA para temas fiscales.",
    sub: "TaxAiPro no es otra IA. Compara múltiples modelos para detectar supuestos faltantes, conflictos y riesgo.",
    cta: "Comenzar análisis gratis",
    login: "Iniciar sesión",
    disclaimer:
      "TaxAiPro solo ofrece apoyo informativo de validación cruzada. No brinda asesoría legal ni fiscal.",
    exampleWarning: "Los modelos suenan correctos, pero omiten supuestos clave",
    taxaiproTitle: "TaxAiPro",
    taxaiproLines: [
      '“34%” es incompleto y puede inducir a error',
      "El resultado depende del régimen fiscal",
      "Faltan datos: ingresos, actividad, jurisdicción",
      "La respuesta no es confiable sin más hechos",
    ],
  },
  pt: {
    headline: "Não confie em apenas uma resposta de IA para questões tributárias.",
    sub: "TaxAiPro não é outra IA. Ele cruza múltiplos modelos para detectar premissas faltantes, conflitos e risco.",
    cta: "Começar análise grátis",
    login: "Entrar",
    disclaimer:
      "O TaxAiPro oferece apenas apoio informativo de validação cruzada. Não fornece aconselhamento jurídico ou tributário.",
    exampleWarning: "Os modelos parecem corretos, mas ignoram premissas importantes",
    taxaiproTitle: "TaxAiPro",
    taxaiproLines: [
      '“34%” é incompleto e pode induzir a erro',
      "O resultado depende do regime tributário",
      "Faltam dados: receita, atividade, jurisdição",
      "A resposta não é confiável sem mais fatos",
    ],
  },
};

const MODEL_RESPONSES: Record<
  Locale,
  Array<{ name: string; logo: string; text: string }>
> = {
  en: [
    {
      name: "OpenAI",
      logo: "/openai-logo.png",
      text: "Brazil corporate tax is 34%",
    },
    {
      name: "Claude",
      logo: "/claude-logo.png",
      text: "Depends on regime and company type",
    },
    {
      name: "Perplexity",
      logo: "/perplexity-logo.png",
      text: "Federal + state taxes may apply",
    },
  ],
  es: [
    {
      name: "OpenAI",
      logo: "/openai-logo.png",
      text: "El impuesto corporativo en Brasil es 34%",
    },
    {
      name: "Claude",
      logo: "/claude-logo.png",
      text: "Depende del régimen y del tipo de empresa",
    },
    {
      name: "Perplexity",
      logo: "/perplexity-logo.png",
      text: "Pueden aplicar impuestos federales y estatales",
    },
  ],
  pt: [
    {
      name: "OpenAI",
      logo: "/openai-logo.png",
      text: "O imposto corporativo no Brasil é 34%",
    },
    {
      name: "Claude",
      logo: "/claude-logo.png",
      text: "Depende do regime e do tipo de empresa",
    },
    {
      name: "Perplexity",
      logo: "/perplexity-logo.png",
      text: "Tributos federais e estaduais podem se aplicar",
    },
  ],
};

function ModelRow({
  logo,
  name,
  text,
}: {
  logo: string;
  name: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3">
      <div className="relative mt-0.5 h-5 w-5 shrink-0 overflow-hidden rounded-full bg-white">
        <Image
          src={logo}
          alt={name}
          fill
          className="object-contain p-0.5"
          sizes="20px"
        />
      </div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">
          {name}
        </div>
        <div className="text-sm leading-6 text-white/78">{text}</div>
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
  const modelResponses = MODEL_RESPONSES[locale];

  return (
    <div
      className="min-h-screen text-white"
      style={{
        backgroundImage: `url("/landing-bg.png")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="absolute inset-0 bg-black/72" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-6">
        <header className="mb-8 flex items-center justify-between gap-4">
          <Image src="/taxaipro-logo.png" alt="TaxAiPro" width={160} height={40} />

          <div className="flex items-center gap-3">
            <LanguageToggle />
            <button
              onClick={() => router.push(`/${locale}/signup?mode=login#login`)}
              className="text-sm text-white/80 transition hover:text-white"
            >
              {copy.login}
            </button>
            <button
              onClick={() => router.push(`/${locale}/signup`)}
              className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-white/90"
            >
              {copy.cta}
            </button>
          </div>
        </header>

        <main className="grid flex-1 items-center gap-8 lg:grid-cols-[0.95fr_1.05fr]">
          <section>
            <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight lg:text-5xl">
              {copy.headline}
            </h1>

            <p className="mt-4 max-w-xl text-base leading-7 text-white/74">
              {copy.sub}
            </p>

            <div className="mt-6 w-full max-w-[300px] overflow-hidden rounded-2xl border border-white/10 bg-black/30 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
              <video
                src="/demo-60s.mp4"
                autoPlay
                muted
                loop
                playsInline
                className="aspect-square w-full object-cover"
              />
            </div>

            <p className="mt-5 max-w-xl text-xs leading-6 text-white/52">
              {copy.disclaimer}
            </p>
          </section>

          <section className="rounded-3xl border border-white/10 bg-black/45 p-5 backdrop-blur-md">
            <div className="mb-4 rounded-2xl border border-white/10 bg-[#101B30] px-4 py-3">
              <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-white/38">
                Same prompt
              </div>
              <div className="text-base font-medium text-white/88">
                What are the taxes in Brazil?
              </div>
            </div>

            <div className="space-y-3">
              {modelResponses.map((item) => (
                <ModelRow
                  key={item.name}
                  logo={item.logo}
                  name={item.name}
                  text={item.text}
                />
              ))}
            </div>

            <div className="mt-4 text-xs font-medium text-yellow-400">
              {copy.exampleWarning}
            </div>

            <div className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-4">
              <div className="mb-2 flex items-center gap-2">
                <div className="relative h-5 w-5 shrink-0 overflow-hidden rounded-full bg-white">
                  <Image
                    src="/taxaipro-logo.png"
                    alt="TaxAiPro"
                    fill
                    className="object-contain p-0.5"
                    sizes="20px"
                  />
                </div>
                <span className="text-sm font-medium text-emerald-200">
                  {copy.taxaiproTitle}
                </span>
              </div>

              <div className="space-y-1.5 text-sm leading-6 text-emerald-100/88">
                {copy.taxaiproLines.slice(0, 3).map((line) => (
                  <div key={line}>• {line}</div>
                ))}
                <div className="pt-1 font-medium">→ {copy.taxaiproLines[3]}</div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}