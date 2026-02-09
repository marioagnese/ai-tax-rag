"use client";

import { useEffect, useMemo, useState } from "react";

type CrosscheckResponse = {
  ok: boolean;
  meta?: {
    attempted?: Array<{ provider: string; model: string }>;
    succeeded?: Array<{ provider: string; model: string }>;
    failed?: Array<{ provider: string; model: string }>;
    runtime_ms?: number;
  };
  consensus?: {
    answer?: string;
    caveats?: string[];
    followups?: string[];
    disagreements?: string[];
    confidence?: "low" | "medium" | "high";
  };
  providers?: Array<{
    provider: string;
    model: string;
    status: "ok" | "error" | "timeout";
    ms: number;
    text?: string;
    error?: string;
  }>;
  error?: string;
};

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-white/80">
      {children}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold tracking-wide text-white/60 uppercase">{children}</div>;
}

export default function CrosscheckPage() {
  const [jurisdiction, setJurisdiction] = useState("Panama");
  const [facts, setFacts] = useState("");
  const [constraints, setConstraints] = useState("Answer like a specialist. Be conservative. List assumptions + missing facts.");
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<CrosscheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const succeeded = resp?.meta?.succeeded ?? [];
  const failed = resp?.meta?.failed ?? [];
  const runtimeMs = resp?.meta?.runtime_ms ?? null;

  const providerBadges = useMemo(() => {
    const ok = succeeded.map(x => `${x.provider}:${x.model}`);
    const bad = failed.map(x => `${x.provider}:${x.model}`);
    return { ok, bad };
  }, [succeeded, failed]);

  async function run() {
    setError(null);
    setResp(null);

    const q = question.trim();
    if (!q) {
      setError("Type a question first.");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/ui/crosscheck", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jurisdiction: jurisdiction.trim() || undefined,
          facts: facts.trim() || undefined,
          constraints: constraints.trim() || undefined,
          question: q,
        }),
      });

      const text = await r.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = { ok: false, error: text };
      }

      if (!r.ok || json?.ok === false) {
        setResp(json);
        setError(json?.error || `Request failed (${r.status})`);
      } else {
        setResp(json);
      }
    } catch (e: any) {
      setError(e?.message || "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, facts, constraints, jurisdiction]);

  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center font-bold">
              AI
            </div>
            <div>
              <div className="text-sm font-semibold">Tax Crosscheck</div>
              <div className="text-xs text-white/60">Multi-model answer validation for fast, conservative tax triage</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Pill>⌘/Ctrl + Enter to run</Pill>
            {runtimeMs != null && <Pill>{runtimeMs}ms</Pill>}
            {resp?.consensus?.confidence && <Pill>Confidence: {resp.consensus.confidence}</Pill>}
          </div>
        </div>

        {/* Layout */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Left: Intake */}
          <div className="lg:col-span-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <SectionTitle>Intake</SectionTitle>

            <label className="mt-3 block text-xs text-white/70">Jurisdiction</label>
            <input
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/20"
              placeholder="e.g., Panama"
            />

            <label className="mt-3 block text-xs text-white/70">Facts</label>
            <textarea
              value={facts}
              onChange={(e) => setFacts(e.target.value)}
              className="mt-1 min-h-[160px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/20"
              placeholder="Paste deal facts. Bullet points OK."
            />

            <label className="mt-3 block text-xs text-white/70">Constraints</label>
            <textarea
              value={constraints}
              onChange={(e) => setConstraints(e.target.value)}
              className="mt-1 min-h-[120px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-white/20"
              placeholder="Tone, format, citation expectations..."
            />
          </div>

          {/* Center: Chat box */}
          <div className="lg:col-span-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <SectionTitle>Ask</SectionTitle>

            <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-3">
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="min-h-[140px] w-full resize-none bg-transparent text-sm outline-none"
                placeholder="Ask your tax question here…"
              />
              <div className="mt-3 flex items-center justify-between">
                <div className="text-xs text-white/50">
                  Tip: keep facts in the left panel; keep the question short and specific.
                </div>
                <button
                  onClick={run}
                  disabled={loading}
                  className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
                >
                  {loading ? "Running…" : "Crosscheck"}
                </button>
              </div>
            </div>

            {error && (
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
                {error}
              </div>
            )}

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
              <SectionTitle>Models</SectionTitle>
              <div className="mt-2 flex flex-wrap gap-2">
                {providerBadges.ok.map((x) => (
                  <span key={x} className="rounded-full bg-emerald-500/15 border border-emerald-500/25 px-2.5 py-1 text-xs text-emerald-100">
                    ✓ {x}
                  </span>
                ))}
                {providerBadges.bad.map((x) => (
                  <span key={x} className="rounded-full bg-amber-500/15 border border-amber-500/25 px-2.5 py-1 text-xs text-amber-100">
                    ! {x}
                  </span>
                ))}
                {!resp && <span className="text-xs text-white/50">Run once to see status.</span>}
              </div>
            </div>
          </div>

          {/* Right: Results */}
          <div className="lg:col-span-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <SectionTitle>Consensus</SectionTitle>

            <div className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="text-sm whitespace-pre-wrap leading-relaxed text-white/90">
                {resp?.consensus?.answer || "Your consensus answer will appear here."}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                <SectionTitle>Caveats</SectionTitle>
                <ul className="mt-2 list-disc pl-5 text-sm text-white/80 space-y-1">
                  {(resp?.consensus?.caveats ?? []).length ? (
                    (resp?.consensus?.caveats ?? []).map((c, i) => <li key={i}>{c}</li>)
                  ) : (
                    <li className="list-none text-white/50">None yet.</li>
                  )}
                </ul>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                <SectionTitle>Missing facts</SectionTitle>
                <ul className="mt-2 list-disc pl-5 text-sm text-white/80 space-y-1">
                  {(resp?.consensus?.followups ?? []).length ? (
                    (resp?.consensus?.followups ?? []).map((c, i) => <li key={i}>{c}</li>)
                  ) : (
                    <li className="list-none text-white/50">None yet.</li>
                  )}
                </ul>
              </div>
            </div>

            {resp?.providers?.length ? (
              <details className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                <summary className="cursor-pointer text-xs font-semibold tracking-wide text-white/70 uppercase">
                  Provider outputs
                </summary>
                <div className="mt-3 space-y-3">
                  {resp.providers.map((p, idx) => (
                    <div key={idx} className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-white/70">
                          <span className="font-semibold text-white/90">{p.provider}</span> · {p.model}
                        </div>
                        <div className="text-xs text-white/50">{p.ms}ms</div>
                      </div>
                      <div className="mt-2 text-sm whitespace-pre-wrap text-white/80">
                        {p.status === "ok" ? p.text : p.error}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
