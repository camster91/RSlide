import { describe, expect, it, vi } from "vitest";
import { emailFrom, pkceChallenge, safeReturn, verifyIdToken } from "../../src/worker/sso";

const b64url = (b: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof b === "string" ? b : new Uint8Array(b as ArrayBuffer)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function makeToken(claims: Record<string, unknown>, kid = "k1") {
  const { privateKey, publicKey } = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const head = b64url(JSON.stringify({ alg: "RS256", kid }));
  const body = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${head}.${body}`));
  const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid };
  return { token: `${head}.${body}.${b64url(sig)}`, jwk };
}

describe("single sign-on", () => {
  const base = { iss: "https://idp.example", aud: "client-1", exp: Math.floor(Date.now() / 1000) + 300, nonce: "n1", email: "Ana@Acme.com", email_verified: true };
  const opts = { issuer: "https://idp.example", clientId: "client-1", nonce: "n1", jwksUri: "https://idp.example/jwks" };

  it("accepts a good ID token and rejects tampered ones", async () => {
    const { token, jwk } = await makeToken(base);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ keys: [jwk] }));
    expect((await verifyIdToken(token, opts)).email).toBe("Ana@Acme.com");
    const [h, , s] = token.split(".");
    const forged = `${h}.${b64url(JSON.stringify({ ...base, email: "boss@acme.com" }))}.${s}`;
    await expect(verifyIdToken(forged, opts)).rejects.toThrow("signature");
    await expect(verifyIdToken(token, { ...opts, nonce: "other" })).rejects.toThrow("nonce");
    await expect(verifyIdToken(token, { ...opts, clientId: "client-2" })).rejects.toThrow("different app");
    await expect(verifyIdToken(token, { ...opts, issuer: "https://evil.example" })).rejects.toThrow("issuer");
    fetchMock.mockRestore();
  });

  it("rejects expired tokens", async () => {
    const { token, jwk } = await makeToken({ ...base, exp: Math.floor(Date.now() / 1000) - 3600 }, "k2");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ keys: [jwk] }));
    await expect(verifyIdToken(token, { ...opts, jwksUri: "https://idp.example/jwks2" })).rejects.toThrow("expired");
    fetchMock.mockRestore();
  });

  it("only uses verified emails from allowed domains", () => {
    expect(emailFrom({ ...base })).toBe("ana@acme.com");
    expect(emailFrom({ ...base, email_verified: false })).toBeNull();
    expect(emailFrom({ ...base, email: undefined, preferred_username: "ana@acme.com" })).toBe("ana@acme.com");
    expect(emailFrom({ ...base, email: undefined, preferred_username: "ana" })).toBeNull();
    expect(emailFrom({ ...base }, "acme.com, acme.ca")).toBe("ana@acme.com");
    expect(emailFrom({ ...base }, "@other.com")).toBeNull();
  });

  it("only returns to pages on this site", () => {
    expect(safeReturn("/teams/abc#people")).toBe("/teams/abc#people");
    expect(safeReturn("/join-team?w=1&t=2")).toBe("/join-team?w=1&t=2");
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", 42]) expect(safeReturn(bad)).toBe("/events");
  });

  it("makes PKCE challenges (RFC 7636 example)", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
