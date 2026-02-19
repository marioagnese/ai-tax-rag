// app/(auth)/signin/page.tsx
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
  sendPasswordResetEmail,
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

function isUserNotFound(err: any) {
  const code = err?.code || err?.error?.code || "";
  return code === "auth/user-not-found";
}
function isWrongPassword(err: any) {
  const code = err?.code || err?.error?.code || "";
  return code === "auth/wrong-password";
}
function isInvalidEmail(err: any) {
  const code = err?.code || err?.error?.code || "";
  return code === "auth/invalid-email";
}

export default function SignInPage() {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [info, setInfo] = useState<string>("");

  const [emailEnabled, setEmailEnabled] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
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
        setInfo("");

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
      setInfo("");

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

  async function submitEmailAuth(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (!auth) throw new Error("Firebase client is not configured (.env.local).");
      setBusy(true);
      setError("");
      setInfo("");

      if (!email.trim()) throw new Error("Please enter your email.");
      if (!password || password.length < 6) throw new Error("Password must be at least 6 characters.");

      let userCred: any;

      if (mode === "signin") {
        try {
          userCred = await signInWithEmailAndPassword(auth, email.trim(), password);
        } catch (err: any) {
          if (isUserNotFound(err)) {
            setMode("signup");
            throw new Error("No account found for this email. Click “Create account” to continue.");
          }
          if (isWrongPassword(err)) throw new Error("Incorrect password. Try again or reset your password.");
          if (isInvalidEmail(err)) throw new Error("Invalid email format.");
          throw err;
        }
      } else {
        userCred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      }

      const idToken = await userCred.user.getIdToken(true);
      await mintSession(idToken);

      router.replace("/crosscheck");
    } catch (e: any) {
      setError(e?.message || "Email sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    try {
      if (!auth) throw new Error("Firebase client is not configured (.env.local).");
      setBusy(true);
      setError("");
      setInfo("");

      if (!email.trim()) throw new Error("Enter your email first, then click “Reset password”.");
      await sendPasswordResetEmail(auth, email.trim());

      setInfo("Password reset email sent. Check your inbox.");
    } catch (e: any) {
      setError(e?.message || "Password reset failed");
    } finally {
      setBusy(false);
    }
  }

  const disableButtons = busy || !configured;

  return (
    <div className="min-h-screen text-white bg-black">
      {/* Background (you said: public/landing-bg.png) */}
      <div className="fixed inset-0 -z-10">
        <Image
          src="/landing-bg.png"
          alt="TaxAiPro background"
          fill
          priority
          className="object-cover"
        />
        {/* Blur + dark overlay */}
        <div className="absolute inset-0 backdrop-blur-2xl bg-black/70" />
        {/* Vignette / depth */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.06),transparent_55%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-black/65 to-black/90" />
      </div>

      {/* BIG FIXED LOGO (emphasis) */}
      <div className="fixed top-0 left-0 right-0 z-20 pointer-events-none">
        <div className="mx-auto max-w-6xl px-6 pt-6">
          <div className="flex items-center justify-between">
            {/* Left: big logo block */}
            <div className="pointer-events-auto">
              <div className="relative">
                {/* glow */}
                <div className="absolute -inset-6 rounded-3xl bg-white/5 blur-2xl" />
                <div className="relative flex items-center gap-4 rounded-3xl border border-white/10 bg-black/35 px-4 py-3 backdrop-blur-xl">
                  <div className="relative h-14 w-52 sm:h-16 sm:w-60 md:h-18 md:w-72">
                    <Image
                      src="/taxaipro-logo.png"
                      alt="TaxAiPro"
                      fill
                      priority
                      className="object-contain"
                    />
                  </div>
                  <div className="hidden md:block leading-tight">
                    <div className="text-sm font-semibold tracking-wide">TaxAiPro</div>
                    <div className="text-xs text-white/60">
                      Your AI tax engine — crosschecks multiple LLMs into one conservative answer.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: brand */}
            <div className="hidden sm:block text-xs text-white/55">
              Brand: <span className="text-white/75">TaxAiPro.com</span>
            </div>
          </div>
        </div>
        {/* subtle divider */}
        <div className="mt-4 h-px w-full bg-white/5" />
      </div>

      {/* Main */}
      <main className="mx-auto max-w-6xl px-6 pb-16 pt-40 sm:pt-44">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          {/* Left: hero */}
          <section className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/75">
              <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
              Same prompt. Different outputs. One conservative synthesis.
            </div>

            <h1 className="mt-5 text-4xl md:text-5xl font-semibold tracking-tight">
              Multi-model tax analysis,
              <span className="block text-white/70">built to be conservative.</span>
            </h1>

            <p className="mt-5 text-base md:text-lg text-white/70 max-w-2xl leading-relaxed">
              <span className="text-white/85 font-medium">Have you been frustrated</span> that the same prompt gets
              different answers across AI tools? TaxAiPro runs several models in parallel, compares what they say,
              flags conflicts, and rewrites one consistent, conservative output you can actually triage.
            </p>

            <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-sm font-medium">Crosscheck variance</div>
                <div className="mt-1 text-sm text-white/60">
                  See where models agree vs. disagree — before you rely on an answer.
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-sm font-medium">Conservative synthesis</div>
                <div className="mt-1 text-sm text-white/60">
                  A “best answer” with caveats + missing facts, written in one consistent voice.
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-sm font-medium">Memo / email ready</div>
                <div className="mt-1 text-sm text-white/60">
                  Export outputs in a clean format for internal review and client comms.
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="text-sm font-medium">Designed for tax reality</div>
                <div className="mt-1 text-sm text-white/60">
                  Assumptions, thresholds, documentation focus, and edge cases are explicit.
                </div>
              </div>
            </div>

            <div className="mt-8 text-xs text-white/45 max-w-2xl">
              TaxAiPro generates drafts for triage only — not legal or tax advice.
            </div>
          </section>

          {/* Right: sign-in card */}
          <aside className="lg:col-span-5">
            <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-6 shadow-2xl shadow-black/30 backdrop-blur-xl">
              {!configured ? (
                <div className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100">
                  Firebase isn’t configured. Check Vercel env vars for:
                  <div className="mt-2 text-xs text-amber-100/80">
                    NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID,
                    NEXT_PUBLIC_FIREBASE_APP_ID
                  </div>
                </div>
              ) : null}

              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Sign in</h2>
                  <p className="mt-1 text-sm text-white/60">Start with Google, or use email.</p>
                </div>

                {/* small mark inside card (keep subtle) */}
                <div className="relative h-12 w-12 opacity-90">
                  <Image src="/taxaipro-logo.png" alt="TaxAiPro" fill className="object-contain" />
                </div>
              </div>

              <button
                onClick={loginWithGoogle}
                disabled={disableButtons}
                className="mt-5 w-full h-12 rounded-2xl bg-white text-black font-medium hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? "Signing in..." : "Continue with Google"}
              </button>

              <button
                type="button"
                onClick={() => setEmailEnabled((v) => !v)}
                disabled={disableButtons}
                className="mt-3 w-full h-12 rounded-2xl border border-white/15 bg-black/20 hover:bg-white/5 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Continue with email
              </button>

              {emailEnabled ? (
                <div className="mt-5">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-white/60">{mode === "signin" ? "Email sign-in" : "Create account"}</div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setMode("signin")}
                        className={`text-xs px-2 py-1 rounded-full border ${
                          mode === "signin"
                            ? "border-white/25 bg-white/10 text-white"
                            : "border-white/10 text-white/60 hover:text-white"
                        }`}
                      >
                        Sign in
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode("signup")}
                        className={`text-xs px-2 py-1 rounded-full border ${
                          mode === "signup"
                            ? "border-white/25 bg-white/10 text-white"
                            : "border-white/10 text-white/60 hover:text-white"
                        }`}
                      >
                        Create
                      </button>
                    </div>
                  </div>

                  <form onSubmit={submitEmailAuth} className="mt-3 space-y-3">
                    <input
                      className="w-full h-11 rounded-2xl bg-black/35 border border-white/10 px-4 outline-none focus:border-white/30"
                      placeholder="Email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      inputMode="email"
                    />
                    <input
                      className="w-full h-11 rounded-2xl bg-black/35 border border-white/10 px-4 outline-none focus:border-white/30"
                      placeholder="Password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    />

                    <button
                      type="submit"
                      disabled={disableButtons}
                      className="w-full h-11 rounded-2xl border border-white/15 bg-white/5 hover:bg-white/10 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {busy ? "Working..." : mode === "signin" ? "Sign in" : "Create account"}
                    </button>

                    <button
                      type="button"
                      onClick={resetPassword}
                      disabled={disableButtons}
                      className="w-full text-xs text-white/60 hover:text-white py-1"
                    >
                      Reset password
                    </button>
                  </form>
                </div>
              ) : null}

              {error ? (
                <div className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200">
                  {error}
                </div>
              ) : null}

              {info ? (
                <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                  {info}
                </div>
              ) : null}

              <p className="mt-5 text-[11px] leading-relaxed text-white/45">
                By continuing, you agree this is informational and not legal or tax advice.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
