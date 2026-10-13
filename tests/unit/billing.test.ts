import { describe, expect, it } from "vitest";
import { capacity, planChange, verifyStripe } from "../../src/worker/billing";
import { hex } from "../../src/worker/identity";

async function sign(payload: string, secret: string, t: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `t=${t},v1=${hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)))}`;
}

describe("billing", () => {
  it("checks Stripe signatures", async () => {
    const now = Date.now();
    const t = Math.floor(now / 1000);
    const body = '{"type":"x"}';
    await expect(verifyStripe(body, await sign(body, "whsec_1", t), "whsec_1", now)).resolves.toBeUndefined();
    await expect(verifyStripe(body, await sign(body, "whsec_2", t), "whsec_1", now)).rejects.toThrow("Bad signature");
    await expect(verifyStripe('{"type":"y"}', await sign(body, "whsec_1", t), "whsec_1", now)).rejects.toThrow("Bad signature");
    await expect(verifyStripe(body, await sign(body, "whsec_1", t - 600), "whsec_1", now)).rejects.toThrow("too old");
    await expect(verifyStripe(body, "", "whsec_1", now)).rejects.toThrow("Missing");
  });

  it("maps Stripe events to plans", () => {
    const ws = "0123456789abcdef";
    expect(planChange({ type: "checkout.session.completed", data: { object: { mode: "subscription", client_reference_id: ws, customer: "cus_1", subscription: "sub_1" } } })).toEqual({ workspace: ws, plan: "pro", customer: "cus_1", subscription: "sub_1" });
    expect(planChange({ type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "canceled", customer: "cus_1", metadata: { workspace: ws } } } })?.plan).toBe("free");
    expect(planChange({ type: "customer.subscription.deleted", data: { object: { metadata: { workspace: ws } } } })).toEqual({ workspace: ws, plan: "free" });
    expect(planChange({ type: "invoice.paid", data: { object: { metadata: { workspace: ws } } } })).toBeNull();
    expect(planChange({ type: "checkout.session.completed", data: { object: { mode: "subscription", client_reference_id: "../x" } } })).toBeNull();
  });

  it("works out attendee limits", () => {
    expect(capacity({}, "free")).toBe(0);
    expect(capacity({ MAX_PARTICIPANTS: "500" }, "pro")).toBe(500);
    expect(capacity({ MAX_PARTICIPANTS: "500", FREE_MAX_PARTICIPANTS: "100", PRO_MAX_PARTICIPANTS: "5000" }, "free")).toBe(100);
    expect(capacity({ MAX_PARTICIPANTS: "500", FREE_MAX_PARTICIPANTS: "100", PRO_MAX_PARTICIPANTS: "5000" }, "pro")).toBe(5000);
  });
});
