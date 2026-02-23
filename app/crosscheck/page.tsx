"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

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

type OutputStyle = "answer" | "memo" | "email";

type SavedRun = {
  id: string;
  createdAt: number;
  title: string;
  jurisdiction?: string;
  facts?: string;
  globalDefaults?: string;
  runOverrides?: string;
  question: string;
  answer?: string;
  caveats?: string[];
  followups?: string[];
  disagreements?: string[];
  confidence?: "low" | "medium" | "high";
};

const LS_KEY = "taxaipro_runs_v1";

/* ---------------- UI primitives ---------------- */

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const styles =
    tone === "good"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
      : tone === "warn"
      ? "border-amber-500/25 bg-amber-500/10 text-amber-100"
      : tone === "bad"
      ? "border-red-500/25 bg-red-500/10 text-red-100"
      : "border-white/10 bg-white/5 text-white/80";

  return (
    <span
      className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs", styles)}
    >
      {children}
    </span>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-white/[0.035] backdrop-blur-sm",
        className
      )}
    >
      {children}
    </div>
  );
}

function SectionTitle({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-sm font-semibold text-white/90">{title}</div>
        {subtitle ? <div className="mt-0.5 text-xs text-white/55">{subtitle}</div> : null}
      </div>
      {right ? <div className="pt-0.5">{right}</div> : null}
    </div>
  );
}

/* ---------------- Formatting helpers ---------------- */

function formatMemo(args: {
  jurisdiction?: string;
  facts?: string;
  question: string;
  answer?: string;
  caveats?: string[];
  followups?: string[];
  disagreements?: string[];
  confidence?: string;
}) {
  const {
    jurisdiction,
    facts,
    question,
    answer,
    caveats = [],
    followups = [],
    disagreements = [],
    confidence,
  } = args;

  const lines: string[] = [];
  lines.push(`MEMO — TaxAiPro (Draft)`);
  lines.push(`Date: ${new Date().toLocaleString()}`);
  if (jurisdiction) lines.push(`Jurisdiction: ${jurisdiction}`);
  if (confidence) lines.push(`Confidence: ${confidence}`);
  lines.push("");
  lines.push("Question:");
  lines.push(question.trim());
  lines.push("");

  if (facts?.trim()) {
    lines.push("Key facts provided:");
    lines.push(facts.trim());
    lines.push("");
  }

  lines.push("Preliminary answer (conservative):");
  lines.push((answer || "—").trim());
  lines.push("");

  if (caveats.length) {
    lines.push("Caveats / limitations:");
    caveats.forEach((c) => lines.push(`- ${c}`));
    lines.push("");
  }

  if (followups.length) {
    lines.push("Missing facts / follow-ups needed:");
    followups.forEach((f) => lines.push(`- ${f}`));
    lines.push("");
  }

  if (disagreements.length) {
    lines.push("Noted disagreements across models:");
    disagreements.forEach((d) => lines.push(`- ${d}`));
    lines.push("");
  }

  lines.push("Not legal or tax advice. For decisions, validate with primary sources and/or counsel.");
  return lines.join("\n");
}

