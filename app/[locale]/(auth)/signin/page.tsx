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
              className="rounded-xl border border-black/60 bg-black/95 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-black/40 hover:bg-black focus:outline-none focus:ring-2 focus:ring-white/20"
              title="How TaxAiPro works"
            >
              How it works
            </button>

            <button
              type="button"
              onClick={() => router.push("/contact")}
              className="rounded-xl border border-black/60 bg-black/95 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-black/40 hover:bg-black focus:outline-none focus:ring-2 focus:ring-white/20"
            >
              Contact
            </button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-6">
        <section className="pt-14 md:pt-20 pb-16 md:pb-24">
          {/* Two-column hero: copy + demo video */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
            {/* Left: Hero copy card */}
            <div className="lg:col-span-6">
              <div className="rounded-3xl border border-white/10 bg-black/45 backdrop-blur-sm px-6 py-7 md:px-8 md:py-8 shadow-2xl shadow-black/40">
                <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05]">
                  Multi-model tax analysis,
                  <span className="block text-white/65">built to reduce uncertainty.</span>
                </h1>

                <p className="mt-5 text-sm md:text-base text-white/78 leading-relaxed">
                  TaxAiPro runs multiple models in parallel, crosschecks where they agree and disagree, then rewrites{" "}
                  <span className="text-white font-medium">one conservative answer</span> with explicit assumptions,
                  caveats, and missing facts.
                </p>

                <div className="mt-4 text-sm text-white/70">
                  <span className="text-white/85 font-medium">Built by a tax executive</span> for{" "}
                  <span className="text-white/85 font-medium">tax executives</span>.
                </div>

                <div className="mt-7 flex flex-col sm:flex-row gap-3 sm:items-center">
                  <button
                    type="button"
                    onClick={() => router.push("/signup")}
                    className="h-11 px-5 rounded-xl bg-white text-black font-medium hover:bg-white/90 disabled:opacity-50"
                    disabled={!configured}
                    title={!configured ? "Firebase is not configured in env vars" : ""}
                  >
                    Sign in to try it
                  </button>
                  <div className="text-sm text-white/65">Create your account once, then log in anytime.</div>
                </div>

                <div className="mt-8 text-xs text-white/55">Drafts for triage only — not legal or tax advice.</div>
              </div>
            </div>

            {/* Right: Clean square demo video (no chrome) */}
            <div className="lg:col-span-6">
              <div className="w-full max-w-[520px] ml-auto">
                {/* fully transparent container */}
                <div className="rounded-3xl border border-white/10 bg-transparent p-2">
                  <div className="aspect-square w-full overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                    <video
                      className="h-full w-full object-cover"
                      controls
                      playsInline
                      preload="metadata"
                    >
                      <source src="/demo-60s.mp4" type="video/mp4" />
                      Your browser does not support the video tag.
                    </video>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}