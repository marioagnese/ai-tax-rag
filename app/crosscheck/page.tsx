// app/crosscheck/page.tsx
"use client";

import React, { useMemo, useState } from "react";

type ProviderStatus = "ok" | "error" | "timeout";

type ProviderOutput = {
  provider: string;
  model: string;
  status: ProviderStatus;
  ms: number;
  text?: string;
  error?: string;
};

type CrosscheckResponse = {
  ok: boolean;
  meta: {
    attempted: { provider: string; model: string }[];
    succeeded: { provider: string; model: string }[];
    failed: { provider: string; model: string }[];
    runtime_ms: number;
  };
  consensus: {
    answer: string;
    caveats: string[];
    followups: string[];
    disagreements: string[];
    confidence: "low" | "medium" | "high";
  };
  providers: ProviderOutput[];
};

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const cls =
    tone === "good"
      ? "bg-emerald-500/10 text-emerald-200 ring-emerald-500/30"
      : tone === "warn"
      ? "bg-amber-500/10 text-amber-200 ring-amber-500/30"
      : tone === "bad"
      ? "bg-rose-500/10 text-rose-200 ring-rose-500/30"
      : "bg-white/5 text-white/80 ring-white/10";

  return (
    <span className={cx("inline-flex items-center rounded-full px-2 py-1 text-xs ring-1", cls)}>
      {children}
    </span>
  );
}

function Section({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-wide text-white/90">{title}</h3>
        {right}
      </div>
      <div className="text-sm text-white/80">{children}</div>
    </div>
  );
}

function Mono({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
      <div className="text-xs text-white/60">{label}</div>
      <div className="font-mono text-xs text-white/80">{value}</div>
    </div>
  );
}

