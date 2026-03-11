// app/api/stripe/checkout/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { requireSessionUser } from "../../../../src/lib/auth/session";
import { stripe, getPriceIds } from "../../../../src/lib/stripe/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  tier?: "1" | "2";
};

const TIER1_PAYMENT_LINK = "https://buy.stripe.com/bJe5kweLZgKV2Xr44gffy07";
const TIER2_PAYMENT_LINK = "https://buy.stripe.com/7sY6oA7jx3Y97dH58kffy08";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function isPaidTier(x: unknown): x is "1" | "2" {
  return x === "1" || x === "2";
}

// Helper: resolve user's best tier from Stripe subscriptions.
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

/**
 * GET /api/stripe/checkout
 * Returns the user's current tier based on Stripe subscription status.
 */
export async function GET() {
  try {
    const user = await requireSessionUser();
    const tier = await resolveTierForUserEmail(user.email);
    return NextResponse.json({ ok: true, tier });
  } catch (err: any) {
    const msg = err?.message || "Unknown error";
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * POST /api/stripe/checkout
 * Returns a hosted Stripe Payment Link for Tier 1 or Tier 2.
 */
export async function POST(req: NextRequest) {
  try {
    await requireSessionUser();

    const body = (await req.json().catch(() => ({}))) as Body;
    const tier = body?.tier;

    if (!isPaidTier(tier)) {
      return jsonError("Missing/invalid tier. Use '1' or '2'.", 400);
    }

    const url = tier === "1" ? TIER1_PAYMENT_LINK : TIER2_PAYMENT_LINK;

    return NextResponse.json({ ok: true, url });
  } catch (err: any) {
    const msg = err?.message || "Unknown error";
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
