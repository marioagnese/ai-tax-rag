// src/lib/billing/tier.ts
import "server-only";
import { stripe, getPriceIds } from "../stripe/server";

export type Tier = "0" | "1" | "2";

export async function getTierForEmail(email: string | undefined): Promise<Tier> {
  if (!email) return "0";

  const prices = getPriceIds();
  const tier1PriceId = prices.tier1;
  const tier2PriceId = prices.tier2;

  const customers = await stripe.customers.list({ email, limit: 10 });
  if (!customers.data.length) return "0";

  let best: Tier = "0";

  for (const c of customers.data) {
    const subs = await stripe.subscriptions.list({
      customer: c.id,
      status: "all",
      limit: 50,
      expand: ["data.items.data.price"],
    });

    for (const s of subs.data) {
      if (!["active", "trialing", "past_due"].includes(s.status)) continue;

      const metaTier = (s.metadata?.taxaipro_tier || s.metadata?.TAXAIPRO_TIER || "").trim();
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