import {useTranslations} from "next-intl";

export const metadata = {
  title: "How it works — TaxAiPro",
};

function Card({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 backdrop-blur-sm">
      <div className="text-sm font-semibold text-white/90">{title}</div>
      <div className="mt-2 text-sm leading-relaxed text-white/75">{children}</div>
    </div>
  );
}

export default function HowItWorksPage() {
  const t = useTranslations("howItWorks");

  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute -top-48 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-[-220px] right-[-140px] h-[560px] w-[560px] rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-4xl px-4 py-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-2xl font-semibold text-white/95">{t("title")}</div>

            <div className="mt-2 text-sm text-white/60">{t("subtitle")}</div>

            <div className="mt-6 max-w-3xl space-y-4 text-sm leading-relaxed text-white/75">
              <p>{t("intro1")}</p>
              <p>{t("intro2")}</p>
              <p>{t("intro3")}</p>
              <p>{t("intro4")}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <a
              href="/crosscheck"
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-center text-xs text-white/85 transition hover:bg-white/10"
            >
              {t("backToCrosscheck")}
            </a>

            <a
              href="/TaxAIProGuide.mp4"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-center text-xs font-medium text-cyan-200 transition hover:bg-cyan-400/15"
            >
              {t("watchGuide")}
            </a>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-4">
          <Card title={t("cards.whyTitle")}>
            <ul className="list-disc space-y-2 pl-5">
              <li>{t("cards.why1")}</li>
              <li>{t("cards.why2")}</li>
              <li>{t("cards.why3")}</li>
              <li>{t("cards.why4")}</li>
              <li>{t("cards.why5")}</li>
            </ul>
          </Card>

          <Card title={t("cards.workflowTitle")}>
            <ul className="list-disc space-y-2 pl-5">
              <li>{t("cards.workflow1")}</li>
              <li>{t("cards.workflow2")}</li>
              <li>{t("cards.workflow3")}</li>
              <li>{t("cards.workflow4")}</li>
              <li>{t("cards.workflow5")}</li>
            </ul>
          </Card>

          <Card title={t("cards.parallelTitle")}>
            <p>{t("cards.parallelBody1")}</p>

            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>{t("cards.providers.openai")}</li>
              <li>{t("cards.providers.gemini")}</li>
              <li>{t("cards.providers.grok")}</li>
              <li>{t("cards.providers.perplexity")}</li>
              <li>{t("cards.providers.deepseek")}</li>
              <li>{t("cards.providers.claude")}</li>
            </ul>

            <p className="mt-3">{t("cards.parallelBody2")}</p>
          </Card>

          <Card title={t("cards.comparisonTitle")}>
            <ul className="list-disc space-y-2 pl-5">
              <li>{t("cards.comparison1")}</li>
              <li>{t("cards.comparison2")}</li>
              <li>{t("cards.comparison3")}</li>
              <li>{t("cards.comparison4")}</li>
              <li>{t("cards.comparison5")}</li>
            </ul>

            <p className="mt-3">{t("cards.comparisonBody")}</p>
          </Card>

          <Card title={t("cards.consensusTitle")}>
            <p>{t("cards.consensusBody")}</p>

            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>{t("cards.consensus1")}</li>
              <li>{t("cards.consensus2")}</li>
              <li>{t("cards.consensus3")}</li>
              <li>{t("cards.consensus4")}</li>
              <li>{t("cards.consensus5")}</li>
              <li>{t("cards.consensus6")}</li>
            </ul>
          </Card>

          <Card title={t("cards.toolsTitle")}>
            <ul className="list-disc space-y-2 pl-5">
              <li>{t("cards.tools1")}</li>
              <li>{t("cards.tools2")}</li>
              <li>{t("cards.tools3")}</li>
              <li>{t("cards.tools4")}</li>
            </ul>
          </Card>

          <Card title={t("cards.misunderstandingTitle")}>
            <p>{t("cards.misunderstanding1")}</p>
            <p className="mt-2">{t("cards.misunderstanding2")}</p>
            <p className="mt-2">{t("cards.misunderstanding3")}</p>
            <p className="mt-2">{t("cards.misunderstanding4")}</p>
          </Card>

          <Card title={t("guideCardTitle")}>
            <p>{t("guideCardBody")}</p>

            <div className="mt-4">
              <a
                href="/TaxAIProGuide.mp4"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10"
              >
                {t("openGuideVideo")}
              </a>
            </div>
          </Card>

          <div className="rounded-2xl border border-white/10 bg-black/25 p-5 text-[11px] text-white/55">
            {t("footerDisclaimer")}
          </div>
        </div>
      </div>
    </div>
  );
}
