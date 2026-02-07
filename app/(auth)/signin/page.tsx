"use client";

import { useEffect, useMemo, useState } from "react";

type SessionResp = { ok: boolean; user: null | { uid: string; email?: string | null; name?: string | null; picture?: string | null } };

declare global {
  interface Window {
    google?: any;
  }
}

export default function SignInPage() {
  const [status, setStatus] = useState<"idle"|"loading"|"error"|"ready">("idle");
  const [error, setError] = useState<string>("");

  const clientId = useMemo(() => process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "", []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setStatus("loading");
      setError("");

      // If already logged in, redirect
      try {
        const s = await fetch("/api/auth/session", { cache: "no-store" }).then(r => r.json()) as SessionResp;
        if (!cancelled && s?.user) window.location.href = "/crosscheck";
      } catch {}

      if (!clientId) {
        setStatus("error");
        setError("Missing NEXT_PUBLIC_GOOGLE_CLIENT_ID");
        return;
      }

      // Load Google Identity Services
      const scriptId = "google-gsi";
      if (!document.getElementById(scriptId)) {
        const s = document.createElement("script");
        s.id = scriptId;
        s.src = "https://accounts.google.com/gsi/client";
        s.async = true;
        s.defer = true;
        document.head.appendChild(s);
      }

      const wait = async () => {
        for (let i = 0; i < 50; i++) {
          if (window.google?.accounts?.id) return true;
          await new Promise(r => setTimeout(r, 80));
        }
        return false;
      };

      const ok = await wait();
      if (!ok) {
        setStatus("error");
        setError("Google script failed to load.");
        return;
      }

      if (cancelled) return;

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (resp: any) => {
          try {
            const idToken = resp?.credential;
            if (!idToken) throw new Error("Missing credential from Google.");

            const r = await fetch("/api/auth/login", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ idToken }),
            });

            const j = await r.json();
            if (!j?.ok) throw new Error(j?.error || "Login failed");
            window.location.href = "/crosscheck";
          } catch (e: any) {
            setError(e?.message || "Login failed");
            setStatus("error");
          }
        },
      });

      setStatus("ready");
      window.google.accounts.id.renderButton(
        document.getElementById("gsi")!,
        { theme: "outline", size: "large", width: 320, shape: "pill", text: "continue_with" }
      );
    }

    init();
    return () => { cancelled = true; };
  }, [clientId]);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-white/10 flex items-center justify-center font-semibold">TX</div>
          <div>
            <div className="text-xl font-semibold">Tax Crosscheck</div>
            <div className="text-sm text-white/60">Free multi-model tax triage + conservative synthesis.</div>
          </div>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="text-lg font-semibold">Sign in</div>
            <div className="mt-2 text-sm text-white/60">
              Use Google or email (Google button uses ID tokens; email can be added next).
            </div>

            <div className="mt-6">
              <div id="gsi" />
            </div>

            {status === "loading" && <div className="mt-4 text-sm text-white/60">Loading…</div>}
            {status === "error" && <div className="mt-4 text-sm text-red-300">{error}</div>}

            <div className="mt-6 text-xs text-white/40">
              By continuing, you agree this is informational and not legal or tax advice.
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="text-lg font-semibold">What you get</div>
            <ul className="mt-3 space-y-3 text-sm text-white/70">
              <li>• Triangulation across multiple models (OpenAI + OpenRouter models).</li>
              <li>• “Best conservative answer” + missing facts + caveats.</li>
              <li>• Optional paid human review add-on (later).</li>
            </ul>
            <div className="mt-6 rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
              Tip: tighter facts → better output. Incoterms + title passage + who does what in-country.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
