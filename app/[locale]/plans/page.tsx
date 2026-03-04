import Link from "next/link";

export const dynamic = "force-static";

function TierCard({
  title,
  subtitle,
  runs,
  price,
  cta,
  href,
  highlight = false,
}: {
  title: string;
  subtitle: string;
  runs: string;
  price: string;
  cta: string;
  href: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-2xl border p-6 backdrop-blur-sm",
        highlight
          ? "border-white/20 bg-white/[0.06]"
          : "border-white/10 bg-white/[0.03]",
      ].join(" ")}
    >
      <div className="text-sm font-semibold text-white/90">{title}</div>
      <div className="mt-1 text-xs text-white/55">{subtitle}</div>

      <div className="mt-5">
        <div className="text-3xl font-semibold text-white">{price}</div>
        <div className="mt-1 text-xs text-white/55">Runs: {runs}</div>
      </div>

      <Link
        href={href}
        className={[
          "mt-5 inline-flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold",
          highlight ? "bg-white text-black hover:bg-white/90" : "border border-white/15 bg-white/5 text-white/85 hover:bg-white/10",
        ].join(" ")}
      >
        {cta}
      </Link>

      <div className="mt-4 text-[11px] text-white/45">
        Conservative multi-model triage. Not legal/tax advice.
      </div>
    </div>
  );
}

export default function PlansPage() {
  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-80">
        <div className="absolute -top-48 left-1/2 h-[560px] w-[560px] -translate-x-1/2 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-[-220px] right-[-140px] h-[560px] w-[560px] rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 py-10">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src="/taxaipro-logo.png"
              alt="TaxAiPro"
              className="h-10 w-10 rounded-xl object-contain border border-white/10 bg-white/5"
            />
            <div>
              <div className="text-sm font-semibold leading-none">TaxAiPro</div>
              <div className="mt-1 text-xs text-white/55">Plans</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/signin"
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/85 hover:bg-white/10"
            >
              Sign in
            </Link>
            <Link
              href="/crosscheck"
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
        </div>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          <TierCard
            title="Tier 0 — Simple"
            subtitle="For quick checks and occasional use."
            runs="5 per day"
            price="$0"
            cta="Start"
            href="/signin"
          />

          <TierCard
            title="Tier 1 — Pro"
            subtitle="For frequent scenario testing and follow-ups."
            runs="25 per day"
            price="Coming soon"
            cta="Join waitlist"
            href="mailto:support@taxaipro.com?subject=Tier%201%20Upgrade%20Request&body=Hi%20TaxAiPro%20team%2C%0A%0AI%20want%20Tier%201.%20My%20account%20email%20is%3A%20%0A%0AThanks!"
            highlight
          />

          <TierCard
            title="Tier 2 — Unlimited"
            subtitle="For heavy users and team workflows."
            runs="Unlimited"
            price="Coming soon"
            cta="Contact us"
            href="mailto:support@taxaipro.com?subject=Tier%202%20Unlimited%20Request&body=Hi%20TaxAiPro%20team%2C%0A%0AI%20want%20Tier%202%20Unlimited.%20My%20account%20email%20is%3A%20%0A%0ACompany%2FUse%20case%3A%20%0A%0AThanks!"
          />
        </div>

        <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="text-sm font-semibold text-white/90">Premium add-on: Human review memo</div>
          <div className="mt-2 text-sm text-white/65">
            Need a conservative, human-reviewed memo for your file? Send the saved run (or paste the question/facts/output)
            and we’ll respond with a signed PDF memo.
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
          Note: Tier enforcement is active on the Crosscheck endpoint. Payments & automatic tier upgrades will be wired
          via Stripe next.
        </div>
      </div>
    </div>
  );
}
