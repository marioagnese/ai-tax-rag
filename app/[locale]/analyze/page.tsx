"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
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
    disagreements?: string[];
  };
  meta?: {
    attempted?: number;
    succeeded?: number;
    runtimeMs?: number | null;
  };
};

const COPY = {
  en: {
    back: "Back to homepage",
    eyebrow: "One free public analysis",
    title: "What tax issue are you researching?",
    subtitle:
      "Ask one tax question and receive a limited TaxAiPro consensus preview. No registration is required.",
    placeholder:
      "Example: Does a U.S. company purchasing goods FOB from Brazil create permanent establishment risk?",
    examples: [
      "Does a U.S. company purchasing goods FOB from Brazil create permanent establishment risk?",
      "What are the VAT consequences of exporting goods from Mexico?",
      "How are Brazilian CFC earnings treated for U.S. tax purposes?",
    ],
    submit: "Run free analysis",
    loading: "Building consensus",
    loadingBody:
      "TaxAiPro is comparing independent model positions and preparing a conservative preliminary synthesis.",
    result: "TaxAiPro consensus preview",
    confidence: "Confidence",
    models: "Models completed",
    caveats: "Important caveats",
    missingFacts: "Facts that should be confirmed",
    disagreements: "Areas requiring review",
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
    back: "Volver al inicio",
    eyebrow: "Un análisis público gratuito",
    title: "¿Qué asunto tributario estás investigando?",
    subtitle:
      "Formula una pregunta tributaria y recibe una vista previa limitada del consenso TaxAiPro. No se requiere registro.",
    placeholder:
      "Ejemplo: ¿Una empresa estadounidense que compra bienes FOB de Brasil crea riesgo de establecimiento permanente?",
    examples: [
      "¿Una empresa estadounidense que compra bienes FOB de Brasil crea riesgo de establecimiento permanente?",
      "¿Cuáles son las consecuencias de IVA al exportar bienes desde México?",
      "¿Cómo se tratan las utilidades CFC brasileñas para fines fiscales de EE. UU.?",
    ],
    submit: "Ejecutar análisis gratuito",
    loading: "Construyendo consenso",
    loadingBody:
      "TaxAiPro está comparando posiciones independientes y preparando una síntesis preliminar conservadora.",
    result: "Vista previa del consenso TaxAiPro",
    confidence: "Confianza",
    models: "Modelos completados",
    caveats: "Salvedades importantes",
    missingFacts: "Hechos que deben confirmarse",
    disagreements: "Áreas que requieren revisión",
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
    back: "Voltar à página inicial",
    eyebrow: "Uma análise pública gratuita",
    title: "Qual questão tributária você está pesquisando?",
    subtitle:
      "Faça uma pergunta tributária e receba uma prévia limitada do consenso TaxAiPro. Nenhum cadastro é necessário.",
    placeholder:
      "Exemplo: Uma empresa americana que compra mercadorias FOB do Brasil cria risco de estabelecimento permanente?",
    examples: [
      "Uma empresa americana que compra mercadorias FOB do Brasil cria risco de estabelecimento permanente?",
      "Quais são as consequências de IVA na exportação de mercadorias do México?",
      "Como os lucros de uma CFC brasileira são tratados para fins fiscais nos EUA?",
    ],
    submit: "Executar análise gratuita",
    loading: "Construindo consenso",
    loadingBody:
      "O TaxAiPro está comparando posições independentes e preparando uma síntese preliminar conservadora.",
    result: "Prévia do consenso TaxAiPro",
    confidence: "Confiança",
    models: "Modelos concluídos",
    caveats: "Ressalvas importantes",
    missingFacts: "Fatos que devem ser confirmados",
    disagreements: "Áreas que exigem revisão",
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

  const canSubmit = useMemo(
    () => question.trim().length > 0 && !loading,
    [question, loading]
  );

  async function runAnalysis() {
    const trimmed = question.trim();

    if (!trimmed || loading) return;

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
          throw new Error(c.limit);
        }

        throw new Error(
          data.error || "The analysis could not be completed."
        );
      }

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
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.12),transparent_36%)]" />

      <div className="relative mx-auto max-w-5xl px-5 py-8 sm:py-12">
        <Link
          href={`/${locale}`}
          className="inline-flex items-center gap-2 text-sm text-white/52 transition hover:text-white"
        >
          <ArrowLeft size={16} />
          {c.back}
        </Link>

        <section className="mx-auto mt-14 max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/8 px-3 py-1.5 text-xs font-medium text-cyan-200">
            <Sparkles size={14} />
            {c.eyebrow}
          </div>

          <h1 className="mt-6 text-4xl font-semibold tracking-[-0.04em] sm:text-6xl">
            {c.title}
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-white/56 sm:text-lg">
            {c.subtitle}
          </p>
        </section>

        <section className="mx-auto mt-10 max-w-3xl rounded-[28px] border border-white/12 bg-[#0a1626] p-4 shadow-2xl shadow-black/30 sm:p-6">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={c.placeholder}
            maxLength={2_000}
            className="min-h-[180px] w-full resize-none rounded-2xl border border-white/8 bg-[#07101d] p-4 text-sm leading-7 text-white/88 outline-none placeholder:text-white/28 focus:border-cyan-300/30 sm:text-base"
          />

          <div className="mt-3 flex justify-end text-xs text-white/30">
            {question.length}/2000
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {c.examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setQuestion(example)}
                className="rounded-full border border-white/9 bg-white/[0.03] px-3 py-2 text-left text-xs text-white/52 transition hover:bg-white/[0.07] hover:text-white/78"
              >
                {example}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={runAnalysis}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-3.5 text-sm font-semibold text-[#06101b] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-45"
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
          </button>
        </section>

        {loading ? (
          <section className="mx-auto mt-6 max-w-3xl rounded-2xl border border-white/10 bg-[#0a1626] p-5">
            <div className="flex items-start gap-4">
              <LoaderCircle className="mt-1 animate-spin text-cyan-300" />
              <div>
                <div className="font-semibold text-white/88">
                  {c.loading}
                </div>
                <div className="mt-2 text-sm leading-6 text-white/50">
                  {c.loadingBody}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              {[
                "Independent review",
                "Model comparison",
                "Consensus synthesis",
              ].map((label, index) => (
                <div
                  key={label}
                  className="flex items-center gap-2 rounded-xl border border-white/8 bg-[#07101d] px-3 py-3 text-xs text-white/55"
                >
                  {index === 0 ? (
                    <LoaderCircle
                      size={14}
                      className="animate-spin text-cyan-300"
                    />
                  ) : (
                    <Clock3 size={14} />
                  )}
                  {label}
                </div>
              ))}
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

              <DetailList
                title={c.disagreements}
                items={result.consensus.disagreements}
                warning
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
                <Link
                  href={`/${locale}/signup`}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-3.5 text-sm font-semibold text-[#06101b] transition hover:bg-cyan-200"
                >
                  {c.signup}
                  <ArrowRight size={17} />
                </Link>

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