export default function CrosscheckPage() {
  const [jurisdiction, setJurisdiction] = useState("Panama");
  const [question, setQuestion] = useState("");
  const [facts, setFacts] = useState("");
  const [constraints, setConstraints] = useState("Answer like a tax partner. Provide risks, assumptions, and what facts you need.");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [result, setResult] = useState<CrosscheckResponse | null>(null);

  // “Conversation strip” is just derived from last run.
  const transcript = useMemo(() => {
    if (!result) return [];
    const items: Array<{ role: "user" | "assistant"; text: string }> = [];
    items.push({
      role: "user",
      text: [jurisdiction ? `Jurisdiction: ${jurisdiction}` : "", question, facts ? `Facts:\n${facts}` : ""]
        .filter(Boolean)
        .join("\n\n"),
    });
    items.push({ role: "assistant", text: result.consensus.answer });
    return items;
  }, [result, jurisdiction, question, facts]);

  async function run() {
    setErr(null);
    setResult(null);

    const q = question.trim();
    if (!q) {
      setErr("Please enter a question.");
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch("/api/ui/crosscheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // keep payload consistent with backend schema
        body: JSON.stringify({
          jurisdiction: jurisdiction.trim() || undefined,
          question: q,
          facts: facts.trim() || undefined,
          constraints: constraints.trim() || undefined,
        }),
      });

      const text = await resp.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch {
        // if server returned HTML or text
        throw new Error(`Unexpected response: ${text.slice(0, 200)}`);
      }

      if (!resp.ok || !data?.ok) {
        const msg = data?.error || data?.message || `Request failed (HTTP ${resp.status})`;
        throw new Error(msg);
      }

      setResult(data as CrosscheckResponse);
    } catch (e: any) {
      setErr(e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const confidenceTone =
    result?.consensus.confidence === "high"
      ? "good"
      : result?.consensus.confidence === "medium"
      ? "warn"
      : "neutral";

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black text-white">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-white/5 ring-1 ring-white/10 grid place-items-center shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
              <span className="text-sm font-semibold">TX</span>
            </div>
            <div className="flex-1">
              <div className="text-lg font-semibold tracking-tight">Tax Crosscheck</div>
              <div className="text-sm text-white/60">
                Multi-model triangulation with conservative synthesis (fast triage + what we need next).
              </div>
            </div>
            {result ? (
              <div className="flex items-center gap-2">
                <Badge tone={confidenceTone as any}>Confidence: {result.consensus.confidence}</Badge>
                <Badge tone={result.ok ? "good" : "bad"}>{result.ok ? "OK" : "DEGRADED"}</Badge>
              </div>
            ) : null}
          </div>
        </div>

        {/* Layout: left “control desk”, right “conversation + panels” */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Left: Form */}
          <div className="lg:col-span-5">
            <div className="sticky top-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white/90">Input</h2>
                  <Badge>Crosscheck mode</Badge>
                </div>

                <label className="mb-2 block text-xs text-white/60">Jurisdiction</label>
                <input
                  value={jurisdiction}
                  onChange={(e) => setJurisdiction(e.target.value)}
                  placeholder="e.g., Panama"
                  className="mb-3 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/90 outline-none focus:ring-2 focus:ring-white/15"
                />

                <label className="mb-2 block text-xs text-white/60">Question</label>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask the tax question..."
                  rows={5}
                  className="mb-3 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/90 outline-none focus:ring-2 focus:ring-white/15"
                />

                <label className="mb-2 block text-xs text-white/60">Facts (scenario)</label>
                <textarea
                  value={facts}
                  onChange={(e) => setFacts(e.target.value)}
                  placeholder="Deal steps, title passage, Incoterms, parties, locations, timing..."
                  rows={6}
                  className="mb-3 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/90 outline-none focus:ring-2 focus:ring-white/15"
                />

                <label className="mb-2 block text-xs text-white/60">Constraints</label>
                <textarea
                  value={constraints}
                  onChange={(e) => setConstraints(e.target.value)}
                  placeholder="Style, depth, citations, language..."
                  rows={3}
                  className="mb-4 w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/90 outline-none focus:ring-2 focus:ring-white/15"
                />

                <button
                  onClick={run}
                  disabled={loading}
                  className={cx(
                    "w-full rounded-xl px-4 py-2 text-sm font-semibold shadow-[0_10px_30px_rgba(0,0,0,0.35)] ring-1 ring-white/10",
                    loading
                      ? "bg-white/10 text-white/60"
                      : "bg-white/10 hover:bg-white/15 text-white"
                  )}
                >
                  {loading ? "Crosschecking…" : "Run crosscheck"}
                </button>

                {err ? (
                  <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                    {err}
                  </div>
                ) : null}

                {result ? (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Mono label="Runtime (ms)" value={result.meta.runtime_ms} />
                    <Mono label="Providers OK" value={result.meta.succeeded.length} />
                    <Mono label="Providers tried" value={result.meta.attempted.length} />
                    <Mono label="Providers failed" value={result.meta.failed.length} />
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/60">
                    Tip: the best answers come from tight facts: Incoterms + title passage + who does what in-country.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Transcript + Results */}
          <div className="lg:col-span-7 space-y-4">
            {/* Conversation strip */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white/90">Thread</h2>
                <Badge tone="neutral">triangulated</Badge>
              </div>

              {!result ? (
                <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/60">
                  Ask a question on the left. You’ll get a “best conservative answer” plus missing facts, caveats, and provider deltas.
                </div>
              ) : (
                <div className="space-y-3">
                  {transcript.map((m, idx) => (
                    <div
                      key={idx}
                      className={cx(
                        "max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed ring-1",
                        m.role === "user"
                          ? "ml-auto bg-white/5 ring-white/10"
                          : "mr-auto bg-emerald-500/10 ring-emerald-500/20"
                      )}
                    >
                      <div className="mb-1 text-[11px] uppercase tracking-wide text-white/50">
                        {m.role === "user" ? "You" : "Crosscheck"}
                      </div>
                      <pre className="whitespace-pre-wrap font-sans text-white/85">{m.text}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Consensus */}
            {result ? (
              <Section
                title="Consensus"
                right={
                  <div className="flex items-center gap-2">
                    <Badge tone={confidenceTone as any}>{result.consensus.confidence}</Badge>
                    <Badge tone={result.meta.failed.length ? "warn" : "good"}>
                      {result.meta.failed.length ? `${result.meta.failed.length} failed` : "all good"}
                    </Badge>
                  </div>
                }
              >
                <pre className="whitespace-pre-wrap font-sans text-white/85">
                  {result.consensus.answer}
                </pre>
              </Section>
            ) : null}

            {/* Caveats + Followups */}
            {result ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Section title="Caveats">
                  {result.consensus.caveats?.length ? (
                    <ul className="list-disc space-y-2 pl-5">
                      {result.consensus.caveats.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-white/60">No caveats returned.</div>
                  )}
                </Section>

                <Section title="What I need from you">
                  {result.consensus.followups?.length ? (
                    <ul className="list-disc space-y-2 pl-5">
                      {result.consensus.followups.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-white/60">No followups returned.</div>
                  )}
                </Section>
              </div>
            ) : null}

            {/* Provider detail */}
            {result ? (
              <Section
                title="Provider details"
                right={<Badge tone="neutral">{result.providers.length} outputs</Badge>}
              >
                <div className="space-y-2">
                  {result.providers.map((p, i) => {
                    const tone =
                      p.status === "ok" ? "good" : p.status === "timeout" ? "warn" : "bad";
                    return (
                      <details
                        key={`${p.provider}:${p.model}:${i}`}
                        className="group rounded-xl border border-white/10 bg-black/25 p-3"
                      >
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Badge tone={tone as any}>{p.status.toUpperCase()}</Badge>
                            <div className="text-sm text-white/85">
                              <span className="font-semibold">{p.provider}</span>{" "}
                              <span className="text-white/50">·</span>{" "}
                              <span className="font-mono text-xs text-white/70">{p.model}</span>
                            </div>
                          </div>
                          <div className="text-xs text-white/50">{p.ms} ms</div>
                        </summary>
                        <div className="mt-3 border-t border-white/10 pt-3">
                          {p.status === "ok" ? (
                            <pre className="whitespace-pre-wrap font-sans text-xs text-white/75">
                              {p.text || "(empty)"}
                            </pre>
                          ) : (
                            <div className="text-xs text-rose-100/80">{p.error || "(no error text)"}</div>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </Section>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-xs text-white/45">
          Note: This is a triangulation tool. For real work product, use a human review layer (your paid service).
        </div>
      </div>
    </div>
  );
}
