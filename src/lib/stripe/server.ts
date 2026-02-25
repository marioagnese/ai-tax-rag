import "server-only";
import Stripe from "stripe";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
  // Must match the Stripe SDK's allowed literal type for this installed version.
  apiVersion: "2026-01-28.clover",
});

export function getPriceIds() {
  return {
    tier1: requireEnv("STRIPE_PRICE_TIER1"),
    tier2: requireEnv("STRIPE_PRICE_TIER2"),
  };
}

export function getAppUrl() {
  return requireEnv("APP_URL");
}
