"use client";

import Image from "next/image";
import Link from "next/link";
import PrimaryButton from "../../../components/ui/PrimaryButton";
import { trackEvent } from "../../../src/lib/analytics/ga";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  LockKeyhole,
  Scale,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

type Locale = "en" | "es" | "pt";

type AnalyzeResponse = {
  ok: boolean;
  error?: string;
  code?: string;
  consensus?: {
    answer?: string;
    confidence?: "low" | "medium" | "high";
    caveats?: string[];
    missingFacts?: string[];
  };
  meta?: {
    attempted?: number;
    succeeded?: number;
    runtimeMs?: number | null;
  };
};

const COPY = {
  en: {
    nav: {
      platform: "Platform",
      how: "How it works",
      pricing: "Pricing",
      enterprise: "Enterprise",
      signIn: "Sign in",
    },
    back: "TaxAiPro",
    eyebrow: "One complimentary consensus preview",
    title: "Ask your tax question.",
    subtitle:
      "TaxAiPro will challenge multiple AI models and prepare one conservative consensus. No registration required.",
    placeholder:
      "Example: Does a U.S. company purchasing goods FOB from Brazil create permanent establishment risk?",
    examples: [
      "Does a U.S. company purchasing goods FOB from Brazil create permanent establishment risk?",
      "What are the VAT consequences of exporting goods from Mexico?",
      "How are Brazilian CFC earnings treated for U.S. tax purposes?",
    ],
    submit: "Analyze my question",
    loading: "Building consensus",
    loadingBody:
      "TaxAiPro is comparing independent model positions and preparing a conservative preliminary synthesis.",
    result: "TaxAiPro consensus preview",
    confidence: "Confidence",
    models: "Models completed",
    caveats: "Important caveats",
    missingFacts: "Facts that should be confirmed",
    unlockTitle: "Continue in the full TaxAiPro Workbench",
    unlockBody:
      "Create a free account to access complete CrossCheck analysis, individual model outputs, follow-up questions, history, document upload, and professional memo generation.",
    signup: "Create free account",
    signin: "Sign in",
    notice:
      "This public preview is limited to one analysis per day and does not constitute legal or tax advice.",
    limit:
      "Your free public analysis has already been used today. Create an account to continue.",
  },

  es: {
    nav: {
      platform: "Plataforma",
      how: "Cómo funciona",
      pricing: "Precios",
      enterprise: "Empresas",
      signIn: "Ingresar",
    },
    back: "TaxAiPro",
    eyebrow: "Una vista previa de consenso gratuita",
    title: "Haz tu pregunta tributaria.",
    subtitle:
      "TaxAiPro comparará múltiples modelos de IA y preparará un consenso conservador. No se requiere registro.",
    placeholder:
      "Ejemplo: ¿Una empresa estadounidense que compra bienes FOB de Brasil crea riesgo de establecimiento permanente?",
    examples: [
      "¿Una empresa estadounidense que compra bienes FOB de Brasil crea riesgo de establecimiento permanente?",
      "¿Cuáles son las consecuencias de IVA al exportar bienes desde México?",
      "¿Cómo se tratan las utilidades CFC brasileñas para fines fiscales de EE. UU.?",
    ],
    submit: "Analizar mi pregunta",
    loading: "Construyendo consenso",
    loadingBody:
      "TaxAiPro está comparando posiciones independientes y preparando una síntesis preliminar conservadora.",
    result: "Vista previa del consenso TaxAiPro",
    confidence: "Confianza",
    models: "Modelos completados",
    caveats: "Salvedades importantes",
    missingFacts: "Hechos que deben confirmarse",
    unlockTitle: "Continúa en el TaxAiPro Workbench completo",
    unlockBody:
      "Crea una cuenta gratuita para acceder a CrossCheck completo, respuestas individuales, preguntas de seguimiento, historial, carga de documentos y memorandos profesionales.",
    signup: "Crear cuenta gratuita",
    signin: "Ingresar",
    notice:
      "Esta vista previa está limitada a un análisis diario y no constituye asesoría legal o tributaria.",
    limit:
      "Ya utilizaste tu análisis público gratuito de hoy. Crea una cuenta para continuar.",
  },

  pt: {
    nav: {
      platform: "Plataforma",
      how: "Como funciona",
      pricing: "Planos",
      enterprise: "Empresas",
      signIn: "Entrar",
    },
    back: "TaxAiPro",
    eyebrow: "Uma prévia gratuita de consenso",
    title: "Faça sua pergunta tributária.",
    subtitle:
      "O TaxAiPro desafiará vários modelos de IA e preparará um consenso conservador. Nenhum cadastro é necessário.",
    placeholder:
      "Exemplo: Uma empresa americana que compra mercadorias FOB do Brasil cria risco de estabelecimento permanente?",
    examples: [
      "Uma empresa americana que compra mercadorias FOB do Brasil cria risco de estabelecimento permanente?",
      "Quais são as consequências de IVA na exportação de mercadorias do México?",
      "Como os lucros de uma CFC brasileira são tratados para fins fiscais nos EUA?",
    ],
    submit: "Analisar minha pergunta",
    loading: "Construindo consenso",
    loadingBody:
      "O TaxAiPro está comparando posições independentes e preparando uma síntese preliminar conservadora.",
    result: "Prévia do consenso TaxAiPro",
    confidence: "Confiança",
    models: "Modelos concluídos",
    caveats: "Ressalvas importantes",
    missingFacts: "Fatos que devem ser confirmados",
    unlockTitle: "Continue no TaxAiPro Workbench completo",
    unlockBody:
      "Crie uma conta gratuita para acessar CrossCheck completo, respostas individuais, perguntas de acompanhamento, histórico, documentos e memorandos profissionais.",
    signup: "Criar conta gratuita",
    signin: "Entrar",
    notice:
      "Esta prévia pública é limitada a uma análise por dia e não constitui aconselhamento jurídico ou tributário.",
    limit:
      "Você já utilizou sua análise pública gratuita de hoje. Crie uma conta para continuar.",
  },
};

