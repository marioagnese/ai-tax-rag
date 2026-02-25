import "server-only";
import Stripe from "stripe";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
  apiVersion: "2024-06-20",
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
