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
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute -top-48 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-[-220px] right-[-140px] h-[560px] w-[560px] rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-4xl px-4 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-2xl font-semibold text-white/95">How TaxAiPro works</div>
            <div className="mt-2 text-sm text-white/60">
              A conservative, multi-model workflow for tax triage and drafting. Not legal or tax advice.
            </div>

            <div className="mt-6 text-sm leading-relaxed text-white/75 max-w-3xl">
              Tax questions often depend on small facts, jurisdiction-specific rules, and exceptions. Single-model AI
              answers can be useful, but they may omit caveats or express undue confidence.
              <br />
              <br />
              TaxAiPro is designed to reduce uncertainty by running multiple leading language models in parallel,
              comparing their outputs, and producing one conservative consensus draft with explicit assumptions, caveats,
              and missing facts to validate.
            </div>
          </div>

          <a
            href="/crosscheck"
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
          >
            Back to Crosscheck
          </a>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4">
          <Card title="1) Purpose (what TaxAiPro is for)">
            <ul className="list-disc pl-5 space-y-2">
              <li>Drafts conservative tax triage outputs to help structure complex issues quickly.</li>
              <li>Surfaces assumptions, caveats, and missing facts so you can validate efficiently.</li>
              <li>Highlights areas of uncertainty when model outputs diverge.</li>
              <li>Supports structured refinement through follow-up analysis.</li>
            </ul>
          </Card>

          <Card title="2) Basic workflow">
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <b>Choose a jurisdiction.</b>
              </li>
              <li>
                <b>Ask a focused question.</b>
              </li>
              <li>
                <b>Add relevant facts</b> (entities, timing, transaction flow, thresholds).
              </li>
              <li>
                <b>Run validation</b> to generate a conservative consensus answer.
              </li>
              <li>Refine by adding missing facts and running follow-ups.</li>
            </ul>
          </Card>

          <Card title="3) Follow-ups (how the conversation works)">
            <ul className="list-disc pl-5 space-y-2">
              <li>Follow-ups continue the same case and build a structured thread, similar to a chat.</li>
              <li>Each follow-up uses the original question, prior consensus output, and your new input.</li>
              <li>Best use: test a change in facts, clarify ambiguity, or challenge an assumption.</li>
              <li>Keep follow-ups specific (e.g., “If X applies, does that change Y?”).</li>
            </ul>
          </Card>

          <Card title="4) Saving, history, and exports">
            <ul className="list-disc pl-5 space-y-2">
              <li>Your active conversation thread is automatically saved on this device while you are logged in.</li>
              <li>For privacy, the local thread is cleared upon logout.</li>
              <li>
                You may use <b>History</b> to preserve named or bookmarked cases on this device.
              </li>
              <li>
                To export: switch Output style (Answer / Memo / Email) and then <b>Copy</b> or <b>Download</b>.
              </li>
            </ul>
          </Card>

          <Card title="5) Plans and limits">
            <ul className="list-disc pl-5 space-y-2">
              <li>Plan tier determines daily run limits (Tier 2 offers unlimited runs).</li>
              <li>After Stripe checkout, you are redirected back and your tier is synced.</li>
              <li>If you reach a limit, the app will prompt you to upgrade.</li>
            </ul>
          </Card>

          <Card title="6) Data handling and limitations">
            <ul className="list-disc pl-5 space-y-2">
              <li>Do not paste sensitive data (SSNs, account numbers, credentials, confidential client data).</li>
              <li>Outputs may be incomplete or incorrect—always validate with primary sources or professional judgment.</li>
              <li>Where facts are missing, treat the output as a structured decision tree, not a final conclusion.</li>
            </ul>
          </Card>

          <div className="rounded-2xl border border-white/10 bg-black/25 p-5 text-[11px] text-white/55">
            Suggested workflow: <b>Run → review missing facts → add facts → re-run → export or save the case.</b>
          </div>
        </div>
      </div>
    </div>
  );
}