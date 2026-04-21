// app/api/stripe/checkout/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { requireSessionUser } from "../../../../src/lib/auth/session";
import { stripe } from "../../../../src/lib/stripe/server";
import { resolveTierForUserEmail } from "../../../../src/lib/billing/resolveTier";

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
