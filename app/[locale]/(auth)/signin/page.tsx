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
    cta: string;
    login: string;
    watchDemo: string;
    pricing: string;
    demoCaption: string;
    promptLabel: string;
    prompt: string;
    taxaiproTitle: string;
    taxaiproText: string;
  }
> = {
  en: {
    badge: "Built for professionals who need to be right",
    headline: "Don’t trust a single AI answer on tax questions.",
    subheadline:
      "TaxAiPro cross-checks multiple AI models and flags when a question is too broad, incomplete, or risky to answer at face value.",
    cta: "Try it free",
    login: "Log in",
    watchDemo: "Watch demo",
    pricing: "Free · 5/day   Basic · 25/day   Premium · Unlimited",
    demoCaption: "See how TaxAiPro challenges broad tax questions before you rely on them",
    promptLabel: "Same prompt",
    prompt: "What taxes apply in Brazil?",
    taxaiproTitle: "TaxAiPro",
    taxaiproText:
      "This question is too broad to answer reliably without clarifying the taxpayer, transaction type, and tax category. A safer starting point is to separate corporate income tax, indirect taxes, payroll taxes, and withholding taxes before drawing conclusions.",
  },
  es: {
    badge: "Creado para profesionales que necesitan acertar",
    headline: "No confíes en una sola respuesta de IA para temas fiscales.",
    subheadline:
      "TaxAiPro compara múltiples modelos de IA y detecta cuando una pregunta es demasiado amplia, incompleta o riesgosa para responderla de forma directa.",
    cta: "Probar gratis",
    login: "Iniciar sesión",
    watchDemo: "Ver demo",
    pricing: "Gratis · 5/día   Basic · 25/día   Premium · Ilimitado",
    demoCaption: "Mira cómo TaxAiPro cuestiona preguntas fiscales amplias antes de que confíes en una respuesta",
    promptLabel: "Mismo prompt",
    prompt: "¿Qué impuestos aplican en Brasil?",
    taxaiproTitle: "TaxAiPro",
    taxaiproText:
      "Esta pregunta es demasiado amplia para responderse de forma fiable sin aclarar el tipo de contribuyente, la naturaleza de la transacción y la categoría tributaria. Un enfoque más seguro es separar impuesto corporativo, impuestos indirectos, nómina y retenciones antes de sacar conclusiones.",
  },
  pt: {
    badge: "Feito para profissionais que precisam acertar",
    headline: "Não confie em apenas uma resposta de IA para temas tributários.",
    subheadline:
      "O TaxAiPro cruza vários modelos de IA e identifica quando a pergunta é ampla demais, incompleta ou arriscada para ser respondida de forma direta.",
    cta: "Testar grátis",
    login: "Entrar",
    watchDemo: "Ver demo",
    pricing: "Grátis · 5/dia   Basic · 25/dia   Premium · Ilimitado",
    demoCaption: "Veja como o TaxAiPro questiona perguntas tributárias amplas antes que você confie na resposta",
    promptLabel: "Mesmo prompt",
    prompt: "Quais tributos se aplicam no Brasil?",
    taxaiproTitle: "TaxAiPro",
    taxaiproText:
      "Essa pergunta é ampla demais para ser respondida com segurança sem esclarecer o tipo de contribuinte, a natureza da operação e a categoria tributária envolvida. Um caminho mais seguro é separar imposto corporativo, tributos indiretos, folha e retenções antes de chegar a uma conclusão.",
  },
};

const MODEL_CARDS: Record<
  Locale,
  Array<{ name: string; logo: string; text: string }>
