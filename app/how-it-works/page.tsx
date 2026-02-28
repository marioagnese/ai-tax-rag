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
              Conservative tax triage drafts. Not legal or tax advice.
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
          <Card title="1) Basic flow">
            <ul className="list-disc pl-5 space-y-2">
              <li><b>Pick a jurisdiction</b> (and add treaty context in Facts if relevant).</li>
              <li><b>Paste Facts</b> as bullets (entities, flow, timing, thresholds).</li>
              <li><b>Run validation</b> to generate a conservative baseline answer.</li>
              <li><b>Save</b> if you want this run preserved in <b>History</b> (this device only).</li>
            </ul>
          </Card>

          <Card title="2) Follow-ups (how the thread works)">
            <ul className="list-disc pl-5 space-y-2">
              <li>Follow-up continues the same case using: <b>Original question + last consensus answer + your follow-up</b>.</li>
              <li>Follow-up is meant to refine assumptions, fill missing facts, and test deltas.</li>
              <li><b>Important:</b> the working thread is client-side. If you refresh or reset without saving, you can lose it.</li>
            </ul>
          </Card>

          <Card title="3) Saving + History (critical)">
            <ul className="list-disc pl-5 space-y-2">
              <li><b>History saves to localStorage</b> on this device/browser only (not synced).</li>
              <li>If you want to keep a baseline answer, <b>Save right after Run</b>.</li>
              <li>Starting a new question or running follow-ups will update the current “working” output state.</li>
              <li>If you need an export: switch Output style (Answer/Memo/Email) then <b>Copy</b> or <b>Download</b>.</li>
            </ul>
          </Card>

          <Card title="4) Plans + limits">
            <ul className="list-disc pl-5 space-y-2">
              <li>Tier affects daily run limits (Tier 2 is unlimited).</li>
              <li>After Stripe checkout, you’re redirected back and tier is synced.</li>
              <li>If you hit a limit, the app will prompt you to upgrade.</li>
            </ul>
          </Card>

          <Card title="5) What to be careful with">
            <ul className="list-disc pl-5 space-y-2">
              <li><b>Don’t paste sensitive data</b> (SSNs, account numbers, secrets).</li>
              <li>Model output can be wrong or incomplete—always validate with primary sources.</li>
              <li>If facts are missing, treat the output as a decision tree, not a conclusion.</li>
            </ul>
          </Card>

          <div className="rounded-2xl border border-white/10 bg-black/25 p-5 text-[11px] text-white/55">
            Tip: A good workflow is <b>Run → Paste missing facts → Run again → Save</b>.
          </div>
        </div>
      </div>
    </div>
  );
}
