"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMessages } from "next-intl";

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

type ThreadMessage = {
  id: string;
  createdAt: number;
  role: "user" | "assistant";
  text: string;
};

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
  thread?: ThreadMessage[];
};

type DerivedConsensus = {
  answer: string;
  caveats: string[];
  followups: string[];
  disagreements: string[];
  confidence?: "low" | "medium" | "high";
};

type AutosaveState = "idle" | "saving" | "saved" | "unavailable" | "error";

const LS_KEY = "taxaipro_runs_v1";
const LS_TIER_KEY = "taxaipro_tier";
const LS_ACTIVE_THREAD = "taxaipro_active_thread_v1";
const LS_CORP_KEY = "taxaipro_corp_v1";

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
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs", styles)}>
      {children}
    </span>
  );
}

function Card({
  children,
  className = "",
  variant = "dark",
}: {
  children: React.ReactNode;
  className?: string;
  variant?: "dark" | "paper";
}) {
  const base = "rounded-2xl border";
  const dark = "border-white/10 bg-white/[0.035] backdrop-blur-sm";
  const paper = "border-zinc-200 bg-white text-zinc-900 shadow-sm";

  return <div className={cn(base, variant === "paper" ? paper : dark, className)}>{children}</div>;
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
  const { jurisdiction, facts, question, answer, caveats = [], followups = [], disagreements = [], confidence } = args;

  const lines: string[] = [];
  lines.push(`MEMO — TaxAiPro™ (Draft)`);
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
  lines.push("Draft generated with TaxAiPro™ (not legal or tax advice).");
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

/* ---------------- Parsing helpers ---------------- */

function dedupeStrings(items: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of items) {
    const value = String(raw || "").replace(/\s+/g, " ").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }

  return out;
}

function stripBulletPrefix(line: string) {
  return line
    .replace(/^\s*[•\-–—*]\s*/, "")
    .replace(/^\s*\d+[\.\)]\s*/, "")
    .replace(/^\s*[a-zA-Z][\.\)]\s*/, "")
    .trim();
}

function isHeadingLine(line: string) {
  const s = line.trim().toLowerCase().replace(/:+$/, "");
  if (!s) return null as null | "caveats" | "followups" | "disagreements";

  if (
    s === "caveat" ||
    s === "caveats" ||
    s === "key caveat" ||
    s === "key caveats" ||
    s === "caveats / limitations" ||
    s === "limitations"
  ) {
    return "caveats";
  }

  if (
    s === "missing fact" ||
    s === "missing facts" ||
    s === "missing facts to confirm" ||
    s === "missing facts / follow-ups needed" ||
    s === "follow-up" ||
    s === "follow-up questions" ||
    s === "followups" ||
    s === "follow-ups" ||
    s === "follow ups" ||
    s === "follow-up needed" ||
    s === "follow-ups needed" ||
    s === "to confirm the conclusion, i still need"
  ) {
    return "followups";
  }

  if (
    s === "disagreement" ||
    s === "disagreements" ||
    s === "noted disagreements across models" ||
    s === "where models differed"
  ) {
    return "disagreements";
  }

  return null;
}

function parseStructuredSections(text?: string | null) {
  const raw = String(text || "").trim();
  if (!raw) {
    return {
      answer: "",
      caveats: [] as string[],
      followups: [] as string[],
      disagreements: [] as string[],
    };
  }

  const lines = raw.split(/\r?\n/);

  const answerLines: string[] = [];
  const caveats: string[] = [];
  const followups: string[] = [];
  const disagreements: string[] = [];

  let current: null | "caveats" | "followups" | "disagreements" = null;

  for (const line of lines) {
    const heading = isHeadingLine(line);
    if (heading) {
      current = heading;
      continue;
    }

    const trimmed = line.trim();

    if (!current) {
      answerLines.push(line);
      continue;
    }

    if (!trimmed) continue;

    const item = stripBulletPrefix(trimmed);

    const lookedLikePlainParagraph =
      !/^[•\-–—*\d]/.test(trimmed) &&
      !/^[a-zA-Z][\.\)]\s/.test(trimmed) &&
      (current === "caveats" || current === "followups" || current === "disagreements");

    if (lookedLikePlainParagraph) {
      current = null;
      answerLines.push(line);
      continue;
    }

    if (current === "caveats") caveats.push(item);
    if (current === "followups") followups.push(item);
    if (current === "disagreements") disagreements.push(item);
  }

  const answer = answerLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return {
    answer,
    caveats: dedupeStrings(caveats),
    followups: dedupeStrings(followups),
    disagreements: dedupeStrings(disagreements),
  };
}

function deriveConsensus(resp: CrosscheckResponse | null): DerivedConsensus {
  const baseAnswer = (resp?.consensus?.answer || "").trim();

  const fromConsensus = {
    answer: baseAnswer,
    caveats: Array.isArray(resp?.consensus?.caveats) ? resp!.consensus!.caveats!.map(String) : [],
    followups: Array.isArray(resp?.consensus?.followups) ? resp!.consensus!.followups!.map(String) : [],
    disagreements: Array.isArray(resp?.consensus?.disagreements)
      ? resp!.consensus!.disagreements!.map(String)
      : [],
    confidence: resp?.consensus?.confidence,
  };

  const parsedFromAnswer = parseStructuredSections(baseAnswer);

  let caveats = dedupeStrings([...fromConsensus.caveats, ...parsedFromAnswer.caveats]);
  let followups = dedupeStrings([...fromConsensus.followups, ...parsedFromAnswer.followups]);
  let disagreements = dedupeStrings([...fromConsensus.disagreements, ...parsedFromAnswer.disagreements]);

  if ((!caveats.length || !followups.length || !disagreements.length) && Array.isArray(resp?.providers)) {
    for (const provider of resp.providers) {
      if (provider.status !== "ok" || !provider.text) continue;
      const parsed = parseStructuredSections(provider.text);

      if (!caveats.length && parsed.caveats.length) caveats = dedupeStrings([...caveats, ...parsed.caveats]);
      if (!followups.length && parsed.followups.length) followups = dedupeStrings([...followups, ...parsed.followups]);
      if (!disagreements.length && parsed.disagreements.length) {
        disagreements = dedupeStrings([...disagreements, ...parsed.disagreements]);
      }
    }
  }

  const answer = parsedFromAnswer.answer.trim() || baseAnswer || "";

  return {
    answer,
    caveats,
    followups,
    disagreements,
    confidence: fromConsensus.confidence,
  };
}

/* ---------------- Local history ---------------- */

function normalizeThreadMessage(m: any): ThreadMessage | null {
  const text = String(m?.text ?? "").trim();
  if (!text) return null;

  const role: ThreadMessage["role"] = m?.role === "assistant" ? "assistant" : "user";
  return {
    id: String(m?.id ?? crypto.randomUUID()),
    createdAt: Number.isFinite(Number(m?.createdAt)) ? Number(m.createdAt) : Date.now(),
    role,
    text,
  };
}

