"use client";

import Image from "next/image";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { firebaseClientConfigured, getFirebaseAuth } from "@/src/lib/firebase/client";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
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
  const [isCreate, setIsCreate] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const configured = useMemo(() => firebaseClientConfigured(), []);

  const auth = useMemo(() => {
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
      if (!auth) throw new Error("Firebase client is not configured.");
      setBusy(true);
      setError("");

      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);

      const idToken = await cred.user.getIdToken(true);
      await mintSession(idToken);

      router.replace("/crosscheck");
    } catch (e: any) {
      setError(e?.message || "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function loginOrCreateWithEmail(e: React.FormEvent) {
    e.preventDefault();

    try {
      if (!auth) throw new Error("Firebase client is not configured.");
      setBusy(true);
      setError("");

      const trimmedEmail = email.trim();

      const cred = isCreate
        ? await createUserWithEmailAndPassword(auth, trimmedEmail, password)
        : await signInWithEmailAndPassword(auth, trimmedEmail, password);

      const idToken = await cred.user.getIdToken(true);
      await mintSession(idToken);

      router.replace("/crosscheck");
    } catch (e: any) {
      // Friendly-ish errors without being noisy
      const msg =
        e?.code === "auth/user-not-found"
          ? "No account found for that email. Switch to “Create account”."
          : e?.code === "auth/wrong-password"
          ? "Incorrect password."
          : e?.code === "auth/email-already-in-use"
          ? "That email already has an account. Switch to “Sign in”."
          : e?.message || "Email sign-in failed";

      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  const disableButtons = busy || !configured;

  return (
    <div className="min-h-screen text-white">
      {/* Background */}
      <div className="fixed inset-0 -z-10">
        {/* If you want to use the image you uploaded, put it in /public and change the src here. */}
        {/* Example: src="/landing-bg.jpg" */}
        <div className="absolute inset-0 bg-black" />
        <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_0%,rgba(0,160,255,0.18),rgba(0,0,0,0)_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_10%_10%,rgba(255,255,255,0.06),rgba(0,0,0,0)_55%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black to-black" />
      </div>

      <div className="mx-auto max-w-6xl px-6">
        {/* Top bar */}
        <header className="pt-10 pb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-[140px] h-[42px]">
              <Image
                src="/taxaipro-logo.png"
                alt="TaxAiPro"
                fill
                priority
                className="object-contain"
              />
            </div>
            <div className="hidden sm:block text-xs text-white/50">
              Tax crosscheck + conservative synthesis
            </div>
          </div>

          <div className="text-xs text-white/50">
            <span className="hidden sm:inline">Brand:</span>{" "}
            <span className="text-white/70">TaxAiPro.com</span>
          </div>
        </header>

        {/* Content */}
        <main className="pb-14">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
            {/* Left: Hero */}
            <div className="lg:col-span-7">
              <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-tight">
                Multi-model tax analysis,
                <span className="text-white/70"> built to be conservative.</span>
              </h1>

              <p className="mt-4 text-base sm:text-lg text-white/60 max-w-xl">
                Ask a tax question, get a consensus answer, and see caveats + missing facts
                before you rely on it. Export to memo or email in one click.
              </p>

              <div className="mt-7 flex flex-wrap gap-2 text-xs text-white/60">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                  Triangulation across models
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                  Caveats + assumptions
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                  Missing facts checklist
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                  Memo / email export
                </span>
              </div>

              <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5 max-w-xl">
                <div className="text-sm text-white/70">
                  Tip: Better facts → better output.
                </div>
                <div className="mt-2 text-xs text-white/55">
                  Entity type, residency, thresholds, timing, and who does what in-country
                  typically drive the answer.
                </div>
              </div>

              <p className="mt-6 text-xs text-white/40 max-w-xl">
                TaxAiPro generates drafts for triage only — not legal or tax advice.
              </p>
            </div>

            {/* Right: Sign in card */}
            <div className="lg:col-span-5">
              <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-md p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">Sign in</h2>
                    <p className="mt-1 text-sm text-white/60">
                      Start with Google, or use email.
                    </p>
                  </div>
                </div>

                {!configured ? (
                  <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
                    Firebase isn’t configured. Check Vercel env vars for:
                    <div className="mt-2 text-xs text-amber-100/80">
                      NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
                      NEXT_PUBLIC_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_APP_ID
                    </div>
                  </div>
                ) : null}

                <button
                  onClick={loginWithGoogle}
                  disabled={disableButtons}
                  className="mt-5 w-full h-12 rounded-full bg-white text-black font-medium hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {busy ? "Signing in..." : "Continue with Google"}
                </button>

                <button
                  type="button"
                  onClick={() => setEmailEnabled((v) => !v)}
                  className="mt-4 w-full h-11 rounded-xl border border-white/12 bg-white/5 hover:bg-white/10 text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  disabled={!configured || busy}
                >
                  {emailEnabled ? "Hide email options" : "Continue with email"}
                </button>

                {emailEnabled ? (
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-xs text-white/60">
                        {isCreate ? "Create account" : "Sign in with email"}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsCreate((v) => !v);
                          setError("");
                        }}
                        className="text-xs text-white/60 hover:text-white"
                        disabled={busy}
                      >
                        Switch to {isCreate ? "Sign in" : "Create account"}
                      </button>
                    </div>

                    <form onSubmit={loginOrCreateWithEmail} className="space-y-3">
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
                        autoComplete={isCreate ? "new-password" : "current-password"}
                      />
                      <button
                        type="submit"
                        disabled={disableButtons}
                        className="w-full h-11 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                      >
                        {busy ? "Please wait..." : isCreate ? "Create account" : "Sign in"}
                      </button>
                    </form>
                  </div>
                ) : null}

                {error ? (
                  <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                    {error}
                  </div>
                ) : null}

                <p className="mt-5 text-xs text-white/40">
                  By continuing, you agree this is informational and not legal or tax advice.
                </p>
              </div>

              <div className="mt-4 text-xs text-white/45">
                New here? Use the 2–3 run method: run once → add missing facts → re-run.
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
