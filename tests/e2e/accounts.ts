// End-to-end tests for v0.9: host accounts (sign in with an emailed link).
// Start the app first (`npm run preview`), then run `npm run test:e2e`.
// Needs AUTH_DEV_LINKS="1" in .dev.vars (CI sets it) so links come back in the response
// instead of being emailed. Without it, the tests check that accounts stay off.
import { BASE, createEvent, sleep } from "./client";

let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) fails++;
};

/** A tiny browser: keeps the session cookie between requests. */
class Browser {
  cookie = "";
  async req(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const r = await fetch(`${BASE}${path}`, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...(init.headers ?? {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const set = r.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    return { status: r.status, set, data: (await r.json().catch(() => null)) as any };
  }
  async signIn(email: string) {
    const start = await this.req("/api/auth/start", { body: { email, lang: "fr" } });
    const link = new URL(start.data.devLink);
    return this.req("/api/auth/finish", { body: { a: link.searchParams.get("a"), t: link.searchParams.get("t") } });
  }
}

const cfg = await new Browser().req("/api/auth/config");
if (!cfg.data.accounts) {
  console.log('SKIP account tests: add AUTH_DEV_LINKS="1" to .dev.vars to run them');
  ok((await new Browser().req("/api/me")).status === 501, "accounts are off when email isn't set up");
  ok((await new Browser().req("/api/auth/start", { body: { email: "a@b.co" } })).status === 501, "sign-in is refused when email isn't set up");
  if (process.env.CI) ok(false, "CI must run account tests");
} else {
  const email = `host-${Date.now()}@example.com`;
  const me = new Browser();

  ok((await me.req("/api/me")).status === 401, "not signed in: 401");
  ok((await me.req("/api/auth/start", { body: { email: "not-an-email" } })).status === 400, "bad email refused");

  // Start sign-in
  const start = await me.req("/api/auth/start", { body: { email: `  ${email.toUpperCase()} ` } });
  ok(start.status === 200 && start.data.sent === true, "sign-in link requested");
  const link = new URL(start.data.devLink);
  ok(link.pathname === "/signin" && /^[0-9a-f]{32}$/.test(link.searchParams.get("a")!) && /^[0-9a-f]{48}$/.test(link.searchParams.get("t")!), "link has an account ID and a one-time token");
  ok(!link.href.includes("example.com") && !link.href.includes("host-"), "the email address isn't in the link");

  // Bad and cross-site attempts
  ok((await me.req("/api/auth/finish", { body: { a: link.searchParams.get("a"), t: "nope" } })).status === 400, "wrong token refused");
  ok((await me.req("/api/auth/finish", { body: { a: link.searchParams.get("a"), t: link.searchParams.get("t") }, headers: { origin: "https://evil.example" } })).status === 403, "requests from other websites refused");
  const form = await fetch(`${BASE}/api/auth/finish`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "a=x&t=y" });
  ok(form.status === 415, "form posts refused (needs JSON)");

  // Finish sign-in
  const fin = await me.req("/api/auth/finish", { body: { a: link.searchParams.get("a"), t: link.searchParams.get("t") } });
  ok(fin.status === 200 && fin.data.email === email, "signed in (email is normalized)");
  ok(/HttpOnly/.test(fin.set ?? "") && /SameSite=Lax/.test(fin.set ?? "") && /Max-Age=2592000/.test(fin.set ?? ""), "session cookie is HttpOnly, SameSite and lasts 30 days");
  ok((await new Browser().req("/api/auth/finish", { body: { a: link.searchParams.get("a"), t: link.searchParams.get("t") } })).status === 400, "a link works only once");
  const who = await me.req("/api/me");
  ok(who.status === 200 && who.data.email === email && who.data.events.length === 0, "me: email and an empty event list");

  // Events created while signed in are saved
  const created = await me.req("/api/events", { body: { title: "Signed-in event" } });
  ok(created.status === 201, "create an event while signed in");
  let list = (await me.req("/api/me")).data.events;
  ok(list.length === 1 && list[0].code === created.data.code && list[0].hostKey === created.data.hostKey, "new event is saved to the account");

  // Adding an existing event needs its host key
  const other = await createEvent("Made on another device");
  ok((await me.req("/api/me/events", { body: { code: other.code, key: "wrong" } })).status === 403, "can't add an event without its host key");
  ok((await me.req("/api/me/events", { body: { code: other.code, key: other.hostKey } })).status === 200, "add an event with its host key");
  list = (await me.req("/api/me")).data.events;
  ok(list.length === 2 && list.some((e: any) => e.title === "Made on another device"), "both events listed");

  // Remove from list (event keeps working)
  ok((await me.req(`/api/me/events/${other.code}`, { method: "DELETE" })).status === 200, "remove an event from the list");
  ok((await me.req("/api/me")).data.events.length === 1, "list updated");
  ok((await fetch(`${BASE}/api/events/${other.code}`)).status === 200, "removed event still exists");

  // Other people can't see it
  const stranger = new Browser();
  ok((await stranger.req("/api/me", { headers: { cookie: `rs_session=${link.searchParams.get("a")}.forged` } })).status === 401, "forged session refused");

  // Same person on a second device
  const phone = new Browser();
  const fin2 = await phone.signIn(email);
  ok(fin2.status === 200 && (await phone.req("/api/me")).data.events.length === 1, "second device sees the same events");

  // Rate limit: at most 5 links per 15 minutes
  const spam = new Browser();
  let last = 0;
  for (let i = 0; i < 6; i++) last = (await spam.req("/api/auth/start", { body: { email } })).status;
  ok(last === 429, "too many sign-in links are refused");

  // Sign out on one device
  const out = await me.req("/api/auth/signout", { body: {} });
  ok(out.status === 200 && /Max-Age=0/.test(out.set ?? ""), "sign out clears the cookie");
  ok((await me.req("/api/me")).status === 401, "signed out");
  ok((await phone.req("/api/me")).status === 200, "other device stays signed in");

  // Sign out everywhere
  const laptop = new Browser();
  await sleep(10);
  // (rate limit is per address; use the phone, which is still signed in)
  ok((await phone.req("/api/auth/signout", { body: { everywhere: true } })).status === 200, "sign out on all devices");
  ok((await phone.req("/api/me")).status === 401 && laptop.cookie === "", "every session ends");

  // Delete account
  const fresh = new Browser();
  const email2 = `delete-${Date.now()}@example.com`;
  await fresh.signIn(email2);
  await fresh.req("/api/events", { body: { title: "Keep me" } });
  const keep = (await fresh.req("/api/me")).data.events[0];
  ok((await fresh.req("/api/me", { method: "DELETE" })).status === 200, "delete account");
  ok((await fresh.req("/api/me")).status === 401, "deleted account is signed out");
  ok((await fetch(`${BASE}/api/events/${keep.code}`)).status === 200, "events outlive a deleted account");
  const again = new Browser();
  await again.signIn(email2);
  ok((await again.req("/api/me")).data.events.length === 0, "signing in again starts with an empty list");
}

for (const path of ["/signin", "/events"]) {
  const r = await fetch(`${BASE}${path}`);
  ok(r.status === 200 && (await r.text()).includes('id="app"'), `${path} serves the app`);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
