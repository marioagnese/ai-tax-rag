// app/(auth)/signin/page.tsx
"use client";

import Image from "next/image";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  firebaseClientConfigured,
  getFirebaseAuth,
} from "@/src/lib/firebase/client";
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
      if (!password || password.length < 6) {
        throw new Error("Password must be at least 6 characters.");
      }

      let userCred: any;

      if (mode === "signin") {
        try {
          userCred = await signInWithEmailAndPassword(auth, email.trim(), password);
        } catch (err: any) {
          if (isUserNotFound(err)) {
            setMode("signup");
            throw new Error("No account found for this email. Switch to “Create” to continue.");
          }
          if (isWrongPassword(err)) throw new Error("Incorrect password. Try again or reset.");
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

      if (!email.trim()) throw new Error("Enter your email first.");
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
    <div className="relative min-h-screen text-white bg-black overflow-hidden">
      {/* BACKGROUND: make it MUCH more visible (less dark overlay, boost contrast/sat) */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <Image
          src="/landing-bg.png"
          alt="TaxAiPro background"
          fill
          priority
          unoptimized
          className="object-cover opacity-95 contrast-125 saturate-125 brightness-110"
        />

        {/* Keep readability: lighter overall dim, plus stronger vignette edges */}
        <div className="absolute inset-0 bg-black/20" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.00)_0%,rgba(0,0,0,0.25)_55%,rgba(0,0,0,0.70)_100%)]" />

        {/* Subtle top fade so headline stays readable */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/30" />
      </div>

      {/* CONTENT */}
      <div className="relative z-10 mx-auto max-w-6xl px-6 py-10">
        {/* Removed separate logo block (background image already has branding) */}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start pt-10">
          {/* LEFT */}
          <section className="lg:col-span-7">
            {/* Optional small pill can stay, but you said remove small txt — so removed */}
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight drop-shadow-[0_12px_40px_rgba(0,0,0,0.75)]">
              Multi-model tax analysis,
              <span className="block text-white/80">built to reduce uncertainty.</span>
            </h1>

            <p className="mt-5 text-base md:text-lg text-white/85 max-w-2xl leading-relaxed drop-shadow-[0_10px_30px_rgba(0,0,0,0.75)]">
              LLMs often give different answers to the same prompt. TaxAiPro runs multiple models in parallel,
              compares where they agree and disagree, then rewrites a single conservative answer with explicit
              assumptions, caveats, and missing facts.
            </p>

            <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
              <div className="rounded-2xl border border-white/18 bg-black/35 p-4 backdrop-blur-md shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
                <div className="text-sm font-medium">Crosscheck</div>
                <div className="mt-1 text-sm text-white/75">
                  See conflicts before you rely on an answer.
                </div>
              </div>

              <div className="rounded-2xl border border-white/18 bg-black/35 p-4 backdrop-blur-md shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
                <div className="text-sm font-medium">Conservative synthesis</div>
                <div className="mt-1 text-sm text-white/75">
                  One consistent output + caveats + missing facts.
                </div>
              </div>

              <div className="rounded-2xl border border-white/18 bg-black/35 p-4 backdrop-blur-md shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
                <div className="text-sm font-medium">Memo / email ready</div>
                <div className="mt-1 text-sm text-white/75">
                  Clean formatting for review and client comms.
                </div>
              </div>

              <div className="rounded-2xl border border-white/18 bg-black/35 p-4 backdrop-blur-md shadow-[0_18px_60px_rgba(0,0,0,0.45)]">
                <div className="text-sm font-medium">Built for tax work</div>
                <div className="mt-1 text-sm text-white/75">
                  Assumptions, thresholds, and documentation focus are explicit.
                </div>
              </div>
            </div>
          </section>

          {/* RIGHT */}
          <aside className="lg:col-span-5">
            <div className="rounded-3xl border border-white/18 bg-white/[0.07] p-6 shadow-2xl shadow-black/50 backdrop-blur-xl">
              {!configured ? (
                <div className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-100">
                  Firebase isn’t configured. Check Vercel env vars:
                  <div className="mt-2 text-xs text-amber-100/80">
                    NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, NEXT_PUBLIC_FIREBASE_PROJECT_ID,
                    NEXT_PUBLIC_FIREBASE_APP_ID
                  </div>
                </div>
              ) : null}

              <div>
                <h2 className="text-lg font-semibold">Sign in</h2>
                <p className="mt-1 text-sm text-white/75">Continue with Google or email.</p>
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
                className="mt-3 w-full h-12 rounded-2xl border border-white/20 bg-black/25 hover:bg-white/5 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Continue with email
              </button>

              {emailEnabled ? (
                <div className="mt-5">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-white/75">
                      {mode === "signin" ? "Email sign-in" : "Create account"}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setMode("signin")}
                        className={`text-xs px-2 py-1 rounded-full border ${
                          mode === "signin"
                            ? "border-white/35 bg-white/12 text-white"
                            : "border-white/14 text-white/75 hover:text-white"
                        }`}
                      >
                        Sign in
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode("signup")}
                        className={`text-xs px-2 py-1 rounded-full border ${
                          mode === "signup"
                            ? "border-white/35 bg-white/12 text-white"
                            : "border-white/14 text-white/75 hover:text-white"
                        }`}
                      >
                        Create
                      </button>
                    </div>
                  </div>

                  <form onSubmit={submitEmailAuth} className="mt-3 space-y-3">
                    <input
                      className="w-full h-11 rounded-2xl bg-black/35 border border-white/14 px-4 outline-none focus:border-white/40"
                      placeholder="Email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      inputMode="email"
                    />
                    <input
                      className="w-full h-11 rounded-2xl bg-black/35 border border-white/14 px-4 outline-none focus:border-white/40"
                      placeholder="Password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    />

                    <button
                      type="submit"
                      disabled={disableButtons}
                      className="w-full h-11 rounded-2xl border border-white/20 bg-white/6 hover:bg-white/12 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {busy ? "Working..." : mode === "signin" ? "Sign in" : "Create account"}
                    </button>

                    <button
                      type="button"
                      onClick={resetPassword}
                      disabled={disableButtons}
                      className="w-full text-xs text-white/75 hover:text-white py-1"
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
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
