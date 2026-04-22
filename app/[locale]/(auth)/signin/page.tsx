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
    founderLine: string;
    videoLabel: string;
    taxaiproTitle: string;
    taxaiproLines: string[];
    prompt: string;
    modelResponses: Array<{ name: string; logo: string; text: string }>;
  }
> = {
  en: {
    headline: "Don’t trust a single AI answer on tax questions.",
    sub: "TaxAiPro is not another AI. It cross-checks multiple models to detect missing assumptions, conflicts, and risk.",
    cta: "Validate your answer now",
    login: "Log in",
    disclaimer:
      "TaxAiPro provides informational cross-checking support only. It does not provide legal or tax advice.",
    exampleWarning: "Models sound right — but miss key assumptions",
    founderLine: "[MA] Built from real international tax workflow experience",
    videoLabel: "Watch 60s demo",
    taxaiproTitle: "TaxAiPro",
    taxaiproLines: [
      '“34%” alone is incomplete and can mislead decisions',
      "Brazil tax analysis depends on regime, taxpayer type, and transaction",
      "Relevant buckets may include IRPJ, CSLL, PIS/COFINS, ICMS, ISS, IPI, and withholding depending on the facts",
      "This answer is unsafe to rely on without additional facts",
    ],
    prompt: "What are the taxes in Brazil?",
    modelResponses: [
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
  },
  es: {
    headline: "No confíes en una sola respuesta de IA para temas fiscales.",
    sub: "TaxAiPro no es otra IA. Compara múltiples modelos para detectar supuestos faltantes, conflictos y riesgo.",
    cta: "Valida tu respuesta ahora",
    login: "Iniciar sesión",
    disclaimer:
      "TaxAiPro solo ofrece apoyo informativo de validación cruzada. No brinda asesoría legal ni fiscal.",
    exampleWarning: "Los modelos suenan correctos, pero omiten supuestos clave",
    founderLine: "[MA] Basado en experiencia real de trabajo tributario internacional",
    videoLabel: "Ver demo de 60s",
    taxaiproTitle: "TaxAiPro",
    taxaiproLines: [
      '“34%” por sí solo es incompleto y puede inducir a error',
      "El análisis fiscal en Brasil depende del régimen, del tipo de contribuyente y de la transacción",
      "Los impuestos relevantes pueden incluir IRPJ, CSLL, PIS/COFINS, ICMS, ISS, IPI y retenciones según los hechos",
      "No es seguro confiar en esta respuesta sin hechos adicionales",
    ],
    prompt: "¿Qué impuestos aplican en Brasil?",
    modelResponses: [
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
  },
  pt: {
    headline: "Não confie em apenas uma resposta de IA para questões tributárias.",
    sub: "TaxAiPro não é outra IA. Ele cruza múltiplos modelos para detectar premissas faltantes, conflitos e risco.",
    cta: "Valide sua resposta agora",
    login: "Entrar",
    disclaimer:
      "O TaxAiPro oferece apenas apoio informativo de validação cruzada. Não fornece aconselhamento jurídico ou tributário.",
    exampleWarning: "Os modelos parecem corretos, mas ignoram premissas importantes",
    founderLine: "[MA] Construído com base em experiência real de trabalho tributário internacional",
    videoLabel: "Assistir demo de 60s",
    taxaiproTitle: "TaxAiPro",
    taxaiproLines: [
      '“34%” sozinho é incompleto e pode induzir a erro',
      "A análise tributária no Brasil depende do regime, do tipo de contribuinte e da operação",
      "Os tributos relevantes podem incluir IRPJ, CSLL, PIS/COFINS, ICMS, ISS, IPI e retenções conforme os fatos",
      "Não é seguro confiar nessa resposta sem fatos adicionais",
    ],
    prompt: "Quais tributos se aplicam no Brasil?",
    modelResponses: [
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
  },
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
    <div className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3 transition hover:bg-white/[0.05]">
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
            <div className="mb-4 inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/72">
              {copy.founderLine}
            </div>

            <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight lg:text-5xl">
              {copy.headline}
            </h1>

            <p className="mt-4 max-w-xl text-base leading-7 text-white/74">
              {copy.sub}
            </p>

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={() => router.push(`/${locale}/signup`)}
                className="rounded-xl bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-white/90"
              >
                {copy.cta}
              </button>
            </div>

            <div className="mt-6 w-full max-w-[300px] overflow-hidden rounded-2xl border border-white/10 bg-black/30 shadow-[0_16px_40px_rgba(0,0,0,0.28)]">
              <div className="border-b border-white/10 px-3 py-2 text-xs font-medium text-white/72">
                {copy.videoLabel}
              </div>
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
                {copy.prompt}
              </div>
            </div>

            <div className="space-y-3">
              {copy.modelResponses.map((item: { name: string; logo: string; text: string }) => (
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

            <div className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-4 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]">
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