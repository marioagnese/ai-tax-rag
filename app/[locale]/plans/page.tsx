"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Tier = 0 | 1 | 2;

type BillingTierResponse = {
  ok?: boolean;
  tier?: Tier;
  error?: string;
};

type StripeCheckoutResponse = {
  ok?: boolean;
  url?: string;
  error?: string;
};

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function TierCard({
  title,
  subtitle,
  runs,
  price,
  cta,
  highlight = false,
  loading = false,
  disabled = false,
  onClick,
}: {
  title: string;
  subtitle: string;
  runs: string;
  price: string;
  cta: string;
  highlight?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-6 backdrop-blur-sm",
        highlight
          ? "border-white/20 bg-white/[0.06]"
          : "border-white/10 bg-white/[0.03]"
      )}
    >
      <div className="text-sm font-semibold text-white/90">{title}</div>
      <div className="mt-1 text-xs text-white/55">{subtitle}</div>

      <div className="mt-5">
        <div className="text-3xl font-semibold text-white">{price}</div>
        <div className="mt-1 text-xs text-white/55">Runs: {runs}</div>
      </div>

      <button
        type="button"
        onClick={onClick}
        disabled={disabled || loading}
        className={cn(
          "mt-5 inline-flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition",
          highlight
            ? "bg-white text-black hover:bg-white/90"
            : "border border-white/15 bg-white/5 text-white/85 hover:bg-white/10",
          (disabled || loading) && "cursor-not-allowed opacity-60"
        )}
      >
        {loading ? "Opening Stripe…" : cta}
      </button>

      <div className="mt-4 text-[11px] text-white/45">
        Conservative multi-model triage. Not legal/tax advice.
      </div>
    </div>
  );
}

export default function PlansPage() {
  const params = useParams();
  const router = useRouter();
  const locale = typeof params?.locale === "string" ? params.locale : "en";

  const [currentTier, setCurrentTier] = useState<Tier | null>(null);
  const [tierLoaded, setTierLoaded] = useState(false);
  const [loadingTier1, setLoadingTier1] = useState(false);
  const [loadingTier2, setLoadingTier2] = useState(false);
  const [pageError, setPageError] = useState("");

  useMemo(() => {
    let cancelled = false;

    async function loadCurrentTier() {
      try {
        const res = await fetch("/api/stripe/checkout", {
          method: "GET",
          cache: "no-store",
        });

        const data = (await res.json()) as BillingTierResponse;
        if (!cancelled && res.ok && typeof data?.tier === "number") {
          setCurrentTier(data.tier);
        }
      } catch {
      } finally {
        if (!cancelled) setTierLoaded(true);
      }
    }

    loadCurrentTier();
    return () => {
      cancelled = true;
    };
  }, []);

  async function openStripeCheckout(tier: 1 | 2) {
    setPageError("");
    if (tier === 1) setLoadingTier1(true);
    if (tier === 2) setLoadingTier2(true);

    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tier: String(tier) }),
      });

      const data = (await res.json()) as StripeCheckoutResponse;

      if (!res.ok || !data?.url) {
        throw new Error(data?.error || "Unable to open Stripe checkout.");
      }

      window.location.href = data.url;
    } catch (err) {
      setPageError(
        err instanceof Error ? err.message : "Unable to open Stripe checkout."
      );
    } finally {
      if (tier === 1) setLoadingTier1(false);
      if (tier === 2) setLoadingTier2(false);
    }
  }

  const tier0Cta =
    currentTier === 0 || currentTier === null ? "Start" : "Current access";
  const tier1Cta = currentTier === 1 ? "Current plan" : "Upgrade to Tier 1";
  const tier2Cta = currentTier === 2 ? "Current plan" : "Upgrade to Tier 2";

  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute -top-48 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-[-220px] right-[-140px] h-[560px] w-[560px] rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
              <Image
                src="/taxaipro-logo.png"
                alt="TaxAiPro"
                width={40}
                height={40}
                className="h-10 w-10 object-contain"
                priority
              />
            </div>
            <div>
              <div className="text-sm font-semibold leading-none">TaxAiPro</div>
              <div className="mt-1 text-xs text-white/55">Billing & Plans</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/${locale}/signin`}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
            >
              Sign in
            </Link>
            <Link
              href={`/${locale}/crosscheck`}
              className="rounded-xl bg-white px-3 py-2 text-xs font-semibold text-black hover:bg-white/90"
            >
              Go to Crosscheck
            </Link>
          </div>
        </div>

        <div className="mt-10">
          <h1 className="text-2xl font-semibold text-white/95">Choose a tier</h1>
          <p className="mt-2 max-w-2xl text-sm text-white/60">
            Start free, then upgrade as usage grows. Daily limits reset every 24h.
          </p>
          {tierLoaded && currentTier !== null ? (
            <div className="mt-3 inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/65">
              Current tier: Tier {currentTier}
            </div>
          ) : null}
        </div>

        {pageError ? (
          <div className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            {pageError}
          </div>
        ) : null}

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          <TierCard
            title="Tier 0 — Simple"
            subtitle="For quick checks and occasional use."
            runs="5 per day"
            price="$0"
            cta={tier0Cta}
            disabled={false}
            onClick={() => router.push(`/${locale}/signin`)}
          />

          <TierCard
            title="Tier 1 — Pro"
            subtitle="For frequent scenario testing and follow-ups."
            runs="25 per day"
            price="$5.99/mo"
            cta={tier1Cta}
            highlight
            loading={loadingTier1}
            disabled={currentTier === 1}
            onClick={() => openStripeCheckout(1)}
          />

          <TierCard
            title="Tier 2 — Unlimited"
            subtitle="For heavy users and team workflows."
            runs="Unlimited"
            price="$19.99/mo"
            cta={tier2Cta}
            loading={loadingTier2}
            disabled={currentTier === 2}
            onClick={() => openStripeCheckout(2)}
          />
        </div>

        <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="text-sm font-semibold text-white/90">
            Premium add-on: Human review memo
          </div>
          <div className="mt-2 text-sm text-white/65">
            Need a conservative, human-reviewed memo for your file? Send the saved run
            (or paste the question/facts/output) and we’ll respond with a signed PDF memo.
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-[11px] text-white/45">
              This is a manual service. Turnaround and pricing will be confirmed by email.
            </div>

            <a
              className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black hover:bg-white/90"
              href="mailto:review@taxaipro.com?subject=Human%20Review%20Memo%20Request&body=Hi%2C%0A%0APlease%20review%20the%20attached%20(or%20pasted)%20TaxAiPro%20output.%0A%0AJurisdiction%3A%0AFacts%3A%0AQuestion%3A%0AOutput%3A%0A%0ATarget%20format%3A%20PDF%20memo%0A%0AThanks!"
            >
              Request human review
            </a>
          </div>
        </div>

        <div className="mt-10 text-xs text-white/40">
          Tier enforcement is active on the Crosscheck endpoint. Paid access opens
          through Stripe checkout.
        </div>
      </div>
    </div>
  );
}