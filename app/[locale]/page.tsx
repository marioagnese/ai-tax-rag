import Image from "next/image";
import LanguageToggle from "./components/LanguageToggle";
import PrimaryButton from "../../components/ui/PrimaryButton";
import {
  ArrowRight,
  Check,
  FileText,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

type Locale = "en" | "es" | "pt";

type Copy = {
  nav: {
    platform: string;
    how: string;
    pricing: string;
    enterprise: string;
    signIn: string;
  };
  eyebrow: string;
  title1: string;
  title2: string;
  subtitle: string;
  primaryCta: string;
  secondaryCta: string;
  noCard: string;
  questionLabel: string;
  question: string;
  modelLabel: string;
  consensusLabel: string;
  consensusTitle: string;
  consensusBody: string;
  consensusItems: string[];
  whyTitle: string;
  whyBody: string;
  features: Array<{
    title: string;
    body: string;
  }>;
  workflowEyebrow: string;
  workflowTitle: string;
  workflowBody: string;
  steps: Array<{
    number: string;
    title: string;
    body: string;
  }>;
  finalTitle: string;
  finalBody: string;
  finalCta: string;
  disclaimer: string;
};

const COPY: Record<Locale, Copy> = {
  en: {
    nav: {
      platform: "Platform",
      how: "How it works",
      pricing: "Pricing",
      enterprise: "Enterprise",
      signIn: "Sign in",
    },
    eyebrow: "AI consensus for tax professionals",
    title1: "Don’t trust one AI.",
    title2: "Trust the consensus.",
    subtitle:
      "TaxAiPro cross-checks leading AI models, challenges conflicting answers, and produces a conservative tax research draft with assumptions, caveats, missing facts, and areas of agreement.",
    primaryCta: "Start a CrossCheck",
    secondaryCta: "See how it works",
    noCard: "Built for professional review—not blind reliance.",
    questionLabel: "Tax question",
    question:
      "What are the U.S. tax consequences of a Brazilian subsidiary distributing previously taxed earnings?",
    modelLabel: "Independent model analysis",
    consensusLabel: "TaxAiPro consensus",
    consensusTitle: "A reviewed synthesis—not another raw answer",
    consensusBody:
      "The models agree on the general treatment, but the conclusion depends on PTEP classification, currency gain or loss, basis, withholding, and the distribution ordering rules.",
    consensusItems: [
      "Core agreement identified",
      "Missing facts surfaced",
      "Conflicts and caveats isolated",
      "Conservative draft prepared",
    ],
    whyTitle: "Tax questions deserve more than one AI opinion.",
    whyBody:
      "Single-model answers can sound confident while omitting a decisive fact. TaxAiPro is designed to expose those gaps before you rely on the output.",
    features: [
      {
        title: "Research",
        body: "Analyze domestic and international tax questions in natural language.",
      },
      {
        title: "CrossCheck",
        body: "Compare multiple leading AI models through one controlled workflow.",
      },
      {
        title: "Consensus",
        body: "Separate agreement, disagreement, assumptions, caveats, and missing facts.",
      },
      {
        title: "Deliver",
        body: "Turn the analysis into a professional memo, email, or executive summary.",
      },
    ],
    workflowEyebrow: "A controlled professional workflow",
    workflowTitle: "From question to review-ready analysis.",
    workflowBody:
      "TaxAiPro does not replace professional judgment. It gives that judgment a stronger, more transparent starting point.",
    steps: [
      {
        number: "01",
        title: "Frame the issue",
        body: "Define the jurisdiction, relevant facts, and exact tax question.",
      },
      {
        number: "02",
        title: "Challenge the models",
        body: "Run independent analyses and identify where the outputs diverge.",
      },
      {
        number: "03",
        title: "Build consensus",
        body: "Synthesize the strongest common position and surface unresolved risk.",
      },
      {
        number: "04",
        title: "Review and deliver",
        body: "Refine the draft and export it into a usable professional format.",
      },
    ],
    finalTitle: "Research. Validate. Decide with confidence.",
    finalBody:
      "See what changes when tax AI is treated as a review process—not a single answer.",
    finalCta: "Open TaxAiPro",
    disclaimer:
      "TaxAiPro provides AI-assisted research and cross-checking support. It does not provide legal or tax advice, and all outputs require professional review.",
  },

  es: {
    nav: {
      platform: "Plataforma",
      how: "Cómo funciona",
      pricing: "Precios",
      enterprise: "Empresas",
      signIn: "Ingresar",
    },
    eyebrow: "Consenso de IA para profesionales tributarios",
    title1: "No confíes en una sola IA.",
    title2: "Confía en el consenso.",
    subtitle:
      "TaxAiPro compara los principales modelos de IA, cuestiona respuestas contradictorias y produce un borrador tributario conservador con premisas, salvedades, hechos faltantes y áreas de acuerdo.",
    primaryCta: "Iniciar CrossCheck",
    secondaryCta: "Ver cómo funciona",
    noCard: "Creado para revisión profesional, no para confianza ciega.",
    questionLabel: "Pregunta tributaria",
    question:
      "¿Cuáles son las consecuencias fiscales en EE. UU. de una distribución de utilidades previamente gravadas por una subsidiaria brasileña?",
    modelLabel: "Análisis independiente de modelos",
    consensusLabel: "Consenso TaxAiPro",
    consensusTitle: "Una síntesis revisada, no otra respuesta sin procesar",
    consensusBody:
      "Los modelos coinciden en el tratamiento general, pero la conclusión depende de la clasificación PTEP, ganancia o pérdida cambiaria, base fiscal, retención y reglas de orden de distribución.",
    consensusItems: [
      "Acuerdo central identificado",
      "Hechos faltantes detectados",
      "Conflictos y salvedades aislados",
      "Borrador conservador preparado",
    ],
    whyTitle: "Las preguntas tributarias merecen más de una opinión de IA.",
    whyBody:
      "Una respuesta de un solo modelo puede sonar segura y aun así omitir un hecho decisivo. TaxAiPro está diseñado para revelar esas brechas antes de que dependas del resultado.",
    features: [
      {
        title: "Investigar",
        body: "Analiza preguntas tributarias nacionales e internacionales en lenguaje natural.",
      },
      {
        title: "CrossCheck",
        body: "Compara varios modelos líderes de IA dentro de un flujo controlado.",
      },
      {
        title: "Consenso",
        body: "Separa acuerdos, desacuerdos, premisas, salvedades y hechos faltantes.",
      },
      {
        title: "Entregar",
        body: "Convierte el análisis en memorando, correo o resumen ejecutivo profesional.",
      },
    ],
    workflowEyebrow: "Un flujo profesional controlado",
    workflowTitle: "De la pregunta al análisis listo para revisión.",
    workflowBody:
      "TaxAiPro no reemplaza el juicio profesional. Le ofrece un punto de partida más sólido y transparente.",
    steps: [
      {
        number: "01",
        title: "Definir el asunto",
        body: "Establece jurisdicción, hechos relevantes y pregunta tributaria exacta.",
      },
      {
        number: "02",
        title: "Cuestionar los modelos",
        body: "Ejecuta análisis independientes e identifica dónde divergen.",
      },
      {
        number: "03",
        title: "Construir consenso",
        body: "Sintetiza la posición común más sólida y muestra el riesgo pendiente.",
      },
      {
        number: "04",
        title: "Revisar y entregar",
        body: "Refina el borrador y expórtalo a un formato profesional utilizable.",
      },
    ],
    finalTitle: "Investiga. Valida. Decide con confianza.",
    finalBody:
      "Descubre qué cambia cuando la IA tributaria se trata como un proceso de revisión, no como una sola respuesta.",
    finalCta: "Abrir TaxAiPro",
    disclaimer:
      "TaxAiPro ofrece apoyo de investigación y validación asistido por IA. No brinda asesoría legal o tributaria y todos los resultados requieren revisión profesional.",
  },

  pt: {
    nav: {
      platform: "Plataforma",
      how: "Como funciona",
      pricing: "Planos",
      enterprise: "Empresas",
      signIn: "Entrar",
    },
    eyebrow: "Consenso de IA para profissionais tributários",
    title1: "Não confie em uma única IA.",
    title2: "Confie no consenso.",
    subtitle:
      "O TaxAiPro cruza os principais modelos de IA, desafia respostas conflitantes e produz uma análise tributária conservadora com premissas, ressalvas, fatos ausentes e pontos de concordância.",
    primaryCta: "Iniciar CrossCheck",
    secondaryCta: "Ver como funciona",
    noCard: "Criado para revisão profissional, não para confiança cega.",
    questionLabel: "Questão tributária",
    question:
      "Quais são as consequências fiscais nos EUA de uma subsidiária brasileira distribuir lucros previamente tributados?",
    modelLabel: "Análise independente dos modelos",
    consensusLabel: "Consenso TaxAiPro",
    consensusTitle: "Uma síntese revisada, não apenas outra resposta bruta",
    consensusBody:
      "Os modelos concordam com o tratamento geral, mas a conclusão depende da classificação de PTEP, ganho ou perda cambial, basis, retenção e regras de ordenação da distribuição.",
    consensusItems: [
      "Concordância central identificada",
      "Fatos ausentes destacados",
      "Conflitos e ressalvas isolados",
      "Análise conservadora preparada",
    ],
    whyTitle: "Questões tributárias merecem mais de uma opinião de IA.",
    whyBody:
      "Uma resposta de modelo único pode parecer segura e ainda omitir um fato decisivo. O TaxAiPro foi criado para revelar essas lacunas antes que você confie no resultado.",
    features: [
      {
        title: "Pesquisar",
        body: "Analise questões tributárias domésticas e internacionais em linguagem natural.",
      },
      {
        title: "CrossCheck",
        body: "Compare vários modelos líderes de IA em um fluxo controlado.",
      },
      {
        title: "Consenso",
        body: "Separe concordâncias, divergências, premissas, ressalvas e fatos ausentes.",
      },
      {
        title: "Entregar",
        body: "Transforme a análise em memorando, e-mail ou resumo executivo profissional.",
      },
    ],
    workflowEyebrow: "Um fluxo profissional controlado",
    workflowTitle: "Da pergunta à análise pronta para revisão.",
    workflowBody:
      "O TaxAiPro não substitui o julgamento profissional. Ele oferece um ponto de partida mais sólido e transparente.",
    steps: [
      {
        number: "01",
        title: "Defina a questão",
        body: "Estabeleça a jurisdição, os fatos relevantes e a pergunta tributária exata.",
      },
      {
        number: "02",
        title: "Desafie os modelos",
        body: "Execute análises independentes e identifique onde elas divergem.",
      },
      {
        number: "03",
        title: "Construa o consenso",
        body: "Sintetize a posição comum mais forte e destaque os riscos pendentes.",
      },
      {
        number: "04",
        title: "Revise e entregue",
        body: "Refine o rascunho e exporte para um formato profissional utilizável.",
      },
    ],
    finalTitle: "Pesquise. Valide. Decida com confiança.",
    finalBody:
      "Veja o que muda quando a IA tributária é tratada como processo de revisão, não como uma única resposta.",
    finalCta: "Abrir TaxAiPro",
    disclaimer:
      "O TaxAiPro oferece suporte de pesquisa e validação assistido por IA. Não fornece aconselhamento jurídico ou tributário, e todos os resultados exigem revisão profissional.",
  },
};

const FEATURE_ICONS = [Search, Scale, ShieldCheck, FileText];

function safeLocale(value: string): Locale {
  return value === "es" || value === "pt" ? value : "en";
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: rawLocale } = await params;
  const locale = safeLocale(rawLocale);
  const c = COPY[locale];
  const base = `/${locale}`;

  return (
    <main className="min-h-screen overflow-hidden bg-[#07101d] text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[760px] bg-[radial-gradient(circle_at_20%_10%,rgba(24,172,196,0.18),transparent_34%),radial-gradient(circle_at_78%_12%,rgba(31,91,160,0.22),transparent_36%)]" />

      <header className="relative z-20 border-b border-white/8 bg-[#07101d]/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 lg:px-8">
          <a
            href={base}
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
          </a>

          <nav className="hidden items-center gap-7 text-sm text-white/68 lg:flex">
            <a href="#platform" className="transition hover:text-white">
              {c.nav.platform}
            </a>
            <a
              href={`${base}/how-it-works`}
              className="transition hover:text-white"
            >
              {c.nav.how}
            </a>
            <a
              href={`${base}/plans`}
              className="transition hover:text-white"
            >
              {c.nav.pricing}
            </a>
            <a
              href={`${base}/corporate`}
              className="transition hover:text-white"
            >
              {c.nav.enterprise}
            </a>
          </nav>

          <div className="flex items-center gap-2">
            <LanguageToggle className="hidden sm:inline-flex" />
            <a
              href={`${base}/signin`}
              className="rounded-xl border border-white/12 px-4 py-2.5 text-sm font-medium text-white/85 transition hover:bg-white/8 hover:text-white"
            >
              {c.nav.signIn}
            </a>
          </div>
        </div>
      </header>

      <section className="relative mx-auto grid max-w-7xl gap-14 px-5 pb-24 pt-20 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:px-8 lg:pb-32 lg:pt-28">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/8 px-3 py-1.5 text-xs font-medium text-cyan-200">
            <Sparkles size={14} />
            {c.eyebrow}
          </div>

          <h1 className="mt-7 max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-6xl lg:text-7xl">
            {c.title1}
            <br />
            <span className="bg-gradient-to-r from-cyan-200 via-sky-300 to-blue-300 bg-clip-text text-transparent">
              {c.title2}
            </span>
          </h1>

          <p className="mt-7 max-w-2xl text-lg leading-8 text-white/64">
            {c.subtitle}
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <PrimaryButton href={`${base}/analyze`}>
              {c.primaryCta}
              <ArrowRight size={17} />
            </PrimaryButton>

            <a
              href={`${base}/how-it-works`}
              className="inline-flex items-center justify-center rounded-xl border border-white/14 bg-white/[0.035] px-5 py-3.5 text-sm font-semibold text-white/88 transition hover:bg-white/8"
            >
              {c.secondaryCta}
            </a>
          </div>

          <div className="mt-5 flex items-center gap-2 text-xs text-white/42">
            <ShieldCheck size={15} className="text-cyan-300/70" />
            {c.noCard}
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-8 rounded-[40px] bg-cyan-300/7 blur-3xl" />

          <div className="relative rounded-[28px] border border-white/12 bg-[#0a1626]/92 p-4 shadow-2xl shadow-black/40 sm:p-6">
            <div className="flex items-center justify-between border-b border-white/8 pb-4">
              <div>
                <div className="text-sm font-semibold">CrossCheck</div>
                <div className="mt-0.5 text-xs text-white/38">
                  Multi-model tax analysis
                </div>
              </div>

              <div className="rounded-full border border-emerald-300/20 bg-emerald-300/8 px-2.5 py-1 text-[11px] text-emerald-200">
                6 models connected
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-white/8 bg-white/[0.025] p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/35">
                {c.questionLabel}
              </div>
              <div className="mt-2 text-sm leading-6 text-white/82">
                {c.question}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {["OpenAI", "Claude", "Gemini"].map((name, index) => (
                <div
                  key={name}
                  className="rounded-xl border border-white/8 bg-white/[0.025] p-3"
                >
                  <div className="flex items-center gap-2 text-[11px] text-white/65">
                    <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/8 text-[9px]">
                      {index + 1}
                    </span>
                    {name}
                  </div>

                  <div className="mt-3 space-y-1.5">
                    <div className="h-1.5 rounded-full bg-white/12" />
                    <div className="h-1.5 w-4/5 rounded-full bg-white/8" />
                    <div className="h-1.5 w-2/3 rounded-full bg-white/8" />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-2 text-center text-[10px] uppercase tracking-[0.16em] text-white/28">
              {c.modelLabel}
            </div>

            <div className="mt-5 rounded-2xl border border-cyan-300/22 bg-cyan-300/[0.065] p-5">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                <ShieldCheck size={14} />
                {c.consensusLabel}
              </div>

              <h2 className="mt-3 text-lg font-semibold text-white/94">
                {c.consensusTitle}
              </h2>

              <p className="mt-2 text-sm leading-6 text-white/60">
                {c.consensusBody}
              </p>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {c.consensusItems.map((item, index) => (
                  <div
                    key={item}
                    className="flex items-center gap-2 text-xs text-white/72"
                  >
                    {index === 2 ? (
                      <TriangleAlert size={14} className="text-amber-300" />
                    ) : (
                      <Check size={14} className="text-emerald-300" />
                    )}
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="platform"
        className="relative border-y border-white/8 bg-white/[0.018]"
      >
        <div className="mx-auto max-w-7xl px-5 py-24 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div>
              <h2 className="max-w-xl text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">
                {c.whyTitle}
              </h2>
            </div>

            <p className="max-w-2xl text-base leading-7 text-white/54 lg:justify-self-end">
              {c.whyBody}
            </p>
          </div>

          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {c.features.map((feature, index) => {
              const Icon = FEATURE_ICONS[index];

              return (
                <div
                  key={feature.title}
                  className="rounded-2xl border border-white/9 bg-[#0a1626] p-6 transition hover:-translate-y-1 hover:border-cyan-300/20"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-300/8 text-cyan-200">
                    <Icon size={19} />
                  </div>

                  <h3 className="mt-5 font-semibold">{feature.title}</h3>

                  <p className="mt-2 text-sm leading-6 text-white/48">
                    {feature.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-24 lg:px-8 lg:py-32">
        <div className="max-w-3xl">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/75">
            {c.workflowEyebrow}
          </div>

          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">
            {c.workflowTitle}
          </h2>

          <p className="mt-5 text-base leading-7 text-white/52">
            {c.workflowBody}
          </p>
        </div>

        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/8 md:grid-cols-2 lg:grid-cols-4">
          {c.steps.map((step) => (
            <div key={step.number} className="bg-[#07101d] p-7">
              <div className="text-xs font-semibold text-cyan-300/70">
                {step.number}
              </div>

              <h3 className="mt-8 text-lg font-semibold">{step.title}</h3>

              <p className="mt-3 text-sm leading-6 text-white/47">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-5 pb-20 lg:px-8">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-[30px] border border-cyan-300/15 bg-[radial-gradient(circle_at_85%_10%,rgba(34,211,238,0.16),transparent_30%),linear-gradient(135deg,#0b1b2e,#091423)] px-6 py-14 text-center sm:px-10 sm:py-20">
          <h2 className="text-3xl font-semibold tracking-[-0.035em] sm:text-5xl">
            {c.finalTitle}
          </h2>

          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-white/56">
            {c.finalBody}
          </p>

          <PrimaryButton
            href={`${base}/analyze`}
            className="mt-8"
          >
            {c.finalCta}
            <ArrowRight size={17} />
          </PrimaryButton>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-5 pb-8 text-center text-[11px] leading-5 text-white/30">
        {c.disclaimer}
      </div>
    </main>
  );
}