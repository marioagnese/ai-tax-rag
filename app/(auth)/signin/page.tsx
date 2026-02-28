// app/(auth)/signin/page.tsx
"use client";

import React, { useMemo } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { firebaseClientConfigured } from "@/src/lib/firebase/client";

export default function SignInPage() {
  const router = useRouter();
  const configured = useMemo(() => firebaseClientConfigured(), []);

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

      {/* Top-left logo + top-right links */}
      <header className="relative px-6 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="relative h-16 w-56 sm:h-18 sm:w-64 md:h-20 md:w-72">
            <Image src="/taxaipro-logo.png" alt="TaxAiPro" fill priority className="object-contain" />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => router.push("/how-it-works")}
              className="rounded-xl border border-white/15 bg-black/80 px-3 py-2 text-xs text-white hover:bg-black/70"
              title="How TaxAiPro works"
            >
              How it works
            </button>

            <button
              type="button"
              onClick={() => router.push("/contact")}
              className="rounded-xl border border-white/15 bg-black/80 px-3 py-2 text-xs text-white hover:bg-black/70"
            >
              Contact
            </button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-6">
        <section className="pt-16 md:pt-24 pb-16 md:pb-24">
          <div className="max-w-xl rounded-3xl border border-white/10 bg-black/45 backdrop-blur-sm px-6 py-7 md:px-8 md:py-8 shadow-2xl shadow-black/40">
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05]">
              Multi-model tax analysis,
              <span className="block text-white/65">built to reduce uncertainty.</span>
            </h1>

            <p className="mt-5 text-sm md:text-base text-white/78 leading-relaxed">
              TaxAiPro runs multiple models in parallel, crosschecks where they agree and disagree, then rewrites{" "}
              <span className="text-white font-medium">one conservative answer</span> with explicit assumptions, caveats,
              and missing facts.
            </p>

            <div className="mt-7 flex flex-col sm:flex-row gap-3 sm:items-center">
              <button
                type="button"
                onClick={() => router.push("/signup")}
                className="h-11 px-5 rounded-xl bg-white text-black font-medium hover:bg-white/90"
                disabled={!configured}
                title={!configured ? "Firebase is not configured in env vars" : ""}
              >
                Sign in to try it
              </button>
              <div className="text-sm text-white/65">Create your account once, then log in anytime.</div>
            </div>

            <div className="mt-8 text-xs text-white/55">
              Drafts for triage only — not legal or tax advice.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}