// End-to-end test for single sign-on, against a tiny fake identity provider on this machine.
// Needs these in .dev.vars (CI writes them):
//   AUTH_DEV_LINKS="1"  OIDC_ISSUER="http://127.0.0.1:9911"  OIDC_CLIENT_ID="rslide-test"
//   OIDC_CLIENT_SECRET="test-secret"  OIDC_NAME="Test SSO"  OIDC_ALLOWED_DOMAINS="example.com"
import { createServer } from "node:http";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { BASE } from "./client";

let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) fails++;
};

const cfg = await (await fetch(`${BASE}/api/auth/config`)).json();
if (cfg.sso !== "Test SSO") {
  console.log("SKIP single sign-on test: add the OIDC_* test settings to .dev.vars to run it");
  if (process.env.CI) ok(false, "CI must run the SSO test");
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
}

// ----- the fake identity provider -----
const ISS = "http://127.0.0.1:9911";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid: "test-key", use: "sig", alg: "RS256" };
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const codes = new Map<string, { nonce: string; challenge: string; email: string; verified: boolean }>();
const idToken = (claims: object) => {
  const head = b64(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }));
  const body = b64(JSON.stringify(claims));
  return `${head}.${body}.${b64(sign("sha256", Buffer.from(`${head}.${body}`), privateKey))}`;
};
const server = createServer((req, res) => {
  const u = new URL(req.url!, ISS);
  const send = (status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (u.pathname === "/.well-known/openid-configuration")
    return send(200, { issuer: ISS, authorization_endpoint: `${ISS}/authorize`, token_endpoint: `${ISS}/token`, jwks_uri: `${ISS}/jwks` });
  if (u.pathname === "/jwks") return send(200, { keys: [jwk] });
  if (u.pathname === "/token" && req.method === "POST") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const f = new URLSearchParams(raw);
      const c = codes.get(f.get("code") ?? "");
      if (!c || f.get("client_secret") !== "test-secret" || f.get("client_id") !== "rslide-test") return send(400, { error: "invalid_grant", error_description: "bad code or client" });
      if (b64(createHash("sha256").update(f.get("code_verifier") ?? "").digest()) !== c.challenge) return send(400, { error: "invalid_grant", error_description: "PKCE check failed" });
      codes.delete(f.get("code")!);
      const now = Math.floor(Date.now() / 1000);
      send(200, { id_token: idToken({ iss: ISS, aud: "rslide-test", sub: "u1", iat: now, exp: now + 300, nonce: c.nonce, email: c.email, email_verified: c.verified }), token_type: "Bearer" });
    });
    return;
  }
  send(404, {});
});
await new Promise<void>((r) => server.listen(9911, "127.0.0.1", r));

/** Goes through the whole sign-in like a browser would, with the provider "approving" `email`. */
async function signInAs(email: string, opts: { verified?: boolean; tamperState?: boolean } = {}) {
  const start = await fetch(`${BASE}/api/auth/sso/start?return=${encodeURIComponent("/teams/0123456789abcdef#people")}`, { redirect: "manual" });
  const loc = new URL(start.headers.get("location") ?? "http://x/");
  const ssoCookie = (start.headers.get("set-cookie") ?? "").split(";")[0];
  const code = `c${Math.random().toString(36).slice(2)}`;
  codes.set(code, { nonce: loc.searchParams.get("nonce") ?? "", challenge: loc.searchParams.get("code_challenge") ?? "", email, verified: opts.verified ?? true });
  const state = opts.tamperState ? "wrong" : loc.searchParams.get("state");
  const cb = await fetch(`${BASE}/api/auth/sso/callback?code=${code}&state=${state}`, { redirect: "manual", headers: { cookie: ssoCookie } });
  const cookies = cb.headers.getSetCookie?.() ?? [];
  const session = cookies.find((c) => c.startsWith("rs_session=") && !c.startsWith("rs_session=;"))?.split(";")[0] ?? "";
  return { start, loc, cb, location: cb.headers.get("location") ?? "", session };
}

const r = await signInAs("Ana@Example.com");
ok(r.start.status === 302 && r.loc.origin === ISS && r.loc.pathname === "/authorize", "start sends you to the identity provider");
ok(r.loc.searchParams.get("code_challenge_method") === "S256" && r.loc.searchParams.get("redirect_uri") === `${BASE}/api/auth/sso/callback` && r.loc.searchParams.get("scope")?.includes("email"), "uses PKCE and asks for email");
ok(r.cb.status === 302 && r.location.startsWith("/teams/0123456789abcdef") && r.location.includes("signedin=1"), "back to where you started, signed in");
const me = await (await fetch(`${BASE}/api/me`, { headers: { cookie: r.session } })).json();
ok(me.email === "ana@example.com", "the account is the provider's verified email");

const bad = await signInAs("bob@example.com", { tamperState: true });
ok(bad.location.startsWith("/signin?error=") && !bad.session, "a mismatched state is refused");
const other = await signInAs("eve@other.org");
ok(decodeURIComponent(other.location).includes("allowed here") && !other.session, "emails outside OIDC_ALLOWED_DOMAINS are refused");
const unverified = await signInAs("carl@example.com", { verified: false });
ok(!unverified.session, "unverified emails are refused");
const open = await fetch(`${BASE}/api/auth/sso/start?return=${encodeURIComponent("//evil.example/x")}`, { redirect: "manual" });
const evil = await signInAs("dana@example.com");
ok(!evil.location.includes("evil") && (open.headers.get("set-cookie") ?? "").includes("events"), "return addresses on other sites are ignored");
const cancelled = await fetch(`${BASE}/api/auth/sso/callback?error=access_denied`, { redirect: "manual" });
ok((cancelled.headers.get("location") ?? "").startsWith("/signin?error="), "cancelling at the provider comes back with a message");

server.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
