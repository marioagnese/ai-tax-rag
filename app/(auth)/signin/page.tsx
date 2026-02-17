"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  firebaseClientConfigured,
  getFirebaseAuth,
} from "@/src/lib/firebase/client";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from "firebase/auth";

type ApiResp = { ok: true } | { ok: false; error?: string };

async function mintSession(idToken: string) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });

  const data = (await res.json().catch(() => ({}))) as ApiResp;

  if (!res.ok || !data.ok) {
    throw new Error((data as any)?.error || `Login failed (${res.status})`);
  }
}

export default function SignInPage() {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  const [emailEnabled, setEmailEnabled] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const configured = useMemo(() => firebaseClientConfigured(), []);

  const auth = useMemo(() => {
    // Avoid import-time crashes and show a nice message instead.
    if (!configured) return null;
    return getFirebaseAuth();
  }, [configured]);

  // Guard against duplicate onAuthStateChanged firing (dev/refresh)
  const mintedOnceRef = useRef(false);

  useEffect(() => {
    if (!auth) return;

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      if (mintedOnceRef.current) return;

      try {
        mintedOnceRef.current = true;
        setBusy(true);
        setError("");

        const idToken = await user.getIdToken(true);
        await mintSession(idToken);

        router.replace("/crosscheck");
      } catch (e: any) {
        mintedOnceRef.current = false;
        setError(e?.message || "Login failed");
      } finally {
        setBusy(false);
      }
    });

    return () => unsub();
  }, [auth, router]);

  async function loginWithGoogle() {
    try {
      if (!auth) throw new Error("Firebase client is not configured (.env.local).");
      setBusy(true);
      setError("");

      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);

      // Firebase ID token (aud == firebase project)
      const idToken = await cred.user.getIdToken(true);
      await mintSession(idToken);

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
      if (!auth) throw new Error("Firebase client is not configured (.env.local).");
      setBusy(true);
      setError("");

      const cred = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await cred.user.getIdToken(true);
      await mintSession(idToken);

      router.replace("/crosscheck");
    } catch (e: any) {
      setError(e?.message || "Email sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  const disableButtons = busy || !configured;

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left card */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="h-10 w-10 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center overflow-hidden">
              <Image
                src="/ChatGPT Image Feb 14, 2026, 04_09_11 PM.png"
                alt="TaxAiPro"
                width={40}
                height={40}
                className="h-full w-full object-contain p-1"
                priority
              />
            </div>

            <div>
              <div className="text-xl font-semibold">TaxAiPro</div>
              <div className="text-sm text-white/60">
                Multi-model tax crosscheck + conservative synthesis.
              </div>
            </div>
          </div>

          <h2 className="text-lg font-semibold mb-2">Sign in</h2>
          <p className="text-sm text-white/60 mb-4">
            Use Google to start. (Email login can be enabled later.)
          </p>

          {!configured ? (
            <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              Firebase isn’t configured. Check your <code>.env.local</code> for:
              <div className="mt-2 text-xs text-amber-100/80">
                NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_APP_ID
              </div>
            </div>
          ) : null}

          <button
            onClick={loginWithGoogle}
            disabled={disableButtons}
            className="w-full h-12 rounded-full bg-white text-black font-medium hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? "Signing in..." : "Continue with Google"}
          </button>

          <div className="mt-4 text-xs text-white/50">
            New here? Use the <span className="text-white/70">2–3 run method</span>:
            run once → add missing facts → re-run.
          </div>

          <button
            type="button"
            onClick={() => setEmailEnabled((v) => !v)}
            className="mt-5 text-xs text-white/60 hover:text-white"
          >
            {emailEnabled ? "Hide email sign-in" : "Show email sign-in"}
          </button>

          {emailEnabled ? (
            <>
              <div className="my-4 flex items-center gap-3 text-white/30">
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
                  disabled={disableButtons}
                  className="w-full h-11 rounded-xl border border-white/15 hover:bg-white/5 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {busy ? "Signing in..." : "Continue with email"}
                </button>
              </form>
            </>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <p className="mt-4 text-xs text-white/40">
            By continuing, you agree this is informational and not legal or tax advice.
          </p>
        </div>

        {/* Right card */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-lg font-semibold mb-3">What you get</h2>
          <ul className="space-y-2 text-sm text-white/70">
            <li>• Triangulation across multiple models.</li>
            <li>• Conservative “best answer” + caveats + missing facts.</li>
            <li>• Save runs + convert to memo/email (in Crosscheck).</li>
          </ul>

          <div className="mt-6 rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
            Tip: better facts → better output. Entity type, residency, thresholds, timing, and
            who does what in-country.
          </div>

          <div className="mt-4 text-xs text-white/50">
            Brand: <span className="text-white/70">TaxAiPro.com</span>
          </div>
        </div>
      </div>
    </div>
  );
}
