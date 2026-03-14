// app/[locale]/(auth)/signin/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { firebaseClientConfigured } from "@/src/lib/firebase/client";

export default function SignInPage() {
  const router = useRouter();
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
      <div className="absolute inset-0 bg-black/10" />

      {demoOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
          onClick={() => setDemoOpen(false)}
        >
          <div
            className="relative w-[92vw] max-w-[1100px] rounded-3xl border border-white/10 bg-[#0A0F1A] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setDemoOpen(false)}
              className="absolute right-4 top-4 z-10 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-sm text-white/80 hover:bg-white/10"
              aria-label="Close demo"
            >
              ✕
            </button>

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
              <video
                className="h-auto w-full object-contain"
                controls
                playsInline
                preload="auto"
                autoPlay
              >
                <source src="/TaxAIProGuide.mp4" type="video/mp4" />
                {t("videoFallback")}
              </video>
            </div>
          </div>
        </div>
      ) : null}

      <header className="relative px-6 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="relative h-16 w-56 sm:h-18 sm:w-64 md:h-20 md:w-72">
            <Image
              src="/taxaipro-logo.png"
              alt="TaxAiPro™"
              fill
              priority
              className="object-contain"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => router.push("/how-it-works")}
              className="rounded-xl border border-black/60 bg-black/95 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-black/40 hover:bg-black focus:outline-none focus:ring-2 focus:ring-white/20"
              title={t("howItWorksTitle")}
            >
              {t("howItWorks")}
            </button>

            <button
              type="button"
              onClick={() => router.push("/contact")}
              className="rounded-xl border border-black/60 bg-black/95 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-black/40 hover:bg-black focus:outline-none focus:ring-2 focus:ring-white/20"
            >
              {t("contact")}
            </button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-6">
        <section className="pt-14 md:pt-20 pb-16 md:pb-24">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
            <div className="lg:col-span-6">
              <div className="rounded-3xl border border-white/10 bg-black/45 backdrop-blur-sm px-6 py-7 md:px-8 md:py-8 shadow-2xl shadow-black/40">
                <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05]">
                  {t("headline")}
                  <span className="block text-white/65">{t("subheadline")}</span>
                </h1>

                <p className="mt-5 text-sm md:text-base text-white/78 leading-relaxed">
                  {t("bodyPrefix")}{" "}
                  <span className="text-white font-medium">
                    {t("bodyEmphasis")}
                  </span>{" "}
                  {t("bodySuffix")}
                </p>

                <div className="mt-4 text-sm text-white/70">
                  <span className="text-white/85 font-medium">
                    {t("builtBy")}
                  </span>{" "}
                  {t("for")}{" "}
                  <span className="text-white/85 font-medium">
                    {t("forWhom")}
                  </span>
                  .
                </div>

                <div className="mt-7 flex flex-col sm:flex-row gap-3 sm:items-center sm:flex-wrap">
                  <button
                    type="button"
                    onClick={() => router.push("/signup?mode=login")}
                    className="h-11 px-5 rounded-xl bg-white text-black font-medium hover:bg-white/90 disabled:opacity-50"
                    disabled={!configured}
                    title={!configured ? t("firebaseMissing") : ""}
                  >
                    {t("cta")}
                  </button>

                  <button
                    type="button"
                    onClick={() => router.push("/signup?mode=login")}
                    className="h-11 px-5 rounded-xl border border-white/20 bg-white/10 text-white font-medium hover:bg-white/15 disabled:opacity-50"
                    disabled={!configured}
                    title={!configured ? t("firebaseMissing") : ""}
                  >
                    Log in
                  </button>

                  <div className="text-sm text-white/65">{t("ctaHint")}</div>
                </div>

                <div className="mt-8 text-xs text-white/55">
                  {t("disclaimer")}
                </div>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="w-full max-w-[520px] ml-auto">
                <div className="rounded-3xl border border-white/10 bg-transparent p-2">
                  <div className="aspect-square w-full overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                    <video
                      className="h-full w-full object-cover"
                      controls
                      playsInline
                      preload="metadata"
                    >
                      <source src="/demo-60s.mp4" type="video/mp4" />
                      {t("videoFallback")}
                    </video>
                  </div>

                  <div className="mt-4 flex justify-center">
                    <button
                      type="button"
                      onClick={() => setDemoOpen(true)}
                      className="h-11 px-6 rounded-xl bg-white text-black font-semibold shadow-lg shadow-black/30 hover:bg-white/90"
                    >
                      Watch Demo
                    </button>
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