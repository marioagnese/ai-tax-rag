// app/api/billing/tier/route.ts
import { NextResponse } from "next/server";
import { requireSessionUser } from "../../../../src/lib/auth/session";
import { stripe, getPriceIds } from "../../../../src/lib/stripe/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveTierForUserEmail(email: string | undefined): Promise<"0" | "1" | "2"> {
  if (!email) return "0";

  const prices = getPriceIds();
  const tier1PriceId = prices.tier1;
  const tier2PriceId = prices.tier2;

  const customers = await stripe.customers.list({ email, limit: 10 });
  if (!customers.data.length) return "0";

  let best: "0" | "1" | "2" = "0";

  for (const c of customers.data) {
    const subs = await stripe.subscriptions.list({
      customer: c.id,
      status: "all",
      limit: 50,
      expand: ["data.items.data.price"],
    });

    for (const s of subs.data) {
      if (!["active", "trialing", "past_due"].includes(s.status)) continue;

      const metaTier = (s.metadata?.taxaipro_tier || "").trim();
      if (metaTier === "2") return "2";
      if (metaTier === "1") best = best === "2" ? "2" : "1";

      for (const it of s.items.data) {
        const pid = (it.price as any)?.id as string | undefined;
        if (!pid) continue;
        if (pid === tier2PriceId) return "2";
        if (pid === tier1PriceId) best = best === "2" ? "2" : "1";
      }
    }
  }

  return best;
}

export async function GET() {
  try {
    const user = await requireSessionUser();
    const tier = await resolveTierForUserEmail(user.email);
    return NextResponse.json({ ok: true, tier });
  } catch (err: any) {
    if (err?.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: err?.message || "Unknown error" }, { status: 500 });
  }
}