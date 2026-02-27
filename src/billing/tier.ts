// src/lib/billing/tier.ts
import "server-only";
import { stripe, getPriceIds } from "../stripe/server";

export type Tier = "0" | "1" | "2";

export async function getTierForEmail(email: string): Promise<{
  tier: Tier;
  customerId?: string;
  activePriceIds: string[];
}> {
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail) return { tier: "0", activePriceIds: [] };

  const prices = getPriceIds();
  const tier1PriceId = prices.tier1;
  const tier2PriceId = prices.tier2;

  // 1) Find Stripe customer by email
  const customers = await stripe.customers.list({ email: cleanEmail, limit: 10 });
  const customer = customers.data?.[0];
  if (!customer?.id) return { tier: "0", activePriceIds: [] };

  // 2) List subscriptions (include active + trialing)
  const subs = await stripe.subscriptions.list({
    customer: customer.id,
    status: "all",
    limit: 100,
    expand: ["data.items.data.price"],
  });

  const activeLike = new Set(["active", "trialing"]);
  const activePriceIds: string[] = [];

  for (const s of subs.data || []) {
    if (!activeLike.has(s.status)) continue;
    for (const item of s.items?.data || []) {
      const priceId =
        typeof item.price === "string" ? item.price : (item.price as any)?.id;
      if (priceId) activePriceIds.push(String(priceId));
    }
  }

  // 3) Map priceIds -> tier
  let tier: Tier = "0";
  if (activePriceIds.includes(tier2PriceId)) tier = "2";
  else if (activePriceIds.includes(tier1PriceId)) tier = "1";

  return { tier, customerId: customer.id, activePriceIds };
}