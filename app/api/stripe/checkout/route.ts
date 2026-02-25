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

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser(); // must be logged in

    const body = (await req.json().catch(() => ({}))) as Body;
    const tier = body?.tier;

    if (tier !== "1" && tier !== "2") {
      return jsonError("Missing/invalid tier. Use '1' or '2'.", 400);
    }

    const appUrl = getAppUrl();
    const prices = getPriceIds();

    const priceId = tier === "1" ? prices.tier1 : prices.tier2;

    // Optional: keep a stable reference you can later map in Firestore/webhook
    const clientReferenceId = user.uid;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: clientReferenceId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/crosscheck?checkout=success`,
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
