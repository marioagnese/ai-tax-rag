"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { firebaseClientConfigured } from "@/src/lib/firebase/client";

export default function SignInPage() {
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const locale = typeof params?.locale === "string" ? params.locale : "en";
  const t = useTranslations("auth.signin");
  const configured = useMemo(() => firebaseClientConfigured(), []);
  const [demoOpen, setDemoOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDemoOpen(false);
    }

    if (demoOpen) {
      window.addEventListener("keydown", onKeyDown);
      document.body.style.overflow = "hidden";
    }

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [demoOpen]);

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
      {/* 🔥 DARKER OVERLAY (fix readability) */}
      <div className="absolute inset-0 bg-black/40" />

      {/* DEMO MODAL */}
      {demoOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={() => setDemoOpen(false)}
        >
          <div
            className="relative w-[92vw] max-w-[1100px] rounded-3xl border border-white/10 bg-[#0A0F1A] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setDemoOpen(false)}
              className="absolute right-4 top-4 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-sm text-white/80 hover:bg-white/10"
            >
              ✕
            </button>

            <video
              className="w-full rounded-2xl"
              controls
              autoPlay
              playsInline
            >
              <source src="/TaxAIProGuide.mp4" type="video/mp4" />
              {t("videoFallback")}
            </video>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="relative px-6 pt-6">
        <div className="flex items-start justify-between">
          <div className="relative h-16 w-56">
            <Image
              src="/taxaipro-logo.png"
              alt="TaxAiPro™"
              fill
              priority
              className="object-contain"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => router.push(`/${locale}/how-it-works`)}
              className="rounded-xl bg-black/90 px-4 py-2 text-xs text-white"
            >
              {t("howItWorks")}
            </button>

            <button
              onClick={() => router.push(`/${locale}/contact`)}
              className="rounded-xl bg-black/90 px-4 py-2 text-xs text-white"
            >
              {t("contact")}
            </button>
          </div>
        </div>
      </header>

      {/* MAIN */}
      <main className="relative mx-auto max-w-6xl px-6 pt-16">
        <div className="grid lg:grid-cols-2 gap-10 items-center">

          {/* LEFT SIDE */}
          <div className="rounded-3xl bg-black/50 p-8 backdrop-blur-md border border-white/10">

            {/* ✅ KEEP YOUR POSITIONING */}
            <h1 className="text-4xl md:text-5xl font-semibold leading-tight">
              Multi-model tax analysis
              <span className="block text-white/60">
                built to reduce uncertainty.
              </span>
            </h1>

            {/* 🔥 NEW: PAIN */}
            <p className="mt-4 text-red-300 text-sm">
              Most AI tax answers miss assumptions, ignore key facts, or sound more certain than they should.
            </p>

            {/* DESCRIPTION */}
            <p className="mt-5 text-white/80 text-sm leading-relaxed">
              TaxAiPro runs multiple AI models in parallel, compares where they agree and where they differ, and produces a more reliable and conservative answer.
            </p>

            {/* 🔥 NEW: BENEFITS */}
            <ul className="mt-5 space-y-2 text-white/75 text-sm">
              <li>• Cross-check multiple AI models instantly</li>
              <li>• Surface disagreements and missing facts</li>
              <li>• Generate conservative, audit-ready drafts</li>
            </ul>

            {/* AUTHORITY */}
            <div className="mt-5 text-sm text-white/70">
              Built by an international tax executive with 20+ years experience.
            </div>

            {/* CTA */}
            <div className="mt-6 flex flex-wrap gap-3 items-center">
              <button
                onClick={() => router.push(`/${locale}/signup`)}
                className="bg-white text-black px-5 py-2 rounded-xl font-medium"
                disabled={!configured}
              >
                Start free analysis
              </button>

              <button
                onClick={() => setDemoOpen(true)}
                className="border border-white/20 px-5 py-2 rounded-xl"
              >
                Watch demo
              </button>
            </div>

            <div className="mt-4 text-xs text-white/60">
              {t("disclaimer")}
            </div>
          </div>

          {/* RIGHT SIDE */}
          <div className="text-center">
            <p className="text-sm text-white/60 mb-2">
              See how professionals validate AI answers in seconds
            </p>

            <video
              className="rounded-2xl border border-white/10"
              controls
            >
              <source src="/demo-60s.mp4" type="video/mp4" />
            </video>
          </div>

        </div>
      </main>
    </div>
  );
}