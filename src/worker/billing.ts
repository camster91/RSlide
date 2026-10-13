// Optional paid plans with Stripe. Off unless STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_ID are set.
// Plans belong to team workspaces: a "pro" workspace lifts the attendee limit on its events.
//   FREE_MAX_PARTICIPANTS  attendees at once per event on the free plan ("" = MAX_PARTICIPANTS)
//   PRO_MAX_PARTICIPANTS   attendees at once per event on the pro plan  ("" = MAX_PARTICIPANTS)
import { hex } from "./identity";

export type Plan = "free" | "pro";

export interface BillingEnv {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
  FREE_MAX_PARTICIPANTS?: string;
  PRO_MAX_PARTICIPANTS?: string;
  MAX_PARTICIPANTS?: string;
}

export const billingReady = (env: BillingEnv) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_ID);

/** Attendees allowed at once for an event on this plan. 0 = no limit. */
export function capacity(env: BillingEnv, plan: Plan): number {
  const pick = plan === "pro" ? env.PRO_MAX_PARTICIPANTS : env.FREE_MAX_PARTICIPANTS;
  const n = Number(pick || env.MAX_PARTICIPANTS || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function stripe(env: BillingEnv, path: string, form: Record<string, string>) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
  });
  const d = (await r.json()) as { url?: string; error?: { message?: string } };
  if (!r.ok || !d.url) throw new Error(d.error?.message ?? `Stripe answered ${r.status}`);
  return d.url;
}

export function checkoutUrl(env: BillingEnv, o: { origin: string; workspace: string; email: string }) {
  return stripe(env, "checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": env.STRIPE_PRICE_ID!,
    "line_items[0][quantity]": "1",
    client_reference_id: o.workspace,
    "metadata[workspace]": o.workspace,
    "subscription_data[metadata][workspace]": o.workspace,
    customer_email: o.email,
    success_url: `${o.origin}/teams/${o.workspace}?upgraded=1#settings`,
    cancel_url: `${o.origin}/teams/${o.workspace}#settings`,
  });
}

export function portalUrl(env: BillingEnv, o: { origin: string; workspace: string; customer: string }) {
  return stripe(env, "billing_portal/sessions", { customer: o.customer, return_url: `${o.origin}/teams/${o.workspace}#settings` });
}

/** Checks a Stripe webhook signature (Stripe-Signature: t=…,v1=…). Throws if it's not genuine or too old. */
export async function verifyStripe(payload: string, header: string, secret: string, now = Date.now()): Promise<void> {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]).filter((p) => p.length === 2)) as Record<string, string>;
  const sigs = header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length) throw new Error("Missing signature");
  if (Math.abs(now / 1000 - t) > 300) throw new Error("Signature too old");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const want = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  const same = (a: string, b: string) => {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  };
  if (!sigs.some((s) => same(s, want))) throw new Error("Bad signature");
}

/** What a Stripe event means for a workspace's plan, or null when we don't care about it. */
export function planChange(event: { type: string; data: { object: Record<string, unknown> } }): { workspace: string; plan: Plan; customer?: string; subscription?: string } | null {
  const o = event.data.object;
  const meta = (o.metadata ?? {}) as Record<string, string>;
  const ws = String(meta.workspace ?? o.client_reference_id ?? "");
  if (!/^[0-9a-f]{16}$/.test(ws)) return null;
  if (event.type === "checkout.session.completed" && o.mode === "subscription")
    return { workspace: ws, plan: "pro", customer: String(o.customer ?? ""), subscription: String(o.subscription ?? "") };
  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
    const active = o.status === "active" || o.status === "trialing" || o.status === "past_due";
    return { workspace: ws, plan: active ? "pro" : "free", customer: String(o.customer ?? ""), subscription: String(o.id ?? "") };
  }
  if (event.type === "customer.subscription.deleted") return { workspace: ws, plan: "free" };
  return null;
}
