"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ProviderOutput = {
  provider: string;
  model: string;
  status: "ok" | "error" | "timeout";
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

type ThreadMsg =
  | { role: "user"; title?: string; content: string }
  | { role: "assistant"; content: string; meta?: CrosscheckResponse["meta"]; confidence?: string; caveats?: string[]; followups?: string[]; disagreements?: string[]; providers?: ProviderOutput[] };

export default function CrosscheckPage() {
  const [sessionReady, setSessionReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  const [jurisdiction, setJurisdiction] = useState("Panama");
  const [question, setQuestion] = useState("");
  const [facts, setFacts] = useState("");
  const [constraints, setConstraints] = useState("Answer like a tax partner. Provide risks, assumptions, and what facts you need.");

  const [loading, setLoading] = useState(false);
  const [thread, setThread] = useState<ThreadMsg[]>([
    { role: "assistant", content: "Ask a question on the left. You’ll get a conservative best answer plus missing facts, caveats, and provider deltas." }
  ]);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const canRun = useMemo(() => question.trim().length >= 3, [question]);

  useEffect(() => {
    const run = async () => {
      try {
        const s = await fetch("/api/auth/session", { cache: "no-store" }).then(r => r.json());
        setLoggedIn(!!s?.user);
      } catch {
        setLoggedIn(false);
      } finally {
        setSessionReady(true);
      }
    };
    run();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread, loading]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/signin";
  }

  async function runCrosscheck() {
    if (!canRun || loading) return;

    setLoading(true);

    const userBlock = [
      jurisdiction ? `Jurisdiction: ${jurisdiction}` : "",
      question ? `Question:\n${question}` : "",
      facts ? `Facts:\n${facts}` : "",
      constraints ? `Constraints:\n${constraints}` : "",
    ].filter(Boolean).join("\n\n");

    setThread(t => [...t, { role: "user", title: "Crosscheck request", content: userBlock }]);

    try {
      const resp = await fetch("/api/ui/crosscheck", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jurisdiction, question, facts, constraints }),
      });

      const data = (await resp.json()) as CrosscheckResponse;
      if (!resp.ok || !data?.ok) {
        throw new Error((data as any)?.error || "Crosscheck failed");
      }

      const out: ThreadMsg = {
        role: "assistant",
        content: data.consensus.answer,
        meta: data.meta,
        confidence: data.consensus.confidence,
        caveats: data.consensus.caveats,
        followups: data.consensus.followups,
        disagreements: data.consensus.disagreements,
        providers: data.providers,
      };

      setThread(t => [...t, out]);
    } catch (e: any) {
      setThread(t => [...t, { role: "assistant", content: `Error: ${e?.message || "Unknown error"}` }]);
    } finally {
      setLoading(false);
    }
  }

  if (!sessionReady) {
    return <div className="min-h-screen bg-black text-white flex items-center justify-center text-white/60">Loading…</div>;
  }

  if (!loggedIn) {
    if (typeof window !== "undefined") window.location.href = "/signin";
    return null;
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Top bar */}
      <div className="sticky top-0 z-20 border-b border-white/10 bg-black/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-white/10 flex items-center justify-center font-semibold">TX</div>
            <div>
              <div className="font-semibold leading-tight">Tax Crosscheck</div>
              <div className="text-xs text-white/60">Triangulated tax triage (free) • conservative synthesis</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <a className="text-sm text-white/70 hover:text-white" href="/chat">RAG chat</a>
            <button onClick={logout} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10">
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-12">
        {/* Left: Input */}
        <div className="lg:col-span-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-white/80">Input</div>
              <div className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-xs text-white/60">Crosscheck mode</div>
            </div>

            <label className="mt-4 block text-xs text-white/60">Jurisdiction</label>
            <input
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/30"
              placeholder="e.g., Panama"
            />

            <label className="mt-4 block text-xs text-white/60">Question</label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="mt-2 h-28 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/30"
              placeholder="Ask the tax question…"
            />

            <label className="mt-4 block text-xs text-white/60">Facts (scenario)</label>
            <textarea
              value={facts}
              onChange={(e) => setFacts(e.target.value)}
              className="mt-2 h-28 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/30"
              placeholder="Deal steps, title passage, Incoterms, parties, locations, timing…"
            />

            <label className="mt-4 block text-xs text-white/60">Constraints</label>
            <textarea
              value={constraints}
              onChange={(e) => setConstraints(e.target.value)}
              className="mt-2 h-20 w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/30"
            />

            <button
              disabled={!canRun || loading}
              onClick={runCrosscheck}
              className="mt-4 w-full rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Running…" : "Run crosscheck"}
            </button>

            <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/55">
              Tip: best answers come from tight facts — <span className="text-white/70">Incoterms + title passage + who does what in-country.</span>
            </div>
          </div>

          {/* Hero cards */}
          <div className="mt-6 grid gap-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm font-semibold">Free crosscheck</div>
              <div className="mt-1 text-sm text-white/60">
                Multi-model triangulation + conservative synthesis. Great for rapid triage.
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm font-semibold">Paid human review (next)</div>
              <div className="mt-1 text-sm text-white/60">
                Quick sanity-check by a tax professional, with practical caveats and a “go/no-go” view.
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-sm font-semibold">Deep memo (network)</div>
              <div className="mt-1 text-sm text-white/60">
                Longer-form memo using your professional network / local counsel where needed.
              </div>
            </div>
          </div>
        </div>

        {/* Right: Thread */}
        <div className="lg:col-span-8">
          <div className="rounded-2xl border border-white/10 bg-white/5">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="text-sm font-semibold text-white/80">Thread</div>
              <div className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-xs text-white/60">
                triangulated
              </div>
            </div>

            <div className="h-[70vh] overflow-y-auto p-5">
              {thread.map((m, idx) => (
                <div key={idx} className={m.role === "user" ? "mb-4 flex justify-end" : "mb-4 flex justify-start"}>
                  <div className={m.role === "user" ? "max-w-[92%] rounded-2xl bg-white/10 p-4" : "max-w-[92%] rounded-2xl bg-black/40 p-4 border border-white/10"}>
                    {m.role === "user" && m.title && <div className="mb-2 text-xs text-white/60">{m.title}</div>}
                    <pre className="whitespace-pre-wrap text-sm leading-relaxed text-white/85">{m.content}</pre>

                    {m.role === "assistant" && (m.confidence || m.meta) && (
                      <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/60">
                        <div className="flex flex-wrap items-center gap-2">
                          {m.confidence && (
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                              confidence: <span className="text-white/80">{m.confidence}</span>
                            </span>
                          )}
                          {m.meta && (
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                              runtime: <span className="text-white/80">{m.meta.runtime_ms}ms</span>
                            </span>
                          )}
                        </div>

                        {m.caveats?.length ? (
                          <div className="mt-3">
                            <div className="text-white/70 font-semibold">Caveats</div>
                            <ul className="mt-2 list-disc pl-5 space-y-1">
                              {m.caveats.map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                          </div>
                        ) : null}

                        {m.followups?.length ? (
                          <div className="mt-3">
                            <div className="text-white/70 font-semibold">Missing facts / follow-ups</div>
                            <ul className="mt-2 list-disc pl-5 space-y-1">
                              {m.followups.map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                          </div>
                        ) : null}

                        {m.disagreements?.length ? (
                          <div className="mt-3">
                            <div className="text-white/70 font-semibold">Provider disagreements</div>
                            <ul className="mt-2 list-disc pl-5 space-y-1">
                              {m.disagreements.map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                          </div>
                        ) : null}

                        {m.meta ? (
                          <div className="mt-3">
                            <div className="text-white/70 font-semibold">Models used</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {m.meta.succeeded.map((s, i) => (
                                <span key={i} className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                                  {s.provider}:{s.model}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="mb-4 flex justify-start">
                  <div className="max-w-[92%] rounded-2xl bg-black/40 p-4 border border-white/10">
                    <div className="text-sm text-white/70">Running crosscheck…</div>
                    <div className="mt-2 h-2 w-40 animate-pulse rounded bg-white/10" />
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
