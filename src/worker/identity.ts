// Small helpers for host accounts. No Cloudflare imports, so they can be unit tested.

export const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const random = (bytes = 24) => hex(crypto.getRandomValues(new Uint8Array(bytes)).buffer as ArrayBuffer);
export const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

export const normEmail = (e: unknown) => String(e ?? "").trim().toLowerCase();
export const isEmail = (e: string) => e.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
/** The account's Durable Object name. A hash, so email addresses don't appear in IDs or cookies. */
export const accountId = async (email: string) => (await sha256(`rslide-account:${normEmail(email)}`)).slice(0, 32);