function formatEmail(args: {
  jurisdiction?: string;
  question: string;
  answer?: string;
  caveats?: string[];
  followups?: string[];
}) {
  const { jurisdiction, question, answer, caveats = [], followups = [] } = args;

  const lines: string[] = [];
  lines.push(`Subject: Tax question follow-up${jurisdiction ? ` (${jurisdiction})` : ""}`);
  lines.push("");
  lines.push("Hi [Name],");
  lines.push("");
  lines.push("Here’s a concise summary based on the facts provided so far:");
  lines.push("");
  lines.push(`Question: ${question.trim()}`);
  lines.push("");
  lines.push("Answer (preliminary):");
  lines.push((answer || "—").trim());
  lines.push("");

  if (caveats.length) {
    lines.push("Key caveats:");
    caveats.forEach((c) => lines.push(`• ${c}`));
    lines.push("");
  }

  if (followups.length) {
    lines.push("To confirm the conclusion, I still need:");
    followups.forEach((f) => lines.push(`• ${f}`));
    lines.push("");
  }

  lines.push("Best,");
  lines.push("[Your name]");
  lines.push("");
  lines.push("—");
  lines.push("Draft generated with TaxAiPro (not legal or tax advice).");
  return lines.join("\n");
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------------- Local history ---------------- */

function safeParseRuns(): SavedRun[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(Boolean)
      .map((x: unknown) => {
        const r = x as Partial<SavedRun> & {
          caveats?: unknown;
          followups?: unknown;
          disagreements?: unknown;
        };

        return {
          id: String(r.id || crypto.randomUUID()),
          createdAt: Number(r.createdAt || Date.now()),
          title: String(r.title || "Untitled"),
          jurisdiction: r.jurisdiction ? String(r.jurisdiction) : undefined,
          facts: r.facts ? String(r.facts) : undefined,
          globalDefaults: r.globalDefaults ? String(r.globalDefaults) : undefined,
          runOverrides: r.runOverrides ? String(r.runOverrides) : undefined,
          question: String(r.question || ""),
          answer: r.answer ? String(r.answer) : undefined,
          caveats: Array.isArray(r.caveats) ? r.caveats.map(String) : [],
          followups: Array.isArray(r.followups) ? r.followups.map(String) : [],
          disagreements: Array.isArray(r.disagreements) ? r.disagreements.map(String) : [],
          confidence:
            r.confidence === "low" || r.confidence === "medium" || r.confidence === "high"
              ? r.confidence
              : undefined,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

function persistRuns(runs: SavedRun[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(runs.slice(0, 50)));
}

function buildConstraints(globalDefaults: string, runOverrides: string) {
  const g = (globalDefaults || "").trim();
  const r = (runOverrides || "").trim();
  if (g && r)
    return ["GLOBAL DEFAULTS:", g, "", "RUN OVERRIDES (ONLY FOR THIS RUN):", r].join("\n");
  if (g) return g;
  if (r) return r;
  return undefined;
}

function clampTitleFromQuestion(q: string) {
  return (q.trim().slice(0, 60) || "Untitled").replace(/\s+/g, " ");
}

/* ---------------- Page ---------------- */

export default function CrosscheckPage() {
  const [jurisdiction, setJurisdiction] = useState("Panama");
  const [facts, setFacts] = useState("");
  const [globalDefaults, setGlobalDefaults] = useState(
    [
      "Act like a senior tax specialist.",
      "Be conservative; avoid overclaiming.",
      "Start with a bottom-line first.",
      "List assumptions, missing facts, and caveats.",
      "If multiple outcomes exist, show decision tree / thresholds.",
    ].join("\n")
  );
  const [runOverrides, setRunOverrides] = useState("");
  const [question, setQuestion] = useState("");

  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<CrosscheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [outputStyle, setOutputStyle] = useState<OutputStyle>("answer");

  const [history, setHistory] = useState<SavedRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const runFnRef = useRef<() => void>(() => {});

  useEffect(() => {
    setHistory(safeParseRuns());
  }, []);

  const succeeded = resp?.meta?.succeeded ?? [];
  const failed = resp?.meta?.failed ?? [];
  const runtimeMs = resp?.meta?.runtime_ms ?? null;

  const constraints = useMemo(
    () => buildConstraints(globalDefaults, runOverrides),
    [globalDefaults, runOverrides]
  );

  const confidence = resp?.consensus?.confidence;
  const canSave = !!resp?.consensus?.answer?.trim();

  const displayText = useMemo(() => {
    const base = {
      jurisdiction: jurisdiction.trim() || undefined,
      facts: facts.trim() || undefined,
      question: question.trim(),
      answer: resp?.consensus?.answer || "",
      caveats: resp?.consensus?.caveats || [],
      followups: resp?.consensus?.followups || [],
      disagreements: resp?.consensus?.disagreements || [],
      confidence: resp?.consensus?.confidence,
    };

    if (outputStyle === "memo") return formatMemo(base);
    if (outputStyle === "email") return formatEmail(base);
    return (resp?.consensus?.answer || "Your consensus answer will appear here.").trim();
  }, [outputStyle, resp, jurisdiction, facts, question]);

  function loadRun(r: SavedRun) {
    setSelectedId(r.id);
    setJurisdiction(r.jurisdiction || "");
    setFacts(r.facts || "");
    setGlobalDefaults(r.globalDefaults || globalDefaults);
    setRunOverrides(r.runOverrides || "");
    setQuestion(r.question || "");
    setResp({
      ok: true,
      consensus: {
        answer: r.answer,
        caveats: r.caveats || [],
        followups: r.followups || [],
        disagreements: r.disagreements || [],
        confidence: r.confidence,
      },
      meta: { runtime_ms: undefined, attempted: [], succeeded: [], failed: [] },
      providers: [],
    });
    setError(null);
  }

  function deleteRun(id: string) {
    const next = history.filter((h) => h.id !== id);
    setHistory(next);
    persistRuns(next);
    if (selectedId === id) setSelectedId(null);
  }

  function saveCurrentRun() {
    if (!canSave) return;
    const run: SavedRun = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      title: clampTitleFromQuestion(question),
      jurisdiction: jurisdiction.trim() || undefined,
      facts: facts.trim() || undefined,
      globalDefaults: globalDefaults.trim() || undefined,
      runOverrides: runOverrides.trim() || undefined,
      question: question.trim(),
      answer: resp?.consensus?.answer || "",
      caveats: resp?.consensus?.caveats || [],
      followups: resp?.consensus?.followups || [],
      disagreements: resp?.consensus?.disagreements || [],
      confidence: resp?.consensus?.confidence,
    };

    const next = [run, ...history].slice(0, 50);
    setHistory(next);
    persistRuns(next);
    setSelectedId(run.id);
  }

  function applyMissingFactsToFacts() {
    const followups = resp?.consensus?.followups ?? [];
    if (!followups.length) return;
    const block = followups.map((f) => `• ${f}`).join("\n");
    const prefix = facts.trim() ? `${facts.trim()}\n\n` : "";
    setFacts(`${prefix}Missing facts to confirm:\n${block}\n`);
  }

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
          constraints,
          question: q,
        }),
      });

      const text = await r.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = { ok: false, error: text };
      }

      const parsed = json as CrosscheckResponse;

      if (!r.ok || parsed?.ok === false) {
        setResp(parsed);
        setError(parsed?.error || `Request failed (${r.status})`);
      } else {
        setResp(parsed);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Request failed.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  runFnRef.current = run;

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") runFnRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const systemTone =
    failed.length > 0 && succeeded.length === 0 ? "bad" : failed.length > 0 ? "warn" : "good";

  const systemLabel =
    failed.length > 0 && succeeded.length === 0
      ? "System: degraded"
      : failed.length > 0
      ? "System: partial"
      : resp
      ? "System: healthy"
      : "System: —";

  return (
    <div className="min-h-screen text-white bg-[#070A12]">
      {/* Premium background glow */}
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute -top-48 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-[-220px] right-[-140px] h-[560px] w-[560px] rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/taxaipro-logo.png"
              alt="TaxAiPro"
              className="h-10 w-10 rounded-xl object-contain border border-white/10 bg-white/5"
            />
            <div>
              <div className="text-sm font-semibold leading-none">TaxAiPro</div>
              <div className="mt-1 text-xs text-white/55">
                Enterprise-grade multi-model validation for conservative tax triage
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setHistoryOpen(true)}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
            >
              History
            </button>
            <Pill>⌘/Ctrl + Enter</Pill>
            {runtimeMs != null ? <Pill>{runtimeMs}ms</Pill> : null}
            <Pill tone={resp ? (systemTone as any) : "neutral"}>{systemLabel}</Pill>
            {confidence ? (
              <Pill
                tone={
                  confidence === "high" ? "good" : confidence === "medium" ? "warn" : "bad"
                }
              >
                Confidence: {confidence}
              </Pill>
            ) : null}
          </div>
        </div>

        {/* Main layout: Guided Input (left) + Output (right, dominant) */}
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* LEFT: Guided input */}
          <div className="lg:col-span-4 space-y-4">
            <Card className="p-5">
              <SectionTitle
                title="1) Jurisdiction"
                subtitle="Country / state. Add treaty context in Facts if relevant."
              />
              <select
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
              >
                <optgroup label="USA">
                  <option value="United States">United States</option>
                </optgroup>

                <optgroup label="LATAM">
                  <option value="Argentina">Argentina</option>
                  <option value="Brazil">Brazil</option>
                  <option value="Chile">Chile</option>
                  <option value="Colombia">Colombia</option>
                  <option value="Mexico">Mexico</option>
                  <option value="Panama">Panama</option>
                  <option value="Peru">Peru</option>
                  <option value="Uruguay">Uruguay</option>
                </optgroup>

                <optgroup label="Other">
                  <option value="Other">Other / Not listed</option>
                </optgroup>
              </select>
            </Card>

            <Card className="p-5">
              <SectionTitle
                title="2) Your question"
                subtitle="Ask in plain English. Keep it short; details go in Facts."
              />
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="mt-3 min-h-[140px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
                placeholder="Example: If a Panama company invoices a foreign client for consulting services, is it Panama-source income? Any withholding exposure?"
              />

              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-white/50">
                  Tip: Run once → review “Missing facts” → paste → re-run for higher confidence.
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={run}
                    disabled={loading}
                    className="h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-50"
                  >
                    {loading ? "Running…" : "Run validation"}
                  </button>

                  <button
                    onClick={saveCurrentRun}
                    disabled={!canSave}
                    className="h-10 rounded-xl border border-white/15 bg-white/5 px-3 text-sm text-white/85 hover:bg-white/10 disabled:opacity-40"
                    title={canSave ? "Save this run" : "Run once first"}
                  >
                    Save
                  </button>
                </div>
              </div>

              {error ? (
                <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-100">
                  {error}
                </div>
              ) : null}
            </Card>

            <Card className="p-0">
              <details open={false} className="p-5">
                <summary className="cursor-pointer select-none list-none">
                  <SectionTitle
                    title="Facts (recommended)"
                    subtitle="Paste bullets. After Run 1, paste “Missing facts” here."
                    right={<Pill>Optional</Pill>}
                  />
                </summary>

                <textarea
                  value={facts}
                  onChange={(e) => setFacts(e.target.value)}
                  className="mt-4 min-h-[180px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
                  placeholder={[
                    "• Entity type, residency, ownership",
                    "• Transaction flow + timing + amounts",
                    "• Where title passes / who performs services",
                    "• Thresholds (PE, withholding, VAT registration, etc.)",
                  ].join("\n")}
                />

                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="text-[11px] text-white/45">Use bullets. Keep sources/links if you have them.</div>
                  <button
                    onClick={applyMissingFactsToFacts}
                    disabled={!(resp?.consensus?.followups ?? []).length}
                    className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10 disabled:opacity-40"
                  >
                    Paste missing facts
                  </button>
                </div>
              </details>
            </Card>

            <Card className="p-0">
              <details open={false} className="p-5">
                <summary className="cursor-pointer select-none list-none">
                  <SectionTitle
                    title="Advanced"
                    subtitle="Defaults, run overrides, and debug outputs."
                    right={<Pill>Power users</Pill>}
                  />
                </summary>

                <div className="mt-4 space-y-4">
                  <div>
                    <div className="text-xs font-semibold text-white/70">Global defaults</div>
                    <div className="mt-1 text-[11px] text-white/45">Stable posture across runs.</div>
                    <textarea
                      value={globalDefaults}
                      onChange={(e) => setGlobalDefaults(e.target.value)}
                      className="mt-2 min-h-[140px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
                    />
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-white/70">Run overrides</div>
                    <div className="mt-1 text-[11px] text-white/45">Only for this run (e.g., “assume X”).</div>
                    <textarea
                      value={runOverrides}
                      onChange={(e) => setRunOverrides(e.target.value)}
                      className="mt-2 min-h-[90px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
                      placeholder="Example: Focus only on withholding + treaty relief."
                    />
                    <div className="mt-2 flex justify-end">
                      <button
                        onClick={() => setRunOverrides("")}
                        disabled={!runOverrides.trim()}
                        className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10 disabled:opacity-40"
                      >
                        Clear overrides
                      </button>
                    </div>
                  </div>

                  {resp?.providers?.length ? (
                    <details className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <summary className="cursor-pointer text-xs font-semibold text-white/70">
                        Debug: provider outputs
                      </summary>
                      <div className="mt-3 space-y-3">
                        {resp.providers.map((p, idx) => (
                          <div key={idx} className="rounded-xl border border-white/10 bg-black/30 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs text-white/70">
                                <span className="font-semibold text-white/90">{p.provider}</span> · {p.model}
                              </div>
                              <div className="text-xs text-white/50">
                                {p.status !== "ok" ? (
                                  <span className="text-amber-200">({p.status})</span>
                                ) : null}{" "}
                                {p.ms}ms
                              </div>
                            </div>
                            <div className="mt-2 whitespace-pre-wrap text-sm text-white/80">
                              {p.status === "ok" ? p.text : p.error}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              </details>
            </Card>
          </div>

          {/* RIGHT: Output (dominant) */}
          <div className="lg:col-span-8 space-y-4">
            <Card className="p-5">
              <SectionTitle
                title="Output"
                subtitle="Switch style, then copy or download."
                right={
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setOutputStyle("answer")}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs border",
                        outputStyle === "answer"
                          ? "bg-white text-black border-white"
                          : "border-white/15 text-white/80 hover:bg-white/5"
                      )}
                    >
                      Answer
                    </button>
                    <button
                      onClick={() => setOutputStyle("memo")}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs border",
                        outputStyle === "memo"
                          ? "bg-white text-black border-white"
                          : "border-white/15 text-white/80 hover:bg-white/5"
                      )}
                    >
                      Memo
                    </button>
                    <button
                      onClick={() => setOutputStyle("email")}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs border",
                        outputStyle === "email"
                          ? "bg-white text-black border-white"
                          : "border-white/15 text-white/80 hover:bg-white/5"
                      )}
                    >
                      Email
                    </button>
                  </div>
                }
              />

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(displayText);
                    } catch {}
                  }}
                  className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
                >
                  Copy
                </button>

                <button
                  onClick={() => {
                    const base =
                      outputStyle === "memo"
                        ? "taxaipro-memo"
                        : outputStyle === "email"
                        ? "taxaipro-email"
                        : "taxaipro-answer";
                    downloadText(`${base}.txt`, displayText);
                  }}
                  className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
                >
                  Download
                </button>

                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {resp ? <Pill tone={systemTone as any}>{systemLabel}</Pill> : null}
                  {confidence ? (
                    <Pill
                      tone={
                        confidence === "high" ? "good" : confidence === "medium" ? "warn" : "bad"
                      }
                    >
                      Confidence: {confidence}
                    </Pill>
                  ) : null}
                </div>
              </div>

              {/* Big answer area */}
              <div className="mt-4 rounded-2xl border border-white/10 bg-black/35 p-6 min-h-[480px]">
                <pre className="whitespace-pre-wrap text-[15px] leading-relaxed text-white/92">
                  {displayText || "—"}
                </pre>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="text-xs font-semibold text-white/70">Caveats</div>
                  <div className="mt-2 space-y-1 text-sm text-white/80">
                    {(resp?.consensus?.caveats ?? []).length ? (
                      (resp?.consensus?.caveats ?? []).slice(0, 6).map((c, i) => <div key={i}>• {c}</div>)
                    ) : (
                      <div className="text-white/50">None yet.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-white/70">Missing facts</div>
                    {(resp?.consensus?.followups ?? []).length ? (
                      <button
                        onClick={applyMissingFactsToFacts}
                        className="rounded-xl border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-white/85 hover:bg-white/10"
                      >
                        Paste to Facts
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-2 space-y-1 text-sm text-white/80">
                    {(resp?.consensus?.followups ?? []).length ? (
                      (resp?.consensus?.followups ?? []).slice(0, 6).map((c, i) => <div key={i}>• {c}</div>)
                    ) : (
                      <div className="text-white/50">None yet.</div>
                    )}
                  </div>
                </div>
              </div>

              <p className="mt-4 text-[11px] text-white/40">
                TaxAiPro generates drafts for triage only — not legal or tax advice.
              </p>
            </Card>

            {/* Optional: show disagreements only when present */}
            {(resp?.consensus?.disagreements ?? []).length ? (
              <Card className="p-5">
                <SectionTitle
                  title="Disagreements"
                  subtitle="Where models differed. Consider adding facts and re-running."
                />
                <div className="mt-3 space-y-2 text-sm text-white/80">
                  {(resp?.consensus?.disagreements ?? []).map((d, i) => (
                    <div key={i} className="rounded-xl border border-white/10 bg-black/25 p-3">
                      {d}
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}
          </div>
        </div>

        {/* History drawer */}
        {historyOpen ? (
          <div
            className="fixed inset-0 z-50"
            role="dialog"
            aria-modal="true"
            onMouseDown={() => setHistoryOpen(false)}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div
              className="absolute right-0 top-0 h-full w-[92vw] max-w-md border-l border-white/10 bg-[#070A12]/95 p-4"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white/90">Case history</div>
                  <div className="mt-1 text-xs text-white/50">Saved on this device (localStorage).</div>
                </div>
                <button
                  onClick={() => setHistoryOpen(false)}
                  className="text-white/60 hover:text-white"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="mt-4 space-y-2 overflow-auto pr-1" style={{ maxHeight: "calc(100vh - 84px)" }}>
                {history.length ? (
                  history.map((h) => (
                    <div
                      key={h.id}
                      className={cn(
                        "rounded-xl border border-white/10 bg-black/25 p-3",
                        selectedId === h.id && "ring-1 ring-white/20"
                      )}
                    >
                      <button onClick={() => loadRun(h)} className="w-full text-left">
                        <div className="text-xs font-semibold text-white/85 line-clamp-2">{h.title}</div>
                        <div className="mt-1 text-[11px] text-white/45">
                          {new Date(h.createdAt).toLocaleDateString()} · {h.jurisdiction || "—"} ·{" "}
                          {h.confidence ? `Conf: ${h.confidence}` : "Conf: —"}
                        </div>
                      </button>

                      <div className="mt-3 flex items-center justify-between">
                        <button
                          onClick={() => {
                            loadRun(h);
                            setHistoryOpen(false);
                          }}
                          className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/85 hover:bg-white/10"
                        >
                          Open
                        </button>
                        <button
                          onClick={() => deleteRun(h.id)}
                          className="text-xs text-white/55 hover:text-white/80"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-white/50">
                    No saved runs yet.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}