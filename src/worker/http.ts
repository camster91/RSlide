// Small HTTP helpers shared by the routes: JSON replies, cookies and who's signed in.
import type { Env } from "./room";
import { devMode, mailReady } from "./mail";
import { ssoReady } from "./sso";

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });

export const SESSION_COOKIE = "rs_session";

export function cookie(req: Request, name: string): string {
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : "";
}

export function setCookie(url: URL, name: string, value: string, maxAge: number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${url.protocol === "https:" ? "; Secure" : ""}`;
}

/** Accounts work when email sign-in, single sign-on, or (on this machine only) development links are set up. */
export const accountsOn = (env: Env, hostname: string) => !!env.ACCOUNTS && (mailReady(env) || ssoReady(env) || devMode(env, hostname));

/** The signed-in host for this request, if any. */
export async function session(req: Request, env: Env) {
  if (!accountsOn(env, new URL(req.url).hostname)) return null;
  const [acct, token] = cookie(req, SESSION_COOKIE).split(".");
  if (!acct || !token || !/^[0-9a-f]{32}$/.test(acct)) return null;
  const stub = env.ACCOUNTS!.getByName(acct);
  const email = await stub.checkSession(token);
  return email ? { acct, token, stub, email } : null;
}
export type Session = NonNullable<Awaited<ReturnType<typeof session>>>;

/** Changes must come from this site as JSON, so other websites can't act for a signed-in host. */
export function sameSiteJson(req: Request, url: URL): Response | null {
  if (req.method === "GET" || req.method === "HEAD") return null;
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "Forbidden" }, 403);
  if (req.method === "POST" && !(req.headers.get("content-type") ?? "").includes("application/json")) return json({ error: "Send JSON" }, 415);
  return null;
}
