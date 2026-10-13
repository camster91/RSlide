import { describe, expect, it } from "vitest";
import { apiKeyFrom, checkWebhookUrl, cleanWebhookEvents, newApiKey, newSecret, signWebhook } from "../../src/worker/api";

describe("webhook addresses", () => {
  it("accepts public https addresses", () => {
    expect(checkWebhookUrl(" https://hooks.example.com/rslide?x=1 ")).toBe("https://hooks.example.com/rslide?x=1");
  });
  it.each([
    ["http://example.com/hook", "https://"],
    ["https://localhost/hook", "private"],
    ["https://127.0.0.1/hook", "private"],
    ["https://10.1.2.3/hook", "private"],
    ["https://192.168.0.5/hook", "private"],
    ["https://172.20.0.1/hook", "private"],
    ["https://169.254.169.254/latest", "private"],
    ["https://[::1]/hook", "private"],
    ["https://2130706433/hook", "private"],
    ["https://printer.local/hook", "private"],
    ["https://user:pw@example.com/hook", "password"],
    ["not a url", "full web address"],
  ])("refuses %s", (url, why) => {
    expect(() => checkWebhookUrl(url)).toThrow(new RegExp(why));
  });
  it("allows local http only when asked (tests and development)", () => {
    expect(checkWebhookUrl("http://127.0.0.1:9999/x", true)).toBe("http://127.0.0.1:9999/x");
    expect(() => checkWebhookUrl("ftp://127.0.0.1/x", true)).toThrow();
  });
});

describe("webhook events", () => {
  it("keeps known events and defaults to everything but answers", () => {
    expect(cleanWebhookEvents(["poll.launched", "nope"])).toEqual(["poll.launched"]);
    const d = cleanWebhookEvents(undefined);
    expect(d).toContain("question.created");
    expect(d).not.toContain("response.created");
  });
});

describe("signing", () => {
  it("matches a known HMAC-SHA256", async () => {
    // echo -n "1700000000000.{\"a\":1}" | openssl dgst -sha256 -hmac secret
    expect(await signWebhook("secret", 1700000000000, '{"a":1}')).toBe("sha256=" + (await hmac("secret", '1700000000000.{"a":1}')));
  });
  it("makes random keys", () => {
    expect(newApiKey()).toMatch(/^rs_[0-9a-f]{48}$/);
    expect(newSecret()).not.toBe(newSecret());
  });
  it("reads the key from the header or the URL", () => {
    expect(apiKeyFrom(new Request("https://x/api", { headers: { authorization: "Bearer rs_abc" } }))).toBe("rs_abc");
    expect(apiKeyFrom(new Request("https://x/api?key=rs_q"))).toBe("rs_q");
    expect(apiKeyFrom(new Request("https://x/api"))).toBe("");
  });
});

async function hmac(secret: string, msg: string) {
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", secret).update(msg).digest("hex");
}