> = {
  en: [
    {
      name: "OpenAI",
      logo: "/openai-logo.png",
      text: "Brazil has federal, state, and municipal taxes, including corporate income tax, social contributions, VAT-like indirect taxes, and payroll-related charges.",
    },
    {
      name: "Claude",
      logo: "/claude-logo.png",
      text: "Taxes in Brazil may include corporate income taxes, indirect taxes such as ICMS and ISS, payroll taxes, and withholding taxes depending on the transaction.",
    },
    {
      name: "Perplexity",
      logo: "/perplexity-logo.png",
      text: "Main taxes in Brazil include IRPJ, CSLL, PIS, COFINS, ICMS, ISS, IPI, and social security contributions, depending on the taxpayer and activity.",
    },
    {
      name: "Gemini",
      logo: "/gemini-logo.png",
      text: "Brazil’s tax system includes federal, state, and local taxes, with common categories covering income, turnover, services, products, and payroll.",
    },
  ],
  es: [
    {
      name: "OpenAI",
      logo: "/openai-logo.png",
      text: "Brasil tiene impuestos federales, estatales y municipales, incluyendo impuesto corporativo, contribuciones sociales, impuestos indirectos y cargas sobre nómina.",
    },
    {
      name: "Claude",
      logo: "/claude-logo.png",
      text: "Los impuestos en Brasil pueden incluir impuesto sobre la renta corporativa, tributos indirectos como ICMS e ISS, impuestos sobre nómina y retenciones según la operación.",
    },
    {
      name: "Perplexity",
      logo: "/perplexity-logo.png",
      text: "Entre los principales impuestos están IRPJ, CSLL, PIS, COFINS, ICMS, ISS, IPI y contribuciones a la seguridad social, según el contribuyente y la actividad.",
    },
    {
      name: "Gemini",
      logo: "/gemini-logo.png",
      text: "El sistema tributario brasileño incluye impuestos federales, estatales y municipales sobre renta, operaciones, servicios, productos y nómina.",
    },
  ],
  pt: [
    {
      name: "OpenAI",
      logo: "/openai-logo.png",
      text: "O Brasil possui tributos federais, estaduais e municipais, incluindo imposto de renda corporativo, contribuições sociais, tributos indiretos e encargos sobre folha.",
    },
    {
      name: "Claude",
      logo: "/claude-logo.png",
      text: "Os tributos no Brasil podem incluir imposto sobre a renda da pessoa jurídica, tributos indiretos como ICMS e ISS, encargos sobre folha e retenções, dependendo da operação.",
    },
    {
      name: "Perplexity",
      logo: "/perplexity-logo.png",
      text: "Entre os principais tributos estão IRPJ, CSLL, PIS, COFINS, ICMS, ISS, IPI e contribuições previdenciárias, conforme o contribuinte e a atividade.",
    },
    {
      name: "Gemini",
      logo: "/gemini-logo.png",
      text: "O sistema tributário brasileiro inclui tributos federais, estaduais e municipais sobre renda, operações, serviços, produtos e folha.",
    },
  ],
};

function ModelCard({
  name,
  logo,
  text,
}: {
  name: string;
  logo: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0B162A] p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="relative h-5 w-5 overflow-hidden rounded-full bg-white">
          <Image src={logo} alt={name} fill className="object-contain p-0.5" />
        </div>
        <span className="text-sm font-medium text-white/86">{name}</span>
      </div>
      <p className="text-sm leading-6 text-white/66">{text}</p>
    </div>
  );
}

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
  const models = MODEL_CARDS[locale];

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
      <div className="absolute inset-0 bg-[#081120]/68" />
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
        <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-3xl border border-white/10 bg-black/45 p-8 backdrop-blur-md">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white/72">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              {copy.badge}
            </div>

            <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
              {copy.headline}
            </h1>

            <p className="mt-5 max-w-xl text-lg leading-8 text-white/74">
              {copy.subheadline}
            </p>

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

            <div className="mt-5 text-xs text-white/56">{copy.pricing}</div>
            <div className="mt-4 text-xs text-white/50">{t("disclaimer")}</div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/45 p-6 backdrop-blur-md">
            <div className="mb-4 text-sm text-white/62">{copy.demoCaption}</div>

            <div className="rounded-2xl border border-white/10 bg-[#101B30] p-4">
              <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/38">
                {copy.promptLabel}
              </div>
              <div className="text-base font-medium text-white/88">
                {copy.prompt}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {models.map((model) => (
                <ModelCard
                  key={model.name}
                  name={model.name}
                  logo={model.logo}
                  text={model.text}
                />
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-5">
              <div className="mb-2 flex items-center gap-2">
                <div className="relative h-5 w-5 overflow-hidden rounded-full bg-white">
                  <Image
                    src="/taxaipro-logo.png"
                    alt="TaxAiPro"
                    fill
                    className="object-contain p-0.5"
                  />
                </div>
                <span className="text-sm font-medium text-emerald-200">
                  {copy.taxaiproTitle}
                </span>
              </div>

              <p className="text-sm leading-7 text-emerald-100/88">
                {copy.taxaiproText}
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}