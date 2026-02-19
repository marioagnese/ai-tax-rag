// app/(auth)/signin/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
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
  const [authOpen, setAuthOpen] = useState(false);

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const configured = useMemo(() => firebaseClientConfigured(), []);
  const auth = useMemo(() => (configured ? getFirebaseAuth() : null), [configured]);

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
            throw new Error("No account found for this email. Switch to “Create” to continue.");
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
      {/* BACKGROUND: use CSS background-image so it ALWAYS shows (no Next/Image dependency). */}
      <div
        className="fixed inset-0 -z-10 bg-black"
        style={{
          backgroundImage: "url(/landing-bg.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        {/* Harvey-style readability: heavy LEFT gradient, light RIGHT so image stays visible */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-black/10" />
        {/* Slight top/bottom shaping without killing the photo */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/25" />
      </div>

      {/* TOP BAR: Big logo left, Login right (NO small TaxAiPro text). */}
      <header className="mx-auto max-w-6xl px-6 pt-8">
        <div className="flex items-center justify-between">
          {/* Big logo */}
          <div className="relative h-12 w-56 sm:h-14 sm:w-72 md:h-16 md:w-80">
            <Image
              src="/taxaipro-logo.png"
              alt="TaxAiPro"
              fill
              priority
              className="object-contain"
            />
          </div>

          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            className="text-sm text-white/85 hover:text-white"
          >
            Login
          </button>
        </div>
      </header>

      {/* HERO */}
      <main className="mx-auto max-w-6xl px-6">
        <section className="pt-16 md:pt-24 pb-28 md:pb-36">
          <div className="max-w-2xl">
            <h1 className="text-5xl md:text-6xl font-semibold tracking-tight leading-[1.02]">
              Multi-model tax analysis,
              <span className="block text-white/65">built to reduce uncertainty.</span>
            </h1>

            <p className="mt-6 text-base md:text-lg text-white/75 leading-relaxed">
              LLMs often answer the <span className="text-white font-medium">same prompt</span> in different ways.
              TaxAiPro runs multiple models in parallel, crosschecks where they agree and disagree, then rewrites{" "}
              <span className="text-white font-medium">one conservative answer</span> with explicit assumptions,
              caveats, and missing facts.
            </p>

            <div className="mt-9 flex flex-col sm:flex-row gap-3 sm:items-center">
              <button
                type="button"
                onClick={() => setAuthOpen(true)}
                className="h-12 px-6 rounded-xl bg-white text-black font-medium hover:bg-white/90"
              >
                Sign in to try it
              </button>

              {/* keep minimal, not clutter */}
              <div className="text-sm text-white/60">
                Export memo/email-ready outputs in one click.
              </div>
            </div>

            <div className="mt-10 text-xs text-white/45">
              TaxAiPro generates drafts for triage only — not legal or tax advice.
            </div>
          </div>
        </section>
      </main>

      {/* AUTH MODAL */}
      {authOpen ? (
        <div
          className="fixed inset-0 z-50"
          aria-modal="true"
          role="dialog"
          onMouseDown={() => {
            if (!busy) setAuthOpen(false);
          }}
        >
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" />

          <div
            className="absolute left-1/2 top-1/2 w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="rounded-3xl border border-white/10 bg-black/55 shadow-2xl shadow-black/40 backdrop-blur-xl p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Sign in</h2>
                  <p className="mt-1 text-sm text-white/60">Continue with Google or email.</p>
                </div>
                <button
                  type="button"
                  onClick={() => (!busy ? setAuthOpen(false) : null)}
                  className="text-white/60 hover:text-white"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              {!configured ? (
                <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100">
                  Firebase isn’t configured. Check Vercel env vars for:
                  <div className="mt-2 text-xs text-amber-100/80">
                    NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID,
                    NEXT_PUBLIC_FIREBASE_APP_ID
                  </div>
                </div>
              ) : null}

              <button
                onClick={loginWithGoogle}
                disabled={disableButtons}
                className="mt-5 w-full h-12 rounded-2xl bg-white text-black font-medium hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? "Signing in..." : "Continue with Google"}
              </button>

              <div className="mt-5 flex items-center gap-3 text-white/30">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-xs">or</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="text-xs text-white/60">{mode === "signin" ? "Email sign-in" : "Create account"}</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMode("signin")}
                    className={`text-xs px-2.5 py-1 rounded-full border ${
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
                    className={`text-xs px-2.5 py-1 rounded-full border ${
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
