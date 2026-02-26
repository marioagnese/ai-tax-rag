// app/api/stripe/checkout/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { requireSessionUser } from "../../../../src/lib/auth/session";
import { stripe, getAppUrl, getPriceIds } from "../../../../src/lib/stripe/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  tier?: "1" | "2";
};

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

  // Find customer(s) by email. (Stripe allows multiple; we pick most recent active sub)
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

      // First: trust metadata if present
      const metaTier = (s.metadata?.taxaipro_tier || s.metadata?.TAXAIPRO_TIER || "").trim();
      if (metaTier === "2") return "2";
      if (metaTier === "1") best = best === "2" ? "2" : "1";

      // Second: infer from line item price ids
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
 * Used by the client to auto-sync tier on sign-in (even on new devices).
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
 * Creates a Stripe Checkout Session (subscription) for Tier 1 or Tier 2.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser(); // must be logged in

    const body = (await req.json().catch(() => ({}))) as Body;
    const tier = body?.tier;

    if (!isPaidTier(tier)) {
      return jsonError("Missing/invalid tier. Use '1' or '2'.", 400);
    }

    const appUrl = getAppUrl();
    const prices = getPriceIds();
    const priceId = tier === "1" ? prices.tier1 : prices.tier2;

    // Guardrail: fail fast with a clear message if env points to a one_time price
    const price = await stripe.prices.retrieve(priceId);
    const isRecurring = !!price.recurring;
    if (!isRecurring) {
      return jsonError(
        `Stripe price ${priceId} is not recurring. Create a MONTHLY recurring price in Stripe and update STRIPE_PRICE_TIER${tier}.`,
        500
      );
    }

    // Optional: stable reference you can later map in Firestore/webhook
    const clientReferenceId = user.uid;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: clientReferenceId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Include tier + session_id so the client can immediately set local tier.
      success_url: `${appUrl}/crosscheck?tier=${tier}&session_id={CHECKOUT_SESSION_ID}&checkout=success`,
      cancel_url: `${appUrl}/crosscheck?checkout=cancel`,
      allow_promotion_codes: true,
      subscription_data: {
        metadata: {
          taxaipro_uid: user.uid,
          taxaipro_tier: tier,
        },
      },
      metadata: {
        taxaipro_uid: user.uid,
        taxaipro_tier: tier,
      },
    });

    if (!session.url) {
      return jsonError("Stripe did not return a checkout URL.", 500);
    }

    return NextResponse.json({ ok: true, url: session.url });
  } catch (err: any) {
    const msg = err?.message || "Unknown error";
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}