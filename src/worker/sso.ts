// Single sign-on with any OpenID Connect provider: Microsoft Entra ID, Google Workspace, Okta, Auth0, Keycloak…
// Turn it on with three settings (see README):
//   OIDC_ISSUER         e.g. https://login.microsoftonline.com/<tenant-id>/v2.0  or  https://accounts.google.com
//   OIDC_CLIENT_ID
//   OIDC_CLIENT_SECRET  (a secret: `npx wrangler secret put OIDC_CLIENT_SECRET`)
// Optional:
//   OIDC_NAME             button label, e.g. "Microsoft" → "Sign in with Microsoft"
//   OIDC_ALLOWED_DOMAINS  e.g. "acme.com, acme.ca" — only these email domains may sign in
import { normEmail, random } from "./identity";
import { UserError } from "./logic";

export interface SsoEnv {
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  OIDC_NAME?: string;
  OIDC_ALLOWED_DOMAINS?: string;
}

export const ssoReady = (env: SsoEnv) => !!(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET);
export const ssoName = (env: SsoEnv) => (ssoReady(env) ? env.OIDC_NAME?.trim() || "SSO" : null);

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

let discovery: { at: number; issuer: string; doc: Discovery } | null = null;
let jwks: { at: number; uri: string; keys: JsonWebKey[] } | null = null;
const HOUR = 3_600_000;

/** Plain http is only allowed for a test provider on this machine (development and tests). */
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//;

async function discover(issuer: string, allowLocal = false): Promise<Discovery> {
  if (discovery && discovery.issuer === issuer && Date.now() - discovery.at < HOUR) return discovery.doc;
  const r = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  if (!r.ok) throw new Error(`Discovery failed (${r.status})`);
  const doc = (await r.json()) as Discovery;
  for (const k of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) if (!(doc[k]?.startsWith("https://") || (allowLocal && LOCAL.test(doc[k] ?? "")))) throw new Error(`Bad ${k}`);
  discovery = { at: Date.now(), issuer, doc };
  return doc;
}

async function keys(uri: string, force = false): Promise<JsonWebKey[]> {
  if (!force && jwks && jwks.uri === uri && Date.now() - jwks.at < HOUR) return jwks.keys;
  const r = await fetch(uri);
  if (!r.ok) throw new Error(`Couldn't load signing keys (${r.status})`);
  const k = ((await r.json()) as { keys: JsonWebKey[] }).keys ?? [];
  jwks = { at: Date.now(), uri, keys: k };
  return k;
}

const b64url = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

export async function pkceChallenge(verifier: string) {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

/** Only paths on this site, so the sign-in can't bounce people to another website. */
export const safeReturn = (p: unknown) => (typeof p === "string" && /^\/(?![/\\])[\w\-./?=&#%]*$/.test(p) ? p : "/events");

export async function startUrl(env: SsoEnv, origin: string, returnTo: string, allowLocal = false) {
  const d = await discover(env.OIDC_ISSUER!, allowLocal);
  const state = random(16);
  const nonce = random(16);
  const verifier = random(32);
  const u = new URL(d.authorization_endpoint);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: env.OIDC_CLIENT_ID!,
    redirect_uri: `${origin}/api/auth/sso/callback`,
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  // Kept in a short-lived cookie and checked when the provider sends the person back.
  return { url: u.toString(), cookie: [state, verifier, nonce, encodeURIComponent(safeReturn(returnTo))].join(".") };
}

export interface IdClaims {
  iss: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  preferred_username?: string;
}

/** Checks an ID token: signature (RS256/ES256 from the provider's keys), issuer, audience, expiry and nonce. */
export async function verifyIdToken(token: string, opts: { issuer: string; clientId: string; nonce: string; jwksUri: string; now?: number }): Promise<IdClaims> {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) throw new Error("Malformed ID token");
  const header = JSON.parse(new TextDecoder().decode(fromB64url(h))) as { alg: string; kid?: string };
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(p))) as IdClaims;
  const alg = header.alg === "RS256" ? { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } : header.alg === "ES256" ? { name: "ECDSA", namedCurve: "P-256" } : null;
  if (!alg) throw new Error(`Unsupported signing method ${header.alg}`);
  const find = (list: JsonWebKey[]) => list.find((k) => (k as { kid?: string }).kid === header.kid) ?? (header.kid ? undefined : list[0]);
  const check = async (jwk: JsonWebKey | undefined) => {
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", { ...jwk, alg: header.alg, ext: true }, alg, false, ["verify"]);
    return crypto.subtle.verify(alg.name === "ECDSA" ? { name: "ECDSA", hash: "SHA-256" } : alg, key, fromB64url(s), new TextEncoder().encode(`${h}.${p}`));
  };
  // Try the saved keys first; if that fails, the provider may have rotated them, so fetch fresh ones once.
  if (!(await check(find(await keys(opts.jwksUri)))) && !(await check(find(await keys(opts.jwksUri, true))))) throw new Error("Bad ID token signature");
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  // Microsoft's "common" endpoints put the tenant in the issuer; accept that form too.
  const issOk = claims.iss === opts.issuer || claims.iss === opts.issuer.replace(/\/$/, "") || (opts.issuer.includes("{tenantid}") && new RegExp(`^${opts.issuer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("\\{tenantid\\}", "[0-9a-f-]{36}")}$`).test(claims.iss));
  if (!issOk) throw new Error("ID token from the wrong issuer");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(opts.clientId)) throw new Error("ID token for a different app");
  if (!claims.exp || claims.exp < now - 60) throw new Error("ID token expired");
  if (claims.nonce !== opts.nonce) throw new Error("ID token nonce mismatch");
  return claims;
}

/** The verified email from the claims, or null. Respects OIDC_ALLOWED_DOMAINS. */
export function emailFrom(claims: IdClaims, allowedDomains?: string): string | null {
  if (claims.email_verified === false || claims.email_verified === "false") return null;
  const email = normEmail(claims.email ?? (claims.preferred_username?.includes("@") ? claims.preferred_username : ""));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const domains = (allowedDomains ?? "").split(",").map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  if (domains.length && !domains.includes(email.split("@")[1])) return null;
  return email;
}

/** Trades the code from the provider for a verified email address. */
export async function finish(env: SsoEnv, origin: string, code: string, cookie: string, state: string, allowLocal = false): Promise<{ email: string; returnTo: string }> {
  const [cState, verifier, nonce, ret] = cookie.split(".");
  if (!cState || cState !== state) throw new UserError("Sign-in expired. Try again.");
  const d = await discover(env.OIDC_ISSUER!, allowLocal);
  const r = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${origin}/api/auth/sso/callback`,
      client_id: env.OIDC_CLIENT_ID!,
      client_secret: env.OIDC_CLIENT_SECRET!,
      code_verifier: verifier,
    }),
  });
  const tok = (await r.json().catch(() => ({}))) as { id_token?: string; error_description?: string };
  if (!r.ok || !tok.id_token) throw new Error(tok.error_description || `Token request failed (${r.status})`);
  const claims = await verifyIdToken(tok.id_token, { issuer: d.issuer, clientId: env.OIDC_CLIENT_ID!, nonce, jwksUri: d.jwks_uri });
  const email = emailFrom(claims, env.OIDC_ALLOWED_DOMAINS);
  if (!email) throw new UserError("Your account doesn't have an email address that's allowed here.");
  return { email, returnTo: safeReturn(decodeURIComponent(ret ?? "")) };
}
