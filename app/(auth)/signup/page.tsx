// app/(auth)/signup/page.tsx
"use client";

import React, { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { firebaseClientConfigured, getFirebaseAuth } from "@/src/lib/firebase/client";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
} from "firebase/auth";

// Firestore (adjust import path if your project wraps Firestore differently)
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

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

function isEmailInUse(err: any) {
  const code = err?.code || err?.error?.code || "";
  return code === "auth/email-already-in-use";
}
function isUserNotFound(err: any) {
  const code = err?.code || err?.error?.code || "";
  return code === "auth/user-not-found";
}
function isWrongPassword(err: any) {
  const code = err?.code || err?.error?.code || "";
  return code === "auth/wrong-password";
}

export default function SignupPage() {
  const router = useRouter();

  const configured = useMemo(() => firebaseClientConfigured(), []);
  const auth = useMemo(() => (configured ? getFirebaseAuth() : null), [configured]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Mode: signup first; allow switch to login
  const [mode, setMode] = useState<"signup" | "login">("signup");

  // Auth
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Professional profile
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [country, setCountry] = useState("");

  // Waiver
  const [accepted, setAccepted] = useState(false);

  const disable = busy || !configured;

  async function saveProfileIfMissing(uid: string, userEmail: string) {
    const db = getFirestore();
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      await setDoc(ref, {
        uid,
        email: userEmail,
        fullName: fullName.trim(),
        company: company.trim(),
        roleTitle: roleTitle.trim(),
        country: country.trim(),
        createdAt: serverTimestamp(),
        acceptedTermsAt: serverTimestamp(),
        acceptedTermsVersion: "2026-02-20",
        consultingOnlyAcknowledged: true,
      });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");

    if (!auth) {
      setError("Firebase client is not configured (.env.local / Vercel env vars).");
      return;
    }

    if (!email.trim()) return setError("Please enter your email.");
    if (!password || password.length < 6) return setError("Password must be at least 6 characters.");

    // Only require profile + waiver for signup
    if (mode === "signup") {
      if (!fullName.trim()) return setError("Please enter your full name.");
      if (!company.trim()) return setError("Please enter your company.");
      if (!roleTitle.trim()) return setError("Please enter your role/title.");
      if (!accepted) return setError("Please accept the consulting-only disclaimer to continue.");
    }

    try {
      setBusy(true);

      let userCred;
      if (mode === "signup") {
        try {
          userCred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        } catch (err: any) {
          if (isEmailInUse(err)) {
            setMode("login");
            throw new Error("Account already exists for this email. Please log in instead.");
          }
          throw err;
        }

        // Save profile + waiver acceptance
        await saveProfileIfMissing(userCred.user.uid, userCred.user.email || email.trim());

        // Acknowledgement email (no enforcement of verification)
        try {
          await sendEmailVerification(userCred.user);
          setInfo("Account created. We sent a confirmation email (no action required).");
        } catch {
          // Ignore email failures; do not block onboarding
          setInfo("Account created. (Email acknowledgement could not be sent.)");
        }
      } else {
        // login
        try {
          userCred = await signInWithEmailAndPassword(auth, email.trim(), password);
        } catch (err: any) {
          if (isUserNotFound(err)) {
            setMode("signup");
            throw new Error("No account found. Please create an account first.");
          }
          if (isWrongPassword(err)) throw new Error("Incorrect password.");
          throw err;
        }
      }

      const idToken = await userCred.user.getIdToken(true);
      await mintSession(idToken);

      router.replace("/crosscheck");
    } catch (e: any) {
      setError(e?.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-screen text-white relative overflow-hidden"
      style={{
        backgroundImage: `url("/landing-bg.png")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="absolute inset-0 bg-black/10" />

      <header className="relative px-6 pt-6">
        <button onClick={() => router.push("/signin")} className="text-xs text-white/70 hover:text-white">
          ← Back
        </button>

        <div className="mt-3 relative h-14 w-52 sm:h-16 sm:w-60">
          <Image src="/taxaipro-logo.png" alt="TaxAiPro" fill priority className="object-contain" />
        </div>
      </header>

      <main className="relative mx-auto max-w-5xl px-6 pb-16">
        <section className="pt-10 md:pt-14">
          <div className="max-w-2xl rounded-3xl border border-white/10 bg-black/50 backdrop-blur-sm px-6 py-7 md:px-8 md:py-8 shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between gap-4">
              <h1 className="text-2xl md:text-3xl font-semibold">
                {mode === "signup" ? "Create your account" : "Log in"}
              </h1>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className={`text-xs px-3 py-1 rounded-full border ${
                    mode === "signup" ? "border-white/25 bg-white/10 text-white" : "border-white/10 text-white/60"
                  }`}
                >
                  Sign up
                </button>
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className={`text-xs px-3 py-1 rounded-full border ${
                    mode === "login" ? "border-white/25 bg-white/10 text-white" : "border-white/10 text-white/60"
                  }`}
                >
                  Login
                </button>
              </div>
            </div>

            <p className="mt-2 text-sm text-white/65">
              {mode === "signup"
                ? "Professional access (one-time setup). Then you can log in anytime."
                : "Welcome back. Log in to continue to Crosscheck."}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {mode === "signup" ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    className="w-full h-11 rounded-2xl bg-black/35 border border-white/10 px-4 outline-none focus:border-white/30"
                    placeholder="Full name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    autoComplete="name"
                  />
                  <input
                    className="w-full h-11 rounded-2xl bg-black/35 border border-white/10 px-4 outline-none focus:border-white/30"
                    placeholder="Company"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                  <input
                    className="w-full h-11 rounded-2xl bg-black/35 border border-white/10 px-4 outline-none focus:border-white/30"
                    placeholder="Role / Title"
                    value={roleTitle}
                    onChange={(e) => setRoleTitle(e.target.value)}
                  />
                  <input
                    className="w-full h-11 rounded-2xl bg-black/35 border border-white/10 px-4 outline-none focus:border-white/30"
                    placeholder="Country"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  />
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  className="w-full h-11 rounded-2xl bg-black/35 border border-white/10 px-4 outline-none focus:border-white/30"
                  placeholder="Work email"
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
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </div>

              {mode === "signup" ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={(e) => setAccepted(e.target.checked)}
                      className="mt-1 h-4 w-4"
                    />
                    <div className="text-sm text-white/80 leading-relaxed">
                      <div className="font-medium text-white">Consulting-only disclaimer (required)</div>
                      <div className="mt-1 text-white/70">
                        I acknowledge TaxAiPro is for general consulting/triage purposes only and does not provide legal
                        or tax advice. I will not rely on outputs as professional advice and will consult a licensed
                        advisor for decisions. I agree TaxAiPro is not liable for actions taken based on this platform.
                      </div>
                    </div>
                  </label>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={disable}
                className="w-full h-12 rounded-2xl bg-white text-black font-medium hover:bg-white/90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {busy ? "Working..." : mode === "signup" ? "Create account & continue" : "Log in & continue"}
              </button>

              {error ? (
                <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-200">
                  {error}
                </div>
              ) : null}

              {info ? (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                  {info}
                </div>
              ) : null}

              <p className="text-[11px] leading-relaxed text-white/50">
                TaxAiPro generates drafts for triage only — not legal or tax advice. No attorney-client relationship is
                created. You are responsible for verifying conclusions with a qualified professional.
              </p>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
}