function safeParseRuns(): SavedRun[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(Boolean)
      .map((x: unknown): SavedRun => {
        const r = x as Partial<SavedRun> & {
          caveats?: unknown;
          followups?: unknown;
          disagreements?: unknown;
          thread?: unknown;
        };

        const thread: ThreadMessage[] =
          Array.isArray(r.thread) && r.thread.length
            ? (r.thread as any[])
                .map(normalizeThreadMessage)
                .filter((m): m is ThreadMessage => !!m)
                .sort((a, b) => a.createdAt - b.createdAt)
            : [];

        return {
          id: String(r.id || crypto.randomUUID()),
          createdAt: Number.isFinite(Number(r.createdAt)) ? Number(r.createdAt) : Date.now(),
          title: String(r.title || "Untitled"),
          jurisdiction: r.jurisdiction ? String(r.jurisdiction) : undefined,
          facts: r.facts ? String(r.facts) : undefined,
          globalDefaults: r.globalDefaults ? String(r.globalDefaults) : undefined,
          runOverrides: r.runOverrides ? String(r.runOverrides) : undefined,
          question: String(r.question || ""),
          answer: r.answer ? String(r.answer) : undefined,
          caveats: Array.isArray(r.caveats) ? (r.caveats as any[]).map(String) : [],
          followups: Array.isArray(r.followups) ? (r.followups as any[]).map(String) : [],
          disagreements: Array.isArray(r.disagreements) ? (r.disagreements as any[]).map(String) : [],
          confidence:
            r.confidence === "low" || r.confidence === "medium" || r.confidence === "high"
              ? r.confidence
              : undefined,
          thread,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

function loadActiveThread(): ThreadMessage[] {
  try {
    const raw = localStorage.getItem(LS_ACTIVE_THREAD);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return (parsed as any[])
      .map(normalizeThreadMessage)
      .filter((m): m is ThreadMessage => !!m)
      .sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

function persistActiveThread(thread: ThreadMessage[]) {
  try {
    localStorage.setItem(LS_ACTIVE_THREAD, JSON.stringify(thread.slice(-200)));
  } catch {}
}

function persistRuns(runs: SavedRun[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(runs.slice(0, 50)));
}

function buildConstraints(globalDefaults: string, runOverrides: string) {
  const g = (globalDefaults || "").trim();
  const r = (runOverrides || "").trim();
  if (g && r) return ["GLOBAL DEFAULTS:", g, "", "RUN OVERRIDES (ONLY FOR THIS RUN):", r].join("\n");
  if (g) return g;
  if (r) return r;
  return undefined;
}

function clampTitleFromQuestion(q: string) {
  return (q.trim().slice(0, 60) || "Untitled").replace(/\s+/g, " ");
}

/* ---------------- Thread helpers ---------------- */

function newMsg(role: "user" | "assistant", text: string): ThreadMessage {
  return { id: crypto.randomUUID(), createdAt: Date.now(), role, text: text.trim() };
}

function buildCompositeFollowUpPrompt(args: {
  originalQuestion: string;
  priorConsensusAnswer: string;
  followUpQuestion: string;
}) {
  const { originalQuestion, priorConsensusAnswer, followUpQuestion } = args;

  return [
    "You are continuing the same tax case. Keep the original fact pattern unless the follow-up changes it.",
    "",
    "ORIGINAL QUESTION:",
    originalQuestion.trim(),
    "",
    "PRIOR CONSENSUS ANSWER (MOST RECENT):",
    priorConsensusAnswer.trim(),
    "",
    "FOLLOW-UP QUESTION:",
    followUpQuestion.trim(),
    "",
    "INSTRUCTIONS:",
    "- Answer the follow-up directly.",
    "- If the follow-up materially changes facts/assumptions, state the delta explicitly.",
    "- Keep conservative posture; list assumptions, caveats, and missing facts.",
  ].join("\n");
}

function buildQuestionForFormatting(thread: ThreadMessage[], fallbackQuestion: string) {
  const userQs = thread
    .filter((m) => m.role === "user")
    .map((m) => m.text.trim())
    .filter(Boolean);

  if (!userQs.length) return fallbackQuestion.trim();
  if (userQs.length === 1) return userQs[0];

  const lines: string[] = [];
  lines.push(userQs[0]);
  lines.push("");
  lines.push("Follow-ups:");
  userQs.slice(1).forEach((q, i) => lines.push(`${i + 1}) ${q}`));
  return lines.join("\n");
}

/* ---------------- Tier helpers ---------------- */

type Tier = "0" | "1" | "2";
type PaidTier = Exclude<Tier, "0">;

function readTier(): Tier {
  try {
    const v = localStorage.getItem(LS_TIER_KEY);
    if (v === "1" || v === "2") return v;
    return "0";
  } catch {
    return "0";
  }
}

function tierLabel(t: Tier) {
  if (t === "2") return "Tier 2 — Unlimited";
  if (t === "1") return "Tier 1 — Pro";
  return "Tier 0 — Simple";
}

function tierDailyRuns(t: Tier) {
  if (t === "2") return "Unlimited";
  if (t === "1") return "25/day";
  return "5/day";
}

function tierPrice(t: Tier) {
  if (t === "2") return "$19.99/mo";
  if (t === "1") return "$5.99/mo";
  return "$0";
}

/* ---------------- Rate limit UI ---------------- */

type RateUi = {
  tier?: Tier;
  limit?: number;
  used?: number;
  remaining?: number;
  resetAt?: string;
};

function parseIntOrUndef(x: string | null): number | undefined {
  if (x == null) return undefined;
  const n = Number.parseInt(x, 10);
  return Number.isFinite(n) ? n : undefined;
}

function formatResetLocal(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function hasCorpActive(): boolean {
  try {
    const raw = localStorage.getItem(LS_CORP_KEY);
    if (!raw) return false;
    const j = JSON.parse(raw);
    return !!j?.active;
  } catch {
    return false;
  }
}

/* ---------------- Page ---------------- */

export default function CrosscheckPage() {
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = typeof params?.locale === "string" ? params.locale : "en";
  const messages = useMessages() as Record<string, any>;

  const tm = React.useCallback(
    (key: string, fallback: string) => {
      const parts = key.split(".");
      let cur: any = messages;
      for (const part of parts) {
        if (cur && typeof cur === "object" && part in cur) {
          cur = cur[part];
        } else {
          return fallback;
        }
      }
      return typeof cur === "string" ? cur : fallback;
    },
    [messages]
  );

  const localizePath = React.useCallback(
    (path: string) => {
      if (!path.startsWith("/")) return `/${locale}/${path}`;
      if (path.startsWith(`/${locale}`)) return path;
      return `/${locale}${path}`;
    },
    [locale]
  );

  const go = (path: string) => {
    const nextPath = localizePath(path);
    try {
      router.push(nextPath);
    } catch {
      window.location.href = nextPath;
    }
  };

  const [jurisdiction, setJurisdiction] = useState("");
  const [facts, setFacts] = useState("");
  const [globalDefaults, setGlobalDefaults] = useState(
    [
      "Act like a senior partner tax specialist.",
      "Be conservative; avoid overclaiming.",
      "Start with a bottom-line first.",
      "List assumptions, missing facts, and caveats.",
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

  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [followUp, setFollowUp] = useState("");
  const [followUpLoading, setFollowUpLoading] = useState(false);

  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  const [tier, setTier] = useState<Tier>("0");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [checkoutLoadingTier, setCheckoutLoadingTier] = useState<PaidTier | null>(null);

  const [rate, setRate] = useState<RateUi>({});

  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [aiWorksOpen, setAiWorksOpen] = useState(false);

  const [loadingStepIndex, setLoadingStepIndex] = useState(0);
  const [loadingElapsed, setLoadingElapsed] = useState(0);

  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [autosaveMessage, setAutosaveMessage] = useState("");
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);

  const runFnRef = useRef<() => void>(() => {});

  function setTierLocal(next: Tier) {
    try {
      localStorage.setItem(LS_TIER_KEY, next);
    } catch {}
    setTier(next);
  }

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get("tier");
      const sessionId = sp.get("session_id");
      const hasCheckoutSignal = !!sessionId || sp.get("checkout") === "success" || sp.get("paid") === "1";

      if (t === "corp" && hasCheckoutSignal) {
        setTierLocal("2");

        try {
          const corp = {
            active: true,
            seatsTotal: 5,
            createdAt: Date.now(),
            sessionId,
            invites: [],
          };
          localStorage.setItem(LS_CORP_KEY, JSON.stringify(corp));
        } catch {}

        sp.delete("tier");
        sp.delete("checkout");
        sp.delete("paid");
        sp.delete("session_id");
        const qs = sp.toString();
        const nextUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
        window.history.replaceState({}, "", nextUrl);
      }

      const t2 = sp.get("tier") as Tier | null;
      if ((t2 === "1" || t2 === "2") && hasCheckoutSignal) {
        setTierLocal(t2);

        if (sessionId) {
          const sentKey = `taxaipro_sub_email_sent_${sessionId}`;
          const alreadySent = (() => {
            try {
              return localStorage.getItem(sentKey) === "1";
            } catch {
              return false;
            }
          })();

          if (!alreadySent) {
            fetch("/api/email/subscription", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ tier: t2, session_id: sessionId }),
            })
              .then(() => {
                try {
                  localStorage.setItem(sentKey, "1");
                } catch {}
              })
              .catch(() => {});
          }
        }

        sp.delete("tier");
        sp.delete("checkout");
        sp.delete("paid");
        sp.delete("session_id");
        const qs = sp.toString();
        const nextUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
        window.history.replaceState({}, "", nextUrl);
      }

      if (sp.get("plans") === "1") setUpgradeOpen(true);
    } catch {}
  }, []);

  useEffect(() => {
    setHistory(safeParseRuns());
    setTier(readTier());
    setThread(loadActiveThread());
  }, []);

  useEffect(() => {
    persistActiveThread(thread);
  }, [thread]);

  useEffect(() => {
    let cancelled = false;

    async function syncTierFromBilling() {
      try {
        const r = await fetch("/api/billing/tier", { method: "GET" });
        if (!r.ok) return;
        const j = (await r.json().catch(() => null)) as any;
        const nextTier = j?.tier;
        if (!cancelled && (nextTier === "1" || nextTier === "2")) {
          setTierLocal(nextTier);
        }
      } catch {}
    }

    if (tier === "0") syncTierFromBilling();

    return () => {
      cancelled = true;
    };
  }, [tier]);

  const succeeded = resp?.meta?.succeeded ?? [];
  const failed = resp?.meta?.failed ?? [];
  const runtimeMs = resp?.meta?.runtime_ms ?? null;

  const constraints = useMemo(() => buildConstraints(globalDefaults, runOverrides), [globalDefaults, runOverrides]);
  const confidence = resp?.consensus?.confidence;
  const derivedConsensus = useMemo(() => deriveConsensus(resp), [resp]);
  const effectiveQuestionForOutput = useMemo(() => buildQuestionForFormatting(thread, question), [thread, question]);

  const isBusy = loading || followUpLoading;

  const loadingSteps = useMemo(
    () => [
      tm("crosscheck.loading.step1", "Reviewing facts and jurisdiction"),
      tm("crosscheck.loading.step2", "Running multi-model analysis"),
      tm("crosscheck.loading.step3", "Comparing agreement and disagreement"),
      tm("crosscheck.loading.step4", "Identifying caveats and missing facts"),
      tm("crosscheck.loading.step5", "Preparing conservative summary"),
    ],
    [tm]
  );

  useEffect(() => {
    if (!isBusy) {
      setLoadingStepIndex(0);
      setLoadingElapsed(0);
      return;
    }

    const stepTimer = window.setInterval(() => {
      setLoadingStepIndex((prev) => (prev + 1) % loadingSteps.length);
    }, 2200);

    const elapsedTimer = window.setInterval(() => {
      setLoadingElapsed((prev) => prev + 1);
    }, 1000);

    return () => {
      window.clearInterval(stepTimer);
      window.clearInterval(elapsedTimer);
    };
  }, [isBusy, loadingSteps]);

  const displayText = useMemo(() => {
    const base = {
      jurisdiction: jurisdiction.trim() || undefined,
      facts: facts.trim() || undefined,
      question: effectiveQuestionForOutput.trim(),
      answer: derivedConsensus.answer || "",
      caveats: derivedConsensus.caveats || [],
      followups: derivedConsensus.followups || [],
      disagreements: derivedConsensus.disagreements || [],
      confidence: derivedConsensus.confidence,
    };

    if (outputStyle === "memo") return formatMemo(base);
    if (outputStyle === "email") return formatEmail(base);
    return (derivedConsensus.answer || tm("crosscheck.output.placeholder", "Your answer will appear here.")).trim();
  }, [outputStyle, derivedConsensus, jurisdiction, facts, effectiveQuestionForOutput, tm]);

  function upsertLocalRun(run: SavedRun) {
    const next = [run, ...history.filter((h) => h.id !== run.id)].slice(0, 50);
    setHistory(next);
    persistRuns(next);
    setSelectedId(run.id);
  }

  async function autosaveRun(args: {
    runId?: string | null;
    question: string;
    answer: string;
    thread: ThreadMessage[];
  }) {
    if (tier === "0") {
      setAutosaveState("unavailable");
      setAutosaveMessage(tm("crosscheck.autosave.freePlan", "Permanent autosave is available on paid plans."));
      return;
    }

    setAutosaveState("saving");
    setAutosaveMessage(tm("crosscheck.autosave.saving", "Saving automatically…"));

    const payload = {
      runId: args.runId || undefined,
      title: clampTitleFromQuestion(question),
      jurisdiction: jurisdiction.trim() || undefined,
      facts: facts.trim() || undefined,
      globalDefaults: globalDefaults.trim() || undefined,
      runOverrides: runOverrides.trim() || undefined,
      question: question.trim(),
      answer: args.answer,
      caveats: derivedConsensus.caveats || [],
      followups: derivedConsensus.followups || [],
      disagreements: derivedConsensus.disagreements || [],
      confidence: derivedConsensus.confidence,
      thread: args.thread,
    };

    try {
      const r = await fetch("/api/runs/autosave", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = (await r.json().catch(() => null)) as any;

      if (!r.ok || !j?.ok) {
        setAutosaveState("error");
        setAutosaveMessage(j?.error || tm("crosscheck.autosave.failed", "Autosave failed."));
        return;
      }

      const nextRunId = String(j.runId || args.runId || crypto.randomUUID());
      setCurrentRunId(nextRunId);
      setAutosaveState("saved");
      setAutosaveMessage(tm("crosscheck.autosave.saved", "Saved automatically."));

      upsertLocalRun({
        id: nextRunId,
        createdAt: Date.now(),
        title: clampTitleFromQuestion(question),
        jurisdiction: jurisdiction.trim() || undefined,
        facts: facts.trim() || undefined,
        globalDefaults: globalDefaults.trim() || undefined,
        runOverrides: runOverrides.trim() || undefined,
        question: question.trim(),
        answer: args.answer,
        caveats: derivedConsensus.caveats || [],
        followups: derivedConsensus.followups || [],
        disagreements: derivedConsensus.disagreements || [],
        confidence: derivedConsensus.confidence,
        thread: args.thread,
      });
    } catch (e: any) {
      setAutosaveState("error");
      setAutosaveMessage(e?.message || tm("crosscheck.autosave.failed", "Autosave failed."));
    }
  }

  function loadRun(r: SavedRun) {
    setSelectedId(r.id);
    setCurrentRunId(r.id);
    setJurisdiction(r.jurisdiction || "");
    setFacts(r.facts || "");
    setGlobalDefaults(r.globalDefaults || globalDefaults);
    setRunOverrides(r.runOverrides || "");
    setQuestion(r.question || "");

    const restoredThread =
      r.thread && r.thread.length
        ? r.thread
        : [
            ...(r.question?.trim() ? [newMsg("user", r.question.trim())] : []),
            ...(r.answer?.trim() ? [newMsg("assistant", r.answer.trim())] : []),
          ];

    setThread(restoredThread);

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
    setFollowUp("");
    setAutosaveState(tier === "0" ? "unavailable" : "saved");
    setAutosaveMessage(
      tier === "0"
        ? tm("crosscheck.autosave.freePlan", "Permanent autosave is available on paid plans.")
        : tm("crosscheck.autosave.saved", "Saved automatically.")
    );
  }

  function deleteRun(id: string) {
    const next = history.filter((h) => h.id !== id);
    setHistory(next);
    persistRuns(next);
    if (selectedId === id) setSelectedId(null);
    if (currentRunId === id) setCurrentRunId(null);
  }

  function applyMissingFactsToFacts() {
    const followups = derivedConsensus.followups ?? [];
    if (!followups.length) return;
    const block = followups.map((f) => `• ${f}`).join("\n");
    const prefix = facts.trim() ? `${facts.trim()}\n\n` : "";
    setFacts(`${prefix}${tm("crosscheck.missingFactsBlockTitle", "Missing facts to confirm:")}\n${block}\n`);
  }

  function requestReset() {
    setConfirmResetOpen(true);
  }

  function doFullReset() {
    setConfirmResetOpen(false);
    setResp(null);
    setError(null);
    setThread([]);
    setFollowUp("");
    setFollowUpLoading(false);
    setOutputStyle("answer");
    setFacts("");
    setQuestion("");
    setRunOverrides("");
    setSelectedId(null);
    setCurrentRunId(null);
    setAutosaveState("idle");
    setAutosaveMessage("");
  }

  function updateRateFromHeaders(h: Headers) {
    const next: RateUi = {
      tier: (h.get("x-taxaipro-tier") as Tier | null) || undefined,
      limit: parseIntOrUndef(h.get("x-ratelimit-limit")),
      used: parseIntOrUndef(h.get("x-ratelimit-used")),
      remaining: parseIntOrUndef(h.get("x-ratelimit-remaining")),
      resetAt: h.get("x-ratelimit-reset") || undefined,
    };

    setRate((prev) => ({ ...prev, ...next }));

    if (next.tier === "0" || next.tier === "1" || next.tier === "2") {
      setTierLocal(next.tier);
    }

    if (typeof next.remaining === "number" && next.remaining === 0) {
      setUpgradeOpen(true);
    }
  }

  async function startCheckout(target: PaidTier) {
    setError(null);

    if (tier === target) {
      setUpgradeOpen(false);
      return;
    }

    setCheckoutLoadingTier(target);
    try {
      const r = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier: target }),
      });

      const j = (await r.json().catch(() => null)) as any;

      if (!r.ok || !j?.ok || !j?.url) {
        setError(j?.error || `Checkout failed (${r.status})`);
        return;
      }

      window.location.href = j.url;
    } catch (e: any) {
      setError(e?.message || "Checkout failed.");
    } finally {
      setCheckoutLoadingTier(null);
    }
  }

  async function run() {
    setError(null);
    setResp(null);

    const q = question.trim();
    if (!q) {
      setError(tm("crosscheck.errors.typeQuestion", "Type a question first."));
      return;
    }

    const userMsg = newMsg("user", q);
    const baseThread = [...thread, userMsg];
    setThread(baseThread);

    setLoading(true);
    try {
      const r = await fetch("/api/ui/crosscheck", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taxaipro-tier": tier,
        },
        body: JSON.stringify({
          jurisdiction: jurisdiction.trim() || undefined,
          facts: facts.trim() || undefined,
          constraints,
          question: q,
        }),
      });

      updateRateFromHeaders(r.headers);

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
        if (r.status === 429) setUpgradeOpen(true);
        setError(parsed?.error || `Request failed (${r.status})`);
        return;
      }

      setResp(parsed);

      const ans = deriveConsensus(parsed).answer.trim();
      const finalThread = ans ? [...baseThread, newMsg("assistant", ans)] : baseThread;
      setThread(finalThread);

      if (ans) {
        await autosaveRun({
          runId: currentRunId,
          question: q,
          answer: ans,
          thread: finalThread,
        });
      } else if (tier === "0") {
        setAutosaveState("unavailable");
        setAutosaveMessage(tm("crosscheck.autosave.freePlan", "Permanent autosave is available on paid plans."));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : tm("crosscheck.errors.requestFailed", "Request failed.");
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function runFollowUp() {
    setError(null);

    const follow = followUp.trim();
    if (!follow) {
      setError(tm("crosscheck.errors.typeFollowup", "Type a follow-up first."));
      return;
    }

    const prior = derivedConsensus.answer.trim();
    if (!prior) {
      setError(tm("crosscheck.errors.runInitialFirst", "Run the initial question first to create a baseline answer."));
      return;
    }

    const baseQ = question.trim();
    if (!baseQ) {
      setError(tm("crosscheck.errors.typeOriginalQuestion", "Type an original question first."));
      return;
    }

    setFollowUpLoading(true);

    const userMsg = newMsg("user", follow);
    const baseThread = [...thread, userMsg];
    setThread(baseThread);

    try {
      const composite = buildCompositeFollowUpPrompt({
        originalQuestion: baseQ,
        priorConsensusAnswer: prior,
        followUpQuestion: follow,
      });

      const r = await fetch("/api/ui/crosscheck", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taxaipro-tier": tier,
        },
        body: JSON.stringify({
          jurisdiction: jurisdiction.trim() || undefined,
          facts: facts.trim() || undefined,
          constraints,
          question: composite,
        }),
      });

      updateRateFromHeaders(r.headers);

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
        if (r.status === 429) setUpgradeOpen(true);
        setError(parsed?.error || `Request failed (${r.status})`);
        return;
      }

      setResp(parsed);

      const ans = deriveConsensus(parsed).answer.trim();
      const finalThread = ans ? [...baseThread, newMsg("assistant", ans)] : baseThread;
      setThread(finalThread);

      if (ans) {
        await autosaveRun({
          runId: currentRunId,
          question: baseQ,
          answer: ans,
          thread: finalThread,
        });
      } else if (tier === "0") {
        setAutosaveState("unavailable");
        setAutosaveMessage(tm("crosscheck.autosave.freePlan", "Permanent autosave is available on paid plans."));
      }

      setFollowUp("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : tm("crosscheck.errors.requestFailed", "Request failed.");
      setError(msg);
    } finally {
      setFollowUpLoading(false);
    }
  }

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    } finally {
      try {
        localStorage.removeItem(LS_TIER_KEY);
        localStorage.removeItem(LS_ACTIVE_THREAD);
      } catch {}
      router.replace(localizePath("/signin"));
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

  const systemTone = failed.length > 0 && succeeded.length === 0 ? "bad" : failed.length > 0 ? "warn" : "good";
  const systemLabel =
    failed.length > 0 && succeeded.length === 0
      ? tm("crosscheck.system.degraded", "Degraded")
      : failed.length > 0
      ? tm("crosscheck.system.partial", "Partial")
      : resp
      ? tm("crosscheck.system.healthy", "Healthy")
      : "—";

  const hasBaselineAnswer = !!derivedConsensus.answer.trim();

  const hasUnsavedWork = useMemo(() => {
    return !!(
      question.trim() ||
      facts.trim() ||
      runOverrides.trim() ||
      followUp.trim() ||
      thread.length ||
      derivedConsensus.answer.trim()
    );
  }, [question, facts, runOverrides, followUp, thread.length, derivedConsensus.answer]);

  const runsLeft = typeof rate.remaining === "number" ? (rate.remaining === -1 ? "∞" : String(rate.remaining)) : null;
  const resetLocal = formatResetLocal(rate.resetAt);

  const disagreementsCount = derivedConsensus.disagreements.length;
  const missingFactsCount = derivedConsensus.followups.length;
  const showStrongPremium =
    confidence === "low" ||
    disagreementsCount > 0 ||
    missingFactsCount > 0 ||
    (resp && !derivedConsensus.answer.trim());

  const EXAMPLES = useMemo(
    () => [
      {
        label: tm("crosscheck.examples.usInbound.label", "US inbound services — WHT + PE risk"),
        jurisdiction: "United States",
        question: tm(
          "crosscheck.examples.usInbound.question",
          "A foreign parent provides management services to a US subsidiary. What are the key US federal tax risks (WHT, PE/ECI, transfer pricing documentation), and what facts change the conclusion?"
        ),
        facts: [
          tm("crosscheck.examples.usInbound.fact1", "• Foreign parent has no US entity; services delivered remotely + occasional US travel"),
          tm("crosscheck.examples.usInbound.fact2", "• Service fee: cost-plus 7% paid quarterly"),
          tm("crosscheck.examples.usInbound.fact3", "• Contract governs services; no US employees on US payroll"),
          tm("crosscheck.examples.usInbound.fact4", "• Need: ECI/PE indicators, Form W-8/W-9 positions, TP support outline"),
        ].join("\n"),
      },
      {
        label: tm("crosscheck.examples.brazilImports.label", "Brazil imports — ICMS/PIS/COFINS stack (triage)"),
        jurisdiction: "Brazil",
        question: tm(
          "crosscheck.examples.brazilImports.question",
          "Importing equipment into Brazil for resale: outline the main taxes (II, IPI, PIS/COFINS-Import, ICMS) and the top levers (NCM, ex-tarifário, special regimes). Keep it conservative and list missing facts."
        ),
        facts: [
          tm("crosscheck.examples.brazilImports.fact1", "• Importer is a Brazilian CNPJ under Lucro Real"),
          tm("crosscheck.examples.brazilImports.fact2", "• Goods are capital equipment (NCM TBD)"),
          tm("crosscheck.examples.brazilImports.fact3", "• Destination state: SP"),
          tm("crosscheck.examples.brazilImports.fact4", "• CIF known; goal is to estimate landed cost range + missing facts list"),
        ].join("\n"),
      },
      {
        label: tm("crosscheck.examples.latamHolding.label", "LATAM holding — source rules triage"),
        jurisdiction: "Panama",
        question: tm(
          "crosscheck.examples.latamHolding.question",
          "A Panama company invoices foreign clients for consulting services. Is it Panama-source income? Any local corporate tax exposure, substance concerns, or foreign withholding risk (treaty / domestic law)?"
        ),
        facts: [
          tm("crosscheck.examples.latamHolding.fact1", "• Services performed by employees located outside Panama"),
          tm("crosscheck.examples.latamHolding.fact2", "• Panama entity has director + bank account; minimal local ops"),
          tm("crosscheck.examples.latamHolding.fact3", "• Clients located in LATAM + US"),
          tm("crosscheck.examples.latamHolding.fact4", "• Need: where services performed, contract terms, withholding regimes by client country"),
        ].join("\n"),
      },
    ],
    [tm]
  );

  function applyExample(i: number) {
    const ex = EXAMPLES[i];
    if (!ex) return;
    setJurisdiction(ex.jurisdiction);
    setQuestion(ex.question);
    setFacts(ex.facts);
    setRunOverrides("");
    setResp(null);
    setError(null);
    setThread([]);
    setFollowUp("");
    setCurrentRunId(null);
    setAutosaveState("idle");
    setAutosaveMessage("");
    setExamplesOpen(false);
  }

  const corpActive = hasCorpActive();
  const loadingMessage =
    loadingSteps[loadingStepIndex] || tm("crosscheck.loading.step1", "Reviewing facts and jurisdiction");

  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute -top-48 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-[-220px] right-[-140px] h-[560px] w-[560px] rounded-full bg-white/5 blur-3xl" />
      </div>

      {isBusy ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 backdrop-blur-sm">
          <div className="w-[92vw] max-w-md rounded-3xl border border-white/10 bg-[#0B1020]/95 p-6 shadow-2xl">
            <div className="flex flex-col items-center text-center">
              <div className="relative h-14 w-14">
                <div className="absolute inset-0 rounded-full border-4 border-white/10" />
                <div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-white border-r-white" />
              </div>

              <h3 className="mt-4 text-lg font-semibold text-white">
                {tm("crosscheck.loading.title", "Analyzing your case")}
              </h3>

              <p className="mt-2 min-h-[24px] text-sm text-white/75">{loadingMessage}</p>

              <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-white/70" />
              </div>

              <p className="mt-3 text-xs text-white/45">
                {tm(
                  "crosscheck.loading.footer",
                  "This may take a few seconds because multiple models are being cross-checked."
                )}
              </p>

              <p className="mt-1 text-xs text-white/35">
                {tm("crosscheck.loading.elapsed", "Elapsed")}: {loadingElapsed}s
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="relative mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/taxaipro-logo.png"
              alt="TaxAiPro™"
              className="h-16 w-16 rounded-xl border border-white/10 bg-white/5 object-contain"
            />
            <div>
              <div className="text-sm font-semibold text-white/90">TaxAiPro™</div>
              <div className="mt-0.5 text-xs text-white/55">
                {tm("crosscheck.header.builtBy", "Built by a tax executive — for tax executives")}
              </div>
              <div className="mt-1 text-[11px] text-white/55">
                {tm("crosscheck.header.tagline", "Conservative multi-model triage")} · {tierLabel(tier)}
                {corpActive ? (
                  <span className="text-emerald-100"> · {tm("crosscheck.header.corporate", "Corporate")}</span>
                ) : null}
                {" · "}
                {tierPrice(tier)} · {tierDailyRuns(tier)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setAiWorksOpen(true)}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
            >
              {tm("crosscheck.nav.howAiWorks", "How the AI works")}
            </button>

            <button
              onClick={() => setHistoryOpen(true)}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
            >
              {tm("crosscheck.nav.history", "History")}
            </button>

            <button
              onClick={() => setUpgradeOpen(true)}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
              title={tm("crosscheck.nav.plansTitle", "Plans & upgrades")}
            >
              {tm("crosscheck.nav.plans", "Plans")}
            </button>

            <button
              onClick={() => go("/corporate")}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
              title={tm("crosscheck.nav.corporateTitle", "Corporate plan")}
            >
              {tm("crosscheck.nav.corporate", "Corporate")}
            </button>

            <button
              onClick={() => go("/formal-opinion-quote")}
              className={cn(
                "rounded-xl border px-3 py-2 text-xs font-semibold",
                showStrongPremium
                  ? "border-amber-400/30 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15"
                  : "border-white/15 bg-white/5 text-white/85 hover:bg-white/10"
              )}
              title={tm("crosscheck.nav.formalOpinionTitle", "Premium: request formal opinion quote")}
            >
              {tm("crosscheck.nav.formalOpinion", "Request formal opinion")}
            </button>

            <button
              onClick={logout}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
              title={tm("crosscheck.nav.logoutTitle", "Log out")}
            >
              {tm("crosscheck.nav.logout", "Logout")}
            </button>

            {confidence ? (
              <Pill tone={confidence === "high" ? "good" : confidence === "medium" ? "warn" : "bad"}>
                {tm("crosscheck.common.confidence", "Confidence")}: {confidence}
              </Pill>
            ) : null}

            <button
              onClick={() => setDiagnosticsOpen((v) => !v)}
              className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/70 hover:bg-white/5"
              title={tm("crosscheck.nav.diagnosticsTitle", "Diagnostics (telemetry)")}
            >
              {diagnosticsOpen
                ? tm("crosscheck.nav.hideDiagnostics", "Hide diagnostics")
                : tm("crosscheck.nav.diagnostics", "Diagnostics")}
            </button>
          </div>
        </div>

        {diagnosticsOpen ? (
          <div className="mt-3 rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={resp ? (systemTone as any) : "neutral"}>
                {tm("crosscheck.common.system", "System")}: {systemLabel}
              </Pill>
              {runtimeMs != null ? <Pill>{runtimeMs}ms</Pill> : <Pill>—</Pill>}
              {runsLeft ? (
                <Pill>{tm("crosscheck.diagnostics.runsLeft", "Runs left")}: {runsLeft}</Pill>
              ) : (
                <Pill>{tm("crosscheck.diagnostics.runsLeft", "Runs left")}: —</Pill>
              )}
              {resetLocal ? (
                <Pill>{tm("crosscheck.diagnostics.resets", "Resets")}: {resetLocal}</Pill>
              ) : (
                <Pill>{tm("crosscheck.diagnostics.resets", "Resets")}: —</Pill>
              )}
              <Pill>{tm("crosscheck.diagnostics.threadMsgs", "Thread msgs")}: {thread.length}</Pill>
              <Pill>{tm("crosscheck.diagnostics.modelsOk", "Models ok")}: {succeeded.length}</Pill>
              <Pill tone={failed.length ? "warn" : "neutral"}>
                {tm("crosscheck.diagnostics.modelsFailed", "Models failed")}: {failed.length}
              </Pill>
            </div>

            {resp?.providers?.length ? (
              <details className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                <summary className="cursor-pointer text-xs font-semibold text-white/70">
                  {tm("crosscheck.diagnostics.providerOutputs", "Provider outputs (debug)")}
                </summary>
                <div className="mt-3 space-y-3">
                  {resp.providers.map((p, idx) => (
                    <div key={idx} className="rounded-xl border border-white/10 bg-black/30 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs text-white/70">
                          <span className="font-semibold text-white/90">{p.provider}</span> · {p.model}
                        </div>
                        <div className="text-xs text-white/50">
                          {p.status !== "ok" ? <span className="text-amber-200">({p.status})</span> : null} {p.ms}ms
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
        ) : null}

        <div className="mt-5 space-y-4">
          <Card className="p-5">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="space-y-4 lg:col-span-4">
                <div>
                  <SectionTitle
                    title={tm("crosscheck.jurisdiction.title", "Jurisdiction")}
                    subtitle={tm(
                      "crosscheck.jurisdiction.subtitle",
                      "Country / state. Add treaty context in Facts if relevant."
                    )}
                  />
                  <select
                    value={jurisdiction}
                    onChange={(e) => setJurisdiction(e.target.value)}
                    className="mt-3 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                  >
                    <option value="">{tm("crosscheck.jurisdiction.choose", "Choose your Jurisdiction Here")}</option>

                    <optgroup label={tm("crosscheck.jurisdiction.usa", "USA")}>
                      <option value="United States">
                        {tm("crosscheck.jurisdiction.unitedStates", "United States")}
                      </option>
                      <option value="Canada">{tm("crosscheck.jurisdiction.canada", "Canada")}</option>
                    </optgroup>

                    <optgroup label={tm("crosscheck.jurisdiction.latam", "LATAM")}>
                      <option value="Argentina">{tm("crosscheck.jurisdiction.argentina", "Argentina")}</option>
                      <option value="Brazil">{tm("crosscheck.jurisdiction.brazil", "Brazil")}</option>
                      <option value="Chile">{tm("crosscheck.jurisdiction.chile", "Chile")}</option>
                      <option value="Colombia">{tm("crosscheck.jurisdiction.colombia", "Colombia")}</option>
                      <option value="Mexico">{tm("crosscheck.jurisdiction.mexico", "Mexico")}</option>
                      <option value="Panama">{tm("crosscheck.jurisdiction.panama", "Panama")}</option>
                      <option value="Peru">{tm("crosscheck.jurisdiction.peru", "Peru")}</option>
                      <option value="Uruguay">{tm("crosscheck.jurisdiction.uruguay", "Uruguay")}</option>
                      <option value="Paraguay">{tm("crosscheck.jurisdiction.paraguay", "Paraguay")}</option>
                      <option value="Bolivia">{tm("crosscheck.jurisdiction.bolivia", "Bolivia")}</option>
                      <option value="Puerto Rico">{tm("crosscheck.jurisdiction.puertoRico", "Puerto Rico")}</option>
                      <option value="Ecuador">{tm("crosscheck.jurisdiction.ecuador", "Ecuador")}</option>
                      <option value="Republica Dominicana">
                        {tm("crosscheck.jurisdiction.dominicanRepublic", "Rep. Dominicana")}
                      </option>
                      <option value="Jamaica">{tm("crosscheck.jurisdiction.jamaica", "Jamaica")}</option>
                    </optgroup>

                    <optgroup label={tm("crosscheck.jurisdiction.otherGroup", "Other")}>
                      <option value="Other">{tm("crosscheck.jurisdiction.other", "Other / Not listed")}</option>
                    </optgroup>
                  </select>
                </div>

                <Card className="p-0">
                  <details open className="p-5">
                    <summary className="cursor-pointer list-none select-none">
                      <SectionTitle
                        title={tm("crosscheck.facts.title", "Facts")}
                        subtitle={tm(
                          "crosscheck.facts.subtitle",
                          "Bullets only. This is what improves accuracy most."
                        )}
                        right={<Pill>{tm("crosscheck.common.recommended", "Recommended")}</Pill>}
                      />
                    </summary>

                    <textarea
                      value={facts}
                      onChange={(e) => setFacts(e.target.value)}
                      className="mt-4 min-h-[240px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
                      placeholder={[
                        tm("crosscheck.facts.placeholder1", "• Entity type, residency, ownership"),
                        tm("crosscheck.facts.placeholder2", "• Transaction flow + timing + amounts"),
                        tm("crosscheck.facts.placeholder3", "• Where title passes / where services performed"),
                        tm("crosscheck.facts.placeholder4", "• Thresholds (PE, WHT, VAT registration, etc.)"),
                      ].join("\n")}
                    />

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="text-[11px] text-white/45">
                        {tm("crosscheck.facts.helper", "Paste “Missing facts” here, then re-run.")}
                      </div>
                      <button
                        onClick={applyMissingFactsToFacts}
                        disabled={!derivedConsensus.followups.length}
                        className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10 disabled:opacity-40"
                      >
                        {tm("crosscheck.facts.pasteMissingFacts", "Paste missing facts")}
                      </button>
                    </div>
                  </details>
                </Card>
              </div>

              <div className="lg:col-span-8">
                <SectionTitle
                  title={tm("crosscheck.caseQuestion.title", "Case question")}
                  subtitle={tm(
                    "crosscheck.caseQuestion.subtitle",
                    "One clear question. Put detail in Facts. Use Examples if you want a template."
                  )}
                />
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  className="mt-3 min-h-[160px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                  placeholder={tm(
                    "crosscheck.caseQuestion.placeholder",
                    "Example: Does this create withholding exposure or PE/ECI risk? What facts change the result?"
                  )}
                />

                <div className="mt-3">
                  <details open={examplesOpen} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <summary
                      className="cursor-pointer select-none list-none text-xs font-semibold text-white/70"
                      onClick={(e) => {
                        e.preventDefault();
                        setExamplesOpen((v) => !v);
                      }}
                    >
                      {examplesOpen
                        ? tm("crosscheck.examples.hide", "Hide examples")
                        : tm("crosscheck.examples.show", "Show examples")}
                      <span className="ml-2 text-[11px] text-white/45">
                        {tm(
                          "crosscheck.examples.subtitle",
                          "Load a full template (Jurisdiction + Question + Facts)"
                        )}
                      </span>
                    </summary>

                    {examplesOpen ? (
                      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                        {EXAMPLES.map((ex, i) => (
                          <button
                            key={i}
                            onClick={() => applyExample(i)}
                            className="rounded-2xl border border-white/10 bg-black/25 px-3 py-3 text-left hover:bg-white/5"
                          >
                            <div className="text-xs font-semibold text-white/85">{ex.label}</div>
                            <div className="mt-1 text-[11px] text-white/55">
                              {tm("crosscheck.examples.clickToLoad", "Click to load")}
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </details>
                </div>

                <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="text-xs text-white/50">
                    {tm("crosscheck.caseQuestion.helper", "Run → review Missing facts → paste into Facts → re-run.")}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={run}
                      disabled={loading}
                      className="h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-50"
                    >
                      {loading ? tm("crosscheck.actions.running", "Running…") : tm("crosscheck.actions.run", "Run")}
                    </button>

                    <button
                      onClick={requestReset}
                      className="h-10 rounded-xl border border-white/15 bg-white/5 px-3 text-sm text-white/85 hover:bg-white/10"
                      title={tm("crosscheck.actions.resetTitle", "Resets the current case state.")}
                    >
                      {tm("crosscheck.actions.resetCase", "Reset case")}
                    </button>
                  </div>
                </div>

                {error ? (
                  <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-100">
                    {error}
                  </div>
                ) : null}

                <div className="mt-3 text-[11px] text-white/45">
                  {tier === "0"
                    ? tm(
                        "crosscheck.caseQuestion.threadNoteFree",
                        "Free tier does not include permanent autosave. Paid plans save analyses automatically."
                      )
                    : tm(
                        "crosscheck.caseQuestion.threadNotePaid",
                        "Paid plans save analyses automatically after each successful run."
                      )}
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle
              title={tm("crosscheck.output.title", "Output")}
              subtitle={tm("crosscheck.output.subtitle", "Export-ready: Answer, Memo, or Email draft.")}
              right={
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setOutputStyle("answer")}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs border",
                      outputStyle === "answer"
                        ? "border-white bg-white text-black"
                        : "border-white/15 text-white/80 hover:bg-white/5"
                    )}
                  >
                    {tm("crosscheck.output.answer", "Answer")}
                  </button>
                  <button
                    onClick={() => setOutputStyle("memo")}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs border",
                      outputStyle === "memo"
                        ? "border-white bg-white text-black"
                        : "border-white/15 text-white/80 hover:bg-white/5"
                    )}
                  >
                    {tm("crosscheck.output.memo", "Memo")}
                  </button>
                  <button
                    onClick={() => setOutputStyle("email")}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs border",
                      outputStyle === "email"
                        ? "border-white bg-white text-black"
                        : "border-white/15 text-white/80 hover:bg-white/5"
                    )}
                  >
                    {tm("crosscheck.output.email", "Email")}
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
                {tm("crosscheck.actions.copy", "Copy")}
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
                {tm("crosscheck.actions.download", "Download")}
              </button>

              <div className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85">
                {autosaveState === "saving"
                  ? tm("crosscheck.autosave.saving", "Saving automatically…")
                  : autosaveState === "saved"
                  ? tm("crosscheck.autosave.saved", "Saved automatically.")
                  : autosaveState === "unavailable"
                  ? tm("crosscheck.autosave.freePlan", "Permanent autosave is available on paid plans.")
                  : autosaveState === "error"
                  ? autosaveMessage || tm("crosscheck.autosave.failed", "Autosave failed.")
                  : tier === "0"
                  ? tm("crosscheck.autosave.freePlan", "Permanent autosave is available on paid plans.")
                  : tm("crosscheck.autosave.ready", "Ready to autosave")}
              </div>

              <div className="ml-auto flex items-center gap-2">
                {resp ? (
                  <Pill tone={systemTone as any}>
                    {tm("crosscheck.common.system", "System")}: {systemLabel}
                  </Pill>
                ) : (
                  <Pill>{tm("crosscheck.common.system", "System")}: —</Pill>
                )}
                {confidence ? (
                  <Pill tone={confidence === "high" ? "good" : confidence === "medium" ? "warn" : "bad"}>
                    {tm("crosscheck.common.confidence", "Confidence")}: {confidence}
                  </Pill>
                ) : null}
              </div>
            </div>

            <div className="mt-4 min-h-[420px] rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <pre className="whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-900">
                {displayText || "—"}
              </pre>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-white/80">
                    {tm("crosscheck.followup.title", "Follow-up")}
                  </div>
                  <div className="mt-1 text-[11px] text-white/50">
                    {tm("crosscheck.followup.subtitle", "Continues the same case with context.")}
                  </div>
                </div>
                <Pill tone={hasBaselineAnswer ? "good" : "neutral"}>
                  {hasBaselineAnswer
                    ? tm("crosscheck.followup.ready", "Ready")
                    : tm("crosscheck.followup.runFirst", "Run first")}
                </Pill>
              </div>

              <textarea
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                className="mt-3 min-h-[90px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
                placeholder={tm(
                  "crosscheck.followup.placeholder",
                  "Example: If services are performed partly in-country, does that change source rules / PE risk?"
                )}
              />

              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-[11px] text-white/45">
                  {tier === "0"
                    ? tm("crosscheck.followup.helperFree", "Follow-ups are not permanently saved on the free tier.")
                    : tm("crosscheck.followup.helperPaid", "Follow-ups are autosaved to the same paid case history item.")}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={runFollowUp}
                    disabled={followUpLoading || !hasBaselineAnswer}
                    className="h-10 rounded-xl bg-white px-4 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-50"
                  >
                    {followUpLoading
                      ? tm("crosscheck.actions.running", "Running…")
                      : tm("crosscheck.actions.runFollowup", "Run follow-up")}
                  </button>
                  <button
                    onClick={() => setFollowUp("")}
                    disabled={!followUp.trim() || followUpLoading}
                    className="h-10 rounded-xl border border-white/15 bg-white/5 px-3 text-sm text-white/85 hover:bg-white/10 disabled:opacity-40"
                  >
                    {tm("crosscheck.actions.clear", "Clear")}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="text-xs font-semibold text-white/70">
                  {tm("crosscheck.caveats.title", "Caveats")}
                </div>
                <div className="mt-2 space-y-1 text-sm text-white/80">
                  {derivedConsensus.caveats.length ? (
                    derivedConsensus.caveats.slice(0, 6).map((c, i) => <div key={i}>• {c}</div>)
                  ) : (
                    <div className="text-white/50">{tm("crosscheck.common.noneYet", "None yet.")}</div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-white/70">
                    {tm("crosscheck.missingFacts.title", "Missing facts")}
                  </div>
                  {derivedConsensus.followups.length ? (
                    <button
                      onClick={applyMissingFactsToFacts}
                      className="rounded-xl border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-white/85 hover:bg-white/10"
                    >
                      {tm("crosscheck.missingFacts.pasteToFacts", "Paste to Facts")}
                    </button>
                  ) : null}
                </div>

                <div className="mt-2 space-y-1 text-sm text-white/80">
                  {derivedConsensus.followups.length ? (
                    derivedConsensus.followups.slice(0, 6).map((c, i) => <div key={i}>• {c}</div>)
                  ) : (
                    <div className="text-white/50">{tm("crosscheck.common.noneYet", "None yet.")}</div>
                  )}
                </div>
              </div>
            </div>

            <p className="mt-4 text-[11px] text-white/40">
              {tm("crosscheck.footer.disclaimer", "TaxAiPro™ generates drafts for triage only — not legal or tax advice.")}
            </p>
          </Card>

          <Card className="p-0">
            <details open={false} className="p-5">
              <summary className="cursor-pointer list-none select-none">
                <SectionTitle
                  title={tm("crosscheck.advanced.title", "Advanced")}
                  subtitle={tm("crosscheck.advanced.subtitle", "Defaults + run overrides (power users).")}
                  right={<Pill>{tm("crosscheck.common.optional", "Optional")}</Pill>}
                />
              </summary>

              <div className="mt-4 space-y-4">
                <div>
                  <div className="text-xs font-semibold text-white/70">
                    {tm("crosscheck.advanced.globalDefaults", "Global defaults")}
                  </div>
                  <div className="mt-1 text-[11px] text-white/45">
                    {tm("crosscheck.advanced.globalDefaultsHelper", "Stable posture across runs.")}
                  </div>
                  <textarea
                    value={globalDefaults}
                    onChange={(e) => setGlobalDefaults(e.target.value)}
                    className="mt-2 min-h-[140px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
                  />
                </div>

                <div>
                  <div className="text-xs font-semibold text-white/70">
                    {tm("crosscheck.advanced.runOverrides", "Run overrides")}
                  </div>
                  <div className="mt-1 text-[11px] text-white/45">
                    {tm(
                      "crosscheck.advanced.runOverridesHelper",
                      "Only for this run (e.g., “focus only on withholding”)."
                    )}
                  </div>
                  <textarea
                    value={runOverrides}
                    onChange={(e) => setRunOverrides(e.target.value)}
                    className="mt-2 min-h-[90px] w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-white/20"
                    placeholder={tm(
                      "crosscheck.advanced.runOverridesPlaceholder",
                      "Example: Focus only on withholding + treaty relief."
                    )}
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={() => setRunOverrides("")}
                      disabled={!runOverrides.trim()}
                      className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10 disabled:opacity-40"
                    >
                      {tm("crosscheck.actions.clearOverrides", "Clear overrides")}
                    </button>
                  </div>
                </div>

                {resp?.providers?.length ? (
                  <details className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <summary className="cursor-pointer text-xs font-semibold text-white/70">
                      {tm("crosscheck.diagnostics.providerOutputs", "Provider outputs (debug)")}
                    </summary>
                    <div className="mt-3 space-y-3">
                      {resp.providers.map((p, idx) => (
                        <div key={idx} className="rounded-xl border border-white/10 bg-black/30 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs text-white/70">
                              <span className="font-semibold text-white/90">{p.provider}</span> · {p.model}
                            </div>
                            <div className="text-xs text-white/50">
                              {p.status !== "ok" ? <span className="text-amber-200">({p.status})</span> : null} {p.ms}ms
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

          {derivedConsensus.disagreements.length ? (
            <Card className="p-5">
              <SectionTitle
                title={tm("crosscheck.disagreements.title", "Disagreements")}
                subtitle={tm("crosscheck.disagreements.subtitle", "Where models differed. Add facts and re-run.")}
              />
              <div className="mt-3 space-y-2 text-sm text-white/80">
                {derivedConsensus.disagreements.map((d, i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-black/25 p-3">
                    {d}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>

        {aiWorksOpen ? (
          <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" onMouseDown={() => setAiWorksOpen(false)}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div
              className="absolute left-1/2 top-1/2 w-[92vw] max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#070A12]/95 p-5 shadow-2xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white/90">
                    {tm("crosscheck.aiWorks.title", "How the AI analysis works")}
                  </div>
                  <div className="mt-1 text-xs text-white/55">
                    {tm("crosscheck.aiWorks.subtitle", "Clear positioning for professional users")}
                  </div>
                </div>
                <button onClick={() => setAiWorksOpen(false)} className="text-white/60 hover:text-white" aria-label="Close">
                  ✕
                </button>
              </div>

              <div className="mt-4 space-y-3 text-sm leading-6 text-white/80">
                <p>
                  {tm(
                    "crosscheck.aiWorks.p1",
                    "TaxAiPro is not a standalone large language model. It is a multi-model tax analysis platform."
                  )}
                </p>
                <p>
                  {tm(
                    "crosscheck.aiWorks.p2",
                    "When you run an analysis, the platform sends your tax question to several advanced AI models, compares the responses, and produces a structured result."
                  )}
                </p>
                <p>
                  {tm(
                    "crosscheck.aiWorks.p3",
                    "The output is designed to highlight preliminary conclusions, caveats, missing facts, and areas where models disagree."
                  )}
                </p>
                <p>
                  {tm(
                    "crosscheck.aiWorks.p4",
                    "The platform improves over time through prompt engineering, workflow design, and better comparison logic — not by claiming to be its own tax-trained LLM."
                  )}
                </p>
                <p className="text-white/55">
                  {tm(
                    "crosscheck.aiWorks.p5",
                    "TaxAiPro is a tax triage tool for professionals and does not replace professional judgment or primary-source validation."
                  )}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {upgradeOpen ? (
          <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" onMouseDown={() => setUpgradeOpen(false)}>
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div
              className="absolute left-1/2 top-1/2 w-[92vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#070A12]/95 p-5 shadow-2xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white/90">
                    {tm("crosscheck.plans.title", "Plans & tiers")}
                  </div>
                  <div className="mt-1 text-xs text-white/55">
                    {tm("crosscheck.plans.subtitle", "Upgrade increases daily runs. Resets daily (UTC midnight).")}
                  </div>
                  {runsLeft ? (
                    <div className="mt-2 text-[11px] text-white/55">
                      {tm("crosscheck.plans.runsLeftToday", "Runs left today")}:{" "}
                      <span className="text-white/85">{runsLeft}</span>
                      {resetLocal ? (
                        <span className="text-white/40">
                          {" "}
                          · {tm("crosscheck.plans.resets", "Resets")} {resetLocal}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <button onClick={() => setUpgradeOpen(false)} className="text-white/60 hover:text-white" aria-label="Close">
                  ✕
                </button>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                <div
                  className={cn(
                    "rounded-2xl border p-4",
                    tier === "0" ? "border-white/25 bg-white/5" : "border-white/10 bg-black/25"
                  )}
                >
                  <div className="text-xs font-semibold text-white/85">
                    {tm("crosscheck.plans.tier0", "Tier 0 — Simple")}
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-white">$0</div>
                  <div className="mt-1 text-xs text-white/60">{tm("crosscheck.plans.runs5", "Runs: 5/day")}</div>
                  <div className="mt-2 text-[11px] text-white/45">
                    {tm("crosscheck.plans.noPermanentHistory", "No permanent autosave")}
                  </div>
                  <button
                    onClick={() => {
                      setTierLocal("0");
                      setUpgradeOpen(false);
                    }}
                    className={cn(
                      "mt-3 w-full rounded-xl px-3 py-2 text-xs font-semibold",
                      tier === "0"
                        ? "bg-white text-black"
                        : "border border-white/15 bg-white/5 text-white/85 hover:bg-white/10"
                    )}
                  >
                    {tier === "0"
                      ? tm("crosscheck.plans.current", "Current")
                      : tm("crosscheck.plans.startFree", "Start free")}
                  </button>
                </div>

                <div
                  className={cn(
                    "rounded-2xl border p-4",
                    tier === "1" ? "border-white/25 bg-white/5" : "border-white/10 bg-black/25"
                  )}
                >
                  <div className="text-xs font-semibold text-white/85">
                    {tm("crosscheck.plans.tier1", "Tier 1 — Pro")}
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-white">$5.99</div>
                  <div className="mt-1 text-xs text-white/60">
                    {tm("crosscheck.plans.perMonth25", "per month · 25/day")}
                  </div>
                  <div className="mt-2 text-[11px] text-white/45">
                    {tm("crosscheck.plans.autosaveIncluded", "Autosave included")}
                  </div>
                  <button
                    onClick={() => startCheckout("1")}
                    disabled={checkoutLoadingTier !== null}
                    className={cn(
                      "mt-3 w-full rounded-xl px-3 py-2 text-xs font-semibold",
                      tier === "1" ? "bg-white text-black" : "bg-white text-black hover:bg-white/90",
                      checkoutLoadingTier !== null && "cursor-not-allowed opacity-60"
                    )}
                  >
                    {tier === "1"
                      ? tm("crosscheck.plans.current", "Current")
                      : checkoutLoadingTier === "1"
                      ? tm("crosscheck.plans.openingStripe", "Opening Stripe…")
                      : tm("crosscheck.plans.chooseTier1", "Choose Tier 1")}
                  </button>
                </div>

                <div
                  className={cn(
                    "rounded-2xl border p-4",
                    tier === "2" ? "border-white/25 bg-white/5" : "border-white/10 bg-black/25"
                  )}
                >
                  <div className="text-xs font-semibold text-white/85">
                    {tm("crosscheck.plans.tier2", "Tier 2 — Unlimited")}
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-white">$19.99</div>
                  <div className="mt-1 text-xs text-white/60">
                    {tm("crosscheck.plans.perMonthUnlimited", "per month · unlimited")}
                  </div>
                  <div className="mt-2 text-[11px] text-white/45">
                    {tm("crosscheck.plans.autosaveIncluded", "Autosave included")}
                  </div>
                  <button
                    onClick={() => startCheckout("2")}
                    disabled={checkoutLoadingTier !== null}
                    className={cn(
                      "mt-3 w-full rounded-xl px-3 py-2 text-xs font-semibold",
                      tier === "2" ? "bg-white text-black" : "bg-white text-black hover:bg-white/90",
                      checkoutLoadingTier !== null && "cursor-not-allowed opacity-60"
                    )}
                  >
                    {tier === "2"
                      ? tm("crosscheck.plans.current", "Current")
                      : checkoutLoadingTier === "2"
                      ? tm("crosscheck.plans.openingStripe", "Opening Stripe…")
                      : tm("crosscheck.plans.chooseTier2", "Choose Tier 2")}
                  </button>
                </div>

                <div
                  className={cn(
                    "rounded-2xl border p-4",
                    corpActive ? "border-emerald-500/30 bg-emerald-500/10" : "border-white/10 bg-black/25"
                  )}
                >
                  <div className="text-xs font-semibold text-white/85">
                    {tm("crosscheck.plans.corporate", "Corporate — 5 seats")}
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-white">$79.99</div>
                  <div className="mt-1 text-xs text-white/60">
                    {tm("crosscheck.plans.perMonthTeam", "per month · Tier 2 for team")}
                  </div>
                  <div className="mt-2 text-[11px] text-white/45">
                    {tm("crosscheck.plans.autosaveIncluded", "Autosave included")}
                  </div>
                  <button
                    onClick={() => go("/corporate")}
                    className={cn(
                      "mt-3 w-full rounded-xl px-3 py-2 text-xs font-semibold",
                      corpActive ? "bg-white text-black" : "bg-white text-black hover:bg-white/90"
                    )}
                  >
                    {corpActive
                      ? tm("crosscheck.plans.manageCorporate", "Manage Corporate")
                      : tm("crosscheck.plans.openCorporate", "Open Corporate")}
                  </button>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-3 text-[11px] text-white/55">
                {tm(
                  "crosscheck.plans.footer",
                  "Paid tiers use Stripe Checkout/Payment Links. Corporate redirects back with ?tier=corp&session_id=... which activates Tier 2 locally (MVP)."
                )}
              </div>
            </div>
          </div>
        ) : null}

        {confirmResetOpen ? (
          <div
            className="fixed inset-0 z-50"
            role="dialog"
            aria-modal="true"
            onMouseDown={() => setConfirmResetOpen(false)}
          >
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
            <div
              className="absolute left-1/2 top-1/2 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#070A12]/95 p-5 shadow-2xl"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="text-sm font-semibold text-white/90">
                {tm("crosscheck.resetModal.title", "Reset current case?")}
              </div>
              <div className="mt-2 text-xs text-white/55">
                {tm(
                  "crosscheck.resetModal.body",
                  "This will clear the current question, facts, overrides, output, and follow-up thread."
                )}
                {hasUnsavedWork
                  ? tm("crosscheck.resetModal.unsaved", " If you haven’t exported anything, this conversation will be lost.")
                  : ""}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => setConfirmResetOpen(false)}
                  className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
                >
                  {tm("crosscheck.common.cancel", "Cancel")}
                </button>
                <button
                  onClick={doFullReset}
                  className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-white/90"
                >
                  {tm("crosscheck.resetModal.confirm", "Yes, reset")}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {historyOpen ? (
          <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" onMouseDown={() => setHistoryOpen(false)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div
              className="absolute right-0 top-0 h-full w-[92vw] max-w-md border-l border-white/10 bg-[#070A12]/95 p-4"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white/90">
                    {tm("crosscheck.history.title", "Case history")}
                  </div>
                  <div className="mt-1 text-xs text-white/50">
                    {tier === "0"
                      ? tm(
                          "crosscheck.history.subtitleFree",
                          "Free tier does not include permanent case history."
                        )
                      : tm(
                          "crosscheck.history.subtitlePaid",
                          "Recent local mirror of your autosaved paid runs on this device."
                        )}
                  </div>
                </div>
                <button onClick={() => setHistoryOpen(false)} className="text-white/60 hover:text-white" aria-label="Close">
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
                        <div className="line-clamp-2 text-xs font-semibold text-white/85">{h.title}</div>
                        <div className="mt-1 text-[11px] text-white/45">
                          {new Date(h.createdAt).toLocaleDateString()} · {h.jurisdiction || "—"} ·{" "}
                          {h.confidence
                            ? `${tm("crosscheck.history.conf", "Conf")}: ${h.confidence}`
                            : `${tm("crosscheck.history.conf", "Conf")}: —`}
                          {h.thread?.length
                            ? ` · ${tm("crosscheck.history.turns", "Turns")}: ${Math.max(
                                0,
                                Math.floor(h.thread.length / 2)
                              )}`
                            : ""}
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
                          {tm("crosscheck.history.open", "Open")}
                        </button>
                        <button onClick={() => deleteRun(h.id)} className="text-xs text-white/55 hover:text-white/80">
                          {tm("crosscheck.history.delete", "Delete")}
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-white/10 bg-black/25 p-3 text-xs text-white/50">
                    {tier === "0"
                      ? tm(
                          "crosscheck.history.emptyFree",
                          "No permanent history on the free tier. Upgrade to save analyses automatically."
                        )
                      : tm("crosscheck.history.empty", "No saved runs yet.")}
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