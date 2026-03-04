// app/corporate/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const LS_TIER_KEY = "taxaipro_tier";
const LS_CORP_KEY = "taxaipro_corp_v1";

// Your Stripe Payment Link (already created)
const STRIPE_CORP_LINK = "https://buy.stripe.com/9B65kw9rF52dbtX9oAffy06";

type CorpState = {
  active: boolean;
  seatsTotal: number;
  createdAt: number;
  sessionId?: string;
  invites: Array<{ token: string; createdAt: number; used?: boolean }>;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function readCorp(): CorpState | null {
  try {
    const raw = localStorage.getItem(LS_CORP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.active) return null;
    return parsed as CorpState;
  } catch {
    return null;
  }
}

function writeCorp(next: CorpState) {
  try {
    localStorage.setItem(LS_CORP_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export default function CorporatePage() {
  const router = useRouter();
  const [corp, setCorp] = useState<CorpState | null>(null);

  // When user returns from Stripe (we support ?tier=corp&session_id=... just like crosscheck)
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const tier = sp.get("tier");
      const sessionId = sp.get("session_id") || undefined;

      if (tier === "corp") {
        // Corporate implies Tier 2 (Unlimited)
        try {
          localStorage.setItem(LS_TIER_KEY, "2");
        } catch {}

        const next: CorpState = {
          active: true,
          seatsTotal: 5,
          createdAt: Date.now(),
          sessionId,
          invites: [],
        };
        writeCorp(next);
        setCorp(next);

        // Clean URL
        sp.delete("tier");
        sp.delete("session_id");
        const qs = sp.toString();
        const nextUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
        window.history.replaceState({}, "", nextUrl);
        return;
      }
    } catch {}

    setCorp(readCorp());
  }, []);

  const invites = corp?.invites ?? [];

  const remaining = useMemo(() => {
    const usedCount = invites.filter((i) => i.used).length;
    // NOTE: This is best-effort. True enforcement needs server-side storage.
    const createdCount = invites.length;
    const assumedFilled = Math.max(0, Math.min(5, usedCount)); // conservative
    return Math.max(0, (corp?.seatsTotal ?? 5) - assumedFilled);
  }, [corp, invites]);

  function go(path: string) {
    try {
      router.push(path);
    } catch {
      window.location.href = path;
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  }

  function generateInvite() {
    if (!corp) return;

    // Best-effort seat cap (not hard enforced without backend)
    if (invites.length >= (corp.seatsTotal ?? 5)) return;

    const token = crypto.randomUUID().replace(/-/g, "");
    const next: CorpState = {
      ...corp,
      invites: [{ token, createdAt: Date.now(), used: false }, ...invites].slice(0, corp.seatsTotal ?? 5),
    };
    writeCorp(next);
    setCorp(next);
  }

  function inviteUrl(token: string) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    // This assumes your signup route is /signup (common in your project).
    // If it differs, adjust the path here.
    return `${origin}/signup?corp=1&invite=${encodeURIComponent(token)}`;
  }

  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      <div className="mx-auto max-w-4xl px-5 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-2xl font-semibold tracking-tight">Corporate Plan</div>
            <div className="mt-1 text-sm text-white/60">5 seats · Tier 2 Unlimited · $69.95/mo</div>
          </div>

          <button
            onClick={() => go("/crosscheck")}
            className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/85 hover:bg-white/10"
          >
            Back to Crosscheck
          </button>
        </div>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          {!corp?.active ? (
            <>
              <div className="text-sm font-semibold text-white/90">Activate your company plan</div>
              <div className="mt-2 text-sm text-white/65">
                Purchase via Stripe, then you’ll be redirected back and Tier 2 will be enabled.
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <a
                  href={STRIPE_CORP_LINK}
                  className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90"
                >
                  Buy Corporate Plan ($69.95/mo)
                </a>

                <div className="text-xs text-white/45">
                  After checkout, return URL should be: <span className="text-white/70">/crosscheck?tier=corp...</span>
                </div>
              </div>

              <div className="mt-4 text-xs text-white/45">
                Note: seat enforcement is best-effort in MVP (client-side). If you want strict 5-seat enforcement, we’ll
                add Firestore-backed invite tracking next.
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-emerald-100">Corporate is active</div>
                  <div className="mt-1 text-xs text-white/55">
                    Seats: 5 total · Session: {corp.sessionId ? corp.sessionId.slice(0, 10) + "…" : "—"}
                  </div>
                </div>
                <div className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100">
                  Tier 2 Enabled
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  onClick={generateInvite}
                  className={cn(
                    "rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/90",
                    invites.length >= 5 && "opacity-50 cursor-not-allowed"
                  )}
                  disabled={invites.length >= 5}
                >
                  Generate invite link
                </button>

                <button
                  onClick={() => {
                    try {
                      localStorage.removeItem(LS_CORP_KEY);
                    } catch {}
                    setCorp(null);
                  }}
                  className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/85 hover:bg-white/10"
                >
                  Clear corporate state (dev)
                </button>

                <div className="ml-auto text-xs text-white/50">Remaining (best-effort): {remaining}</div>
              </div>

              <div className="mt-4 space-y-2">
                {invites.length ? (
                  invites.map((inv) => {
                    const url = inviteUrl(inv.token);
                    return (
                      <div key={inv.token} className="rounded-xl border border-white/10 bg-black/30 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-white/85">Invite</div>
                            <div className="mt-1 truncate text-xs text-white/60">{url}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => copy(url)}
                              className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/85 hover:bg-white/10"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white/60">
                    No invites yet. Click <b>Generate invite link</b>.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
