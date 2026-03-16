export const metadata = {
  title: "How it works — TaxAiPro",
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 backdrop-blur-sm">
      <div className="text-sm font-semibold text-white/90">{title}</div>
      <div className="mt-2 text-sm leading-relaxed text-white/75">{children}</div>
    </div>
  );
}

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      {/* background glow */}
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute -top-48 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-[-220px] right-[-140px] h-[560px] w-[560px] rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-4xl px-4 py-10">
        {/* Header */}
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-2xl font-semibold text-white/95">How TaxAiPro Works</div>

            <div className="mt-2 text-sm text-white/60">
              Multi-model AI analysis designed for tax professionals.
            </div>

            <div className="mt-6 max-w-3xl space-y-4 text-sm leading-relaxed text-white/75">
              <p>
                TaxAiPro™ is a professional analysis tool designed to help tax practitioners evaluate
                complex tax questions using a <b>multi-model AI cross-analysis workflow</b>.
              </p>

              <p>
                Instead of relying on a single artificial intelligence system, TaxAiPro sends a
                user’s question to several leading AI models simultaneously, compares their
                responses, and generates a <b>conservative synthesized output</b>.
              </p>

              <p>
                The goal is not to replace professional judgment, but to help practitioners identify
                assumptions, surface missing facts, and detect areas of uncertainty faster.
              </p>

              <p>
                Importantly, <b>TaxAiPro is not its own Large Language Model</b>. The platform does
                not train or operate proprietary AI. Instead, it acts as an{" "}
                <b>analysis and orchestration layer</b> that compares outputs from multiple external
                AI systems.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:items-end">
            <a
              href="/crosscheck"
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-center text-xs text-white/85 transition hover:bg-white/10"
            >
              Back to Crosscheck
            </a>

            <a
              href="/TaxAIProGuide.mp4"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-center text-xs font-medium text-cyan-200 transition hover:bg-cyan-400/15"
            >
              Watch Product Guide
            </a>
          </div>
        </div>

        {/* Cards */}
        <div className="mt-10 grid grid-cols-1 gap-4">
          <Card title="1) Why Multi-Model Analysis">
            <ul className="list-disc space-y-2 pl-5">
              <li>Single AI systems can omit caveats or express excessive confidence.</li>
              <li>Different models may interpret the same facts differently.</li>
              <li>Running multiple systems creates a broader analytical perspective.</li>
              <li>Agreement between models may increase confidence.</li>
              <li>Disagreement highlights areas requiring professional review.</li>
            </ul>
          </Card>

          <Card title="2) Step-by-Step Workflow">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <b>Select the jurisdiction</b> relevant to the tax question.
              </li>
              <li>
                <b>Describe the facts</b> including entities, timing, and transaction structure.
              </li>
              <li>
                <b>Enter the specific tax question</b> to be analyzed.
              </li>
              <li>
                <b>Run analysis</b> which triggers multiple AI systems simultaneously.
              </li>
              <li>
                <b>Review the synthesized output</b> highlighting assumptions and caveats.
              </li>
            </ul>
          </Card>

          <Card title="3) Parallel AI Model Analysis">
            <p>
              TaxAiPro sends the prompt to multiple external AI providers. Each system
              independently generates an interpretation of the issue.
            </p>

            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>OpenAI</li>
              <li>Google Gemini</li>
              <li>Grok</li>
              <li>Perplexity</li>
              <li>DeepSeek</li>
            </ul>

            <p className="mt-3">
              TaxAiPro does not modify these answers initially. The responses are collected and
              prepared for cross-model comparison.
            </p>
          </Card>

          <Card title="4) Cross-Model Comparison">
            <ul className="list-disc space-y-2 pl-5">
              <li>Identify overlapping conclusions between models.</li>
              <li>Extract caveats or conditional reasoning.</li>
              <li>Highlight disagreements between models.</li>
              <li>Surface missing facts referenced by individual systems.</li>
              <li>Evaluate the consistency of reasoning across outputs.</li>
            </ul>

            <p className="mt-3">
              This comparison transforms several independent answers into a structured analytical
              view of the issue.
            </p>
          </Card>

          <Card title="5) Conservative Consensus Output">
            <p>
              After analyzing the model responses, TaxAiPro produces a{" "}
              <b>conservative synthesized draft</b>.
            </p>

            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>Bottom-line summary of likely outcomes</li>
              <li>Assumptions influencing the analysis</li>
              <li>Caveats identified across models</li>
              <li>Missing facts that may change the conclusion</li>
              <li>Areas where models disagree</li>
              <li>Confidence indicator based on cross-model alignment</li>
            </ul>
          </Card>

          <Card title="6) Professional Workflow Tools">
            <ul className="list-disc space-y-2 pl-5">
              <li>Export results as memo drafts or email summaries.</li>
              <li>Save runs for later review.</li>
              <li>Test alternative factual scenarios.</li>
              <li>Run follow-up analysis with additional facts.</li>
            </ul>
          </Card>

          <Card title="Common Misunderstanding">
            <p>
              Some users assume that TaxAiPro is a proprietary artificial intelligence model.
            </p>

            <p className="mt-2">
              In reality, TaxAiPro does <b>not train its own AI system</b> and does not “learn”
              from user questions in the way traditional machine learning models do.
            </p>

            <p className="mt-2">
              Instead, the platform functions as a <b>multi-model analysis and synthesis engine</b>{" "}
              that compares outputs from several external AI systems.
            </p>

            <p className="mt-2">
              Users are paying for structured cross-checking, conservative synthesis, and workflow
              tools designed specifically for tax professionals.
            </p>
          </Card>

          <Card title="Quick Product Walkthrough">
            <p>
              Prefer a visual overview? Open the short guide video for a quick walkthrough of the
              TaxAiPro workflow and user experience.
            </p>

            <div className="mt-4">
              <a
                href="/TaxAIProGuide.mp4"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/90 transition hover:bg-white/10"
              >
                Open TaxAiPro Guide Video
              </a>
            </div>
          </Card>

          <div className="rounded-2xl border border-white/10 bg-black/25 p-5 text-[11px] text-white/55">
            TaxAiPro is a decision-support tool and does not provide legal or tax advice. Always
            validate outputs using primary sources and professional judgment.
          </div>
        </div>
      </div>
    </div>
  );
}