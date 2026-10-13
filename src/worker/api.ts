// Public API and webhook helpers. Pure functions, so they're easy to test.
import { WEBHOOK_EVENTS, type WebhookEvent } from "../shared/protocol";
import { UserError } from "./logic";

export const WEBHOOK_BATCH_MS = 1000;
export const WEBHOOK_MAX_BATCH = 200;
export const WEBHOOK_TIMEOUT_MS = 8000;

/** Webhooks may only go to public HTTPS addresses (no local or private networks). */
export function checkWebhookUrl(raw: string, allowPrivate = false): string {
  let u: URL;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new UserError("Enter a full web address, starting with https://");
  }
  if (u.username || u.password) throw new UserError("Don't put a password in the address");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isPrivate =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host) ||
    host === "::1" ||
    /^(fc|fd|fe80)/.test(host) ||
    /^\d+$/.test(host);
  if (isPrivate && !allowPrivate) throw new UserError("Webhooks can't go to local or private network addresses");
  if (u.protocol !== "https:" && !(allowPrivate && u.protocol === "http:")) throw new UserError("Use an https:// address");
  if (u.href.length > 500) throw new UserError("That address is too long");
  return u.href;
}

export function cleanWebhookEvents(list: unknown): WebhookEvent[] {
  const arr = Array.isArray(list) ? list : [];
  const picked = WEBHOOK_EVENTS.filter((e) => arr.includes(e));
  return picked.length ? picked : [...WEBHOOK_EVENTS].filter((e) => e !== "response.created");
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Signature of `${timestamp}.${body}`, sent as "X-RSlide-Signature: sha256=<hex>". */
export async function signWebhook(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `sha256=${hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)))}`;
}

export function newSecret(): string {
  return hex(crypto.getRandomValues(new Uint8Array(24)).buffer as ArrayBuffer);
}

/** API keys start with "rs_" so they're easy to spot (and to keep out of code). */
export const newApiKey = () => `rs_${newSecret()}`;

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, OPTIONS" };
export const apiJson = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store", ...CORS } });
export const apiRaw = (json: string, status = 200) => new Response(json, { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS } });
export const apiPreflight = () => new Response(null, { status: 204, headers: { ...CORS, "access-control-max-age": "86400" } });

/** Bearer token from the Authorization header, or ?key= for quick tests in a browser. */
export function apiKeyFrom(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : (new URL(req.url).searchParams.get("key") ?? "");
}
