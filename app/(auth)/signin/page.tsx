"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getFirebaseAuth } from "@/src/lib/firebase/client";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from "firebase/auth";

type ApiResp =
  | { ok: true }
  | { ok: false; error?: string };

export default function SignInPage() {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const auth = useMemo(() => getFirebaseAuth(), []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      // If already signed-in in Firebase, we still need to mint our server session cookie.
      if (!user) return;

      try {
        setBusy(true);
        setError("");

        const idToken = await user.getIdToken(true);
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
        const data = (await res.json().catch(() => ({}))) as ApiResp;

        if (!res.ok || !data.ok) {
          throw new Error((data as any)?.error || `Login failed (${res.status})`);
        }

        router.replace("/crosscheck");
      } catch (e: any) {
        setError(e?.message || "Login failed");
      } finally {
        setBusy(false);
      }
    });

    return () => unsub();
  }, [auth, router]);

  async function loginWithGoogle() {
    try {
      setBusy(true);
      setError("");

      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);

      // IMPORTANT: Firebase ID token (aud == firebase project), not Google OAuth token
      const idToken = await cred.user.getIdToken(true);

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      const data = (await res.json().catch(() => ({}))) as ApiResp;

      if (!res.ok || !data.ok) {
        throw new Error((data as any)?.error || `Login failed (${res.status})`);
      }

      router.replace("/crosscheck");
    } catch (e: any) {
      setError(e?.message || "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function loginWithEmail(e: React.FormEvent) {
    e.preventDefault();
    try {
      setBusy(true);
      setError("");

      const cred = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await cred.user.getIdToken(true);

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      const data = (await res.json().catch(() => ({}))) as ApiResp;

      if (!res.ok || !data.ok) {
        throw new Error((data as any)?.error || `Login failed (${res.status})`);
      }

      router.replace("/crosscheck");
    } catch (e: any) {
      setError(e?.message || "Email sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center font-semibold">
              TX
            </div>
            <div>
              <div className="text-xl font-semibold">Tax Crosscheck</div>
              <div className="text-sm text-white/60">Free multi-model tax triage + conservative synthesis.</div>
            </div>
          </div>

          <h2 className="text-lg font-semibold mb-2">Sign in</h2>
          <p className="text-sm text-white/60 mb-4">
            Use Google or email (email can be added next).
          </p>

          <button
            onClick={loginWithGoogle}
            disabled={busy}
            className="w-full h-12 rounded-full bg-white text-black font-medium hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? "Signing in..." : "Continue with Google"}
          </button>

          <div className="my-5 flex items-center gap-3 text-white/30">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-xs">or</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          <form onSubmit={loginWithEmail} className="space-y-3">
            <input
              className="w-full h-11 rounded-xl bg-black/40 border border-white/10 px-4 outline-none focus:border-white/30"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <input
              className="w-full h-11 rounded-xl bg-black/40 border border-white/10 px-4 outline-none focus:border-white/30"
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full h-11 rounded-xl border border-white/15 hover:bg-white/5 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy ? "Signing in..." : "Continue with email"}
            </button>
          </form>

          {error ? (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <p className="mt-4 text-xs text-white/40">
            By continuing, you agree this is informational and not legal or tax advice.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold mb-3">What you get</h2>
          <ul className="space-y-2 text-sm text-white/70">
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
  );
}