function safeLocale(value: unknown): Locale {
  return value === "es" || value === "pt" ? value : "en";
}

function DetailList({
  title,
  items,
  warning = false,
}: {
  title: string;
  items?: string[];
  warning?: boolean;
}) {
  if (!items?.length) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#0a1626] p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-white/88">
        {warning ? (
          <TriangleAlert size={17} className="text-amber-300" />
        ) : (
          <CheckCircle2 size={17} className="text-cyan-300" />
        )}
        {title}
      </div>

      <ul className="mt-4 space-y-3">
        {items.map((item, index) => (
          <li
            key={`${title}-${index}`}
            className="flex gap-3 text-sm leading-6 text-white/62"
          >
            <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-white/35" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PublicAnalyzePage() {
  const params = useParams();
  const locale = safeLocale(params?.locale);
  const c = COPY[locale];

  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!loading) {
      setElapsedMs(0);
      return;
    }

    const startedAt = Date.now();

    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 100);

    return () => window.clearInterval(timer);
  }, [loading]);

  const canSubmit = useMemo(
    () => question.trim().length > 0 && !loading,
    [question, loading]
  );

  async function runAnalysis() {
    const trimmed = question.trim();

    if (!trimmed || loading) return;

    trackEvent("public_analysis_submitted", {
      locale,
      question_length: trimmed.length,
    });

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/public/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: trimmed,
          responseLanguage:
            locale === "pt"
              ? "Portuguese"
              : locale === "es"
              ? "Spanish"
              : "English",
        }),
      });

      const data = (await response.json()) as AnalyzeResponse;

      if (!response.ok || !data.ok) {
        if (
          response.status === 429 ||
          data.code === "PUBLIC_LIMIT_REACHED"
        ) {
          trackEvent("public_analysis_limit_reached", {
            locale,
          });

          throw new Error(c.limit);
        }

        throw new Error(
          data.error || "The analysis could not be completed."
        );
      }

      trackEvent("public_analysis_completed", {
        locale,
        confidence: data.consensus?.confidence,
        models_succeeded: data.meta?.succeeded,
        runtime_ms: data.meta?.runtimeMs ?? undefined,
      });

      setResult(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The analysis could not be completed."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#07101d] text-white">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[760px] bg-[radial-gradient(circle_at_20%_10%,rgba(24,172,196,0.18),transparent_34%),radial-gradient(circle_at_78%_12%,rgba(31,91,160,0.22),transparent_36%)]" />

      <header className="relative z-20 border-b border-white/8 bg-[#07101d]/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <Link
            href={`/${locale}`}
            className="flex items-center gap-3"
            aria-label="TaxAiPro home"
          >
            <Image
              src="/taxaipro-logo.png"
              alt="TaxAiPro"
              width={42}
              height={42}
              className="rounded-xl"
              priority
            />

            <div>
              <div className="text-lg font-semibold tracking-tight">
                TaxAiPro
              </div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-300/70">
                AI Tax Workbench
              </div>
            </div>
          </Link>

          <nav className="hidden items-center gap-7 text-sm text-white/68 lg:flex">
            <Link
              href={`/${locale}#platform`}
              className="transition hover:text-white"
            >
              {c.nav.platform}
            </Link>

            <Link
              href={`/${locale}/how-it-works`}
              className="transition hover:text-white"
            >
              {c.nav.how}
            </Link>

            <Link
              href={`/${locale}/plans`}
              className="transition hover:text-white"
            >
              {c.nav.pricing}
            </Link>

            <Link
              href={`/${locale}/corporate`}
              className="transition hover:text-white"
            >
              {c.nav.enterprise}
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              href={`/${locale}/signin`}
              className="rounded-xl border border-white/12 px-4 py-2.5 text-sm font-medium text-white/85 transition hover:bg-white/8 hover:text-white"
            >
              {c.nav.signIn}
            </Link>
          </div>
        </div>
      </header>

      <div className="relative mx-auto max-w-5xl px-5 py-8 sm:py-10">
        <section className="mx-auto mt-8 max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/8 px-3 py-1.5 text-xs font-medium text-cyan-200">
            <Sparkles size={14} />
            {c.eyebrow}
          </div>

          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">
            {c.title}
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-white/56 sm:text-lg">
            {c.subtitle}
          </p>
        </section>

        <section className="mx-auto mt-7 max-w-3xl rounded-[28px] border border-white/12 bg-[#0a1626] p-4 shadow-2xl shadow-black/30 sm:p-5">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={c.placeholder}
            maxLength={2_000}
            className="min-h-[145px] w-full resize-none rounded-2xl border border-white/8 bg-[#07101d] p-4 text-sm leading-7 text-white/88 outline-none placeholder:text-white/28 focus:border-cyan-300/30 sm:text-base"
          />

          <div className="mt-3 flex justify-end text-xs text-white/30">
            {question.length}/2000
          </div>

          <PrimaryButton
            type="button"
            onClick={runAnalysis}
            disabled={!canSubmit}
            className="mt-4 w-full"
          >
            {loading ? (
              <>
                <LoaderCircle size={17} className="animate-spin" />
                {c.loading}
              </>
            ) : (
              <>
                {c.submit}
                <ArrowRight size={17} />
              </>
            )}
          </PrimaryButton>

          <div className="mt-4 border-t border-white/8 pt-4">
            <div className="mb-3 text-center text-[10px] font-medium uppercase tracking-[0.18em] text-white/28">
              Independent model review
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              {["OpenAI", "Claude", "Gemini", "Grok", "DeepSeek"].map(
                (model) => (
                  <span
                    key={model}
                    className="rounded-full border border-white/8 bg-white/[0.025] px-3 py-1 text-[11px] text-white/38"
                  >
                    {model}
                  </span>
                )
              )}
            </div>
          </div>
        </section>

        {loading ? (
          <section className="mx-auto mt-6 max-w-3xl rounded-2xl border border-cyan-300/15 bg-[#0a1626] p-5 shadow-xl shadow-black/20">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <LoaderCircle className="mt-1 shrink-0 animate-spin text-cyan-300" />
                <div>
                  <div className="font-semibold text-white/88">
                    {c.loading}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-white/50">
                    {c.loadingBody}
                  </div>
                </div>
              </div>

              <div className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/60">
                {(elapsedMs / 1000).toFixed(1)}s
              </div>
            </div>

            <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/8">
              <div
                className="h-full rounded-full bg-cyan-300 transition-all duration-700"
                style={{
                  width:
                    elapsedMs < 5000
                      ? "28%"
                      : elapsedMs < 12000
                      ? "62%"
                      : "88%",
                }}
              />
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              {[
                {
                  label: "Independent model review",
                  active: elapsedMs < 5000,
                  complete: elapsedMs >= 5000,
                },
                {
                  label: "Comparing model positions",
                  active: elapsedMs >= 5000 && elapsedMs < 12000,
                  complete: elapsedMs >= 12000,
                },
                {
                  label: "Building TaxAiPro consensus",
                  active: elapsedMs >= 12000,
                  complete: false,
                },
              ].map((stage) => (
                <div
                  key={stage.label}
                  className="flex items-center gap-2 rounded-xl border border-white/8 bg-[#07101d] px-3 py-3 text-xs text-white/60"
                >
                  {stage.complete ? (
                    <Check
                      size={14}
                      className="shrink-0 text-emerald-300"
                    />
                  ) : stage.active ? (
                    <LoaderCircle
                      size={14}
                      className="shrink-0 animate-spin text-cyan-300"
                    />
                  ) : (
                    <Clock3
                      size={14}
                      className="shrink-0 text-white/32"
                    />
                  )}

                  {stage.label}
                </div>
              ))}
            </div>

            <div className="mt-4 text-center text-xs text-white/32">
              Complex cross-model analysis may take up to one minute.
            </div>
          </section>
        ) : null}

        {error ? (
          <section className="mx-auto mt-6 max-w-3xl rounded-2xl border border-red-300/20 bg-red-300/8 p-5 text-sm leading-6 text-red-100">
            <div className="flex items-start gap-3">
              <TriangleAlert
                size={18}
                className="mt-0.5 shrink-0"
              />
              <span>{error}</span>
            </div>
          </section>
        ) : null}

        {result?.ok && result.consensus ? (
          <section className="mx-auto mt-8 max-w-4xl">
            <div className="rounded-[28px] border border-cyan-300/18 bg-[#0a1626] p-5 shadow-2xl shadow-black/25 sm:p-7">
              <div className="flex flex-col gap-4 border-b border-white/8 pb-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
                    <ShieldCheck size={16} />
                    {c.result}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/65">
                    {c.confidence}:{" "}
                    <span className="font-semibold capitalize text-white">
                      {result.consensus.confidence}
                    </span>
                  </div>

                  <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/65">
                    {c.models}:{" "}
                    <span className="font-semibold text-white">
                      {result.meta?.succeeded || 0}/
                      {result.meta?.attempted || 0}
                    </span>
                  </div>

                  {result.meta?.runtimeMs ? (
                    <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/65">
                      Runtime:{" "}
                      <span className="font-semibold text-white">
                        {(result.meta.runtimeMs / 1000).toFixed(1)}s
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-6 whitespace-pre-wrap text-sm leading-7 text-white/74 sm:text-[15px]">
                {result.consensus.answer}
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <DetailList
                title={c.caveats}
                items={result.consensus.caveats}
                warning
              />

              <DetailList
                title={c.missingFacts}
                items={result.consensus.missingFacts}
              />
</div>

            <div className="mt-6 rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_90%_0%,rgba(34,211,238,0.12),transparent_35%),#0a1626] p-6 sm:p-8">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-300/10 text-cyan-200">
                <LockKeyhole size={20} />
              </div>

              <h2 className="mt-5 text-2xl font-semibold tracking-[-0.025em]">
                {c.unlockTitle}
              </h2>

              <p className="mt-3 max-w-2xl text-sm leading-7 text-white/52">
                {c.unlockBody}
              </p>

              <div className="mt-6 grid gap-2 text-sm text-white/66 sm:grid-cols-2">
                {[
                  "Complete consensus analysis",
                  "Individual model positions",
                  "Follow-up and refinement",
                  "Saved history and documents",
                  "Professional memo generation",
                  "Full CrossCheck workspace",
                ].map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-2"
                  >
                    <Check size={15} className="text-emerald-300" />
                    {item}
                  </div>
                ))}
              </div>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <PrimaryButton href={`/${locale}/signup`}>
                  {c.signup}
                  <ArrowRight size={17} />
                </PrimaryButton>

                <Link
                  href={`/${locale}/signin`}
                  className="inline-flex items-center justify-center rounded-xl border border-white/12 bg-white/[0.035] px-5 py-3.5 text-sm font-semibold text-white/82 transition hover:bg-white/[0.08]"
                >
                  {c.signin}
                </Link>
              </div>
            </div>
          </section>
        ) : null}

        <div className="mx-auto mt-8 max-w-3xl text-center text-xs leading-5 text-white/30">
          <Scale size={14} className="mr-1 inline" />
          {c.notice}
        </div>
      </div>
    </main>
  );
}
