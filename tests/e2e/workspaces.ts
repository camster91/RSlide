// End-to-end tests for v1.0: team workspaces (roles, invites, shared events), analytics across events, SSO switch.
// Start the app first (`npm run preview`), then run `npm run test:e2e`. Needs AUTH_DEV_LINKS="1" in .dev.vars.
import { BASE, Client, createEvent } from "./client";

let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) fails++;
};

class Browser {
  cookie = "";
  constructor(public email = "") {}
  async req(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const r = await fetch(`${BASE}${path}`, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...(init.headers ?? {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      redirect: "manual",
    });
    const set = r.headers.get("set-cookie");
    if (set && set.startsWith("rs_session")) this.cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    return { status: r.status, headers: r.headers, data: (await r.json().catch(() => null)) as any };
  }
  async signIn() {
    const start = await this.req("/api/auth/start", { body: { email: this.email } });
    const link = new URL(start.data.devLink);
    await this.req("/api/auth/finish", { body: { a: link.searchParams.get("a"), t: link.searchParams.get("t") } });
    return this;
  }
}

const cfg = await new Browser().req("/api/auth/config");
if (!cfg.data.accounts) {
  console.log('SKIP workspace tests: add AUTH_DEV_LINKS="1" to .dev.vars to run them');
  if (process.env.CI) ok(false, "CI must run workspace tests");
} else {
  const n = Date.now();
  const owner = await new Browser(`owner-${n}@example.com`).signIn();
  const ed = await new Browser(`editor-${n}@example.com`).signIn();
  const viewer = await new Browser(`viewer-${n}@example.com`).signIn();
  const stranger = await new Browser(`stranger-${n}@example.com`).signIn();

  ok(cfg.data.email === true, "config says email sign-in is on");
  ok((await new Browser().req("/api/workspaces")).status === 401, "workspaces need sign-in");
  ok((await owner.req("/api/workspaces", { body: { name: "  " } })).status === 400, "workspace needs a name");

  const made = await owner.req("/api/workspaces", { body: { name: "Marketing" } });
  ok(made.status === 201 && /^[0-9a-f]{16}$/.test(made.data.id) && made.data.role === "owner", "create a workspace (you're the owner)");
  const id = made.data.id as string;
  const W = `/api/workspaces/${id}`;
  ok((await owner.req("/api/me")).data.workspaces.some((w: any) => w.id === id), "it shows in your account");
  ok((await stranger.req(W)).status === 404, "people outside can't see it");
  ok((await owner.req(W, { body: { brand: { color: "#00A86B", font: "rounded" } } })).data.brand.color === "#00a86b", "owner sets the workspace brand");

  // Invites
  const inv = await owner.req(`${W}/invites`, { body: { email: ed.email.toUpperCase(), role: "editor" } });
  ok(inv.status === 200 && inv.data.sent === false && inv.data.link.includes("/join-team?w="), "invite link made (no email set up, so it's returned)");
  const invV = await owner.req(`${W}/invites`, { body: { email: viewer.email, role: "viewer" } });
  ok((await ed.req(`${W}/invites`, { body: { email: "x@example.com", role: "owner" } })).status === 404, "non-members can't invite");
  const tok = (l: string) => new URL(l).searchParams.get("t");
  ok((await stranger.req(`${W}/join`, { body: { t: tok(inv.data.link) } })).data?.error?.includes("different email"), "an invite only works for its email");
  const joined = await ed.req(`${W}/join`, { body: { t: tok(inv.data.link) } });
  ok(joined.status === 200 && joined.data.role === "editor", "editor joins with the invite");
  ok((await ed.req(`${W}/join`, { body: { t: tok(inv.data.link) } })).status === 400, "invite links work once");
  await viewer.req(`${W}/join`, { body: { t: tok(invV.data.link) } });
  const d = (await owner.req(W)).data;
  ok(d.members.length === 3 && d.invites.length === 0, "owner sees 3 members and no open invites");
  ok((await ed.req(`${W}/invites`, { body: { email: "x@example.com" } })).data?.error === "Only workspace owners can do that", "editors can't invite");

  // Events
  const evRes = await ed.req("/api/events", { body: { title: "Launch Q&A", workspace: id } });
  ok(evRes.status === 201, "editor makes an event in the workspace");
  const host = await Client.connect(evRes.data.code, "host", `wsh-${n}`, evRes.data.hostKey);
  ok(host.snap.meta.settings.brand.color === "#00a86b" && host.snap.meta.settings.brand.font === "rounded", "new event starts with the workspace brand");
  host.close();
  ok((await viewer.req("/api/events", { body: { title: "Nope", workspace: id } })).status === 403, "viewers can't make events in it");
  const own = await createEvent("Older event");
  ok((await ed.req(`${W}/events`, { body: { code: own.code, key: "wrong" } })).status === 403, "adding an event needs its host key");
  ok((await ed.req(`${W}/events`, { body: { code: own.code, key: own.hostKey } })).status === 200, "editor adds an event they host");
  const asOwner = (await owner.req(W)).data;
  const asViewer = (await viewer.req(W)).data;
  ok(asOwner.events.length === 2 && asOwner.events.every((e: any) => e.hostKey), "everyone sees the shared events; editors+ get host links");
  ok(asViewer.events.length === 2 && asViewer.events.every((e: any) => !e.hostKey), "viewers don't get host links");
  ok(asViewer.invites.length === 0, "only owners see invites");
  const a = await viewer.req(`${W}/events/${evRes.data.code}/analytics`);
  ok(a.status === 200 && a.data.title === "Launch Q&A", "viewers can open an event's analytics");
  ok((await stranger.req(`${W}/events/${evRes.data.code}/analytics`)).status === 404, "outsiders can't");

  // Analytics across events
  const trends = await viewer.req(`${W}/analytics`);
  ok(trends.status === 200 && trends.data.events.length === 2 && "participants" in trends.data.events[0], "workspace insights list every event");
  const mine = await ed.req("/api/me/analytics");
  ok(mine.status === 200 && mine.data.events.some((e: any) => e.code === evRes.data.code), "personal insights cover your own events");

  // Roles
  ok((await owner.req(`${W}/members/${encodeURIComponent(owner.email)}`, { body: { role: "editor" } })).status === 400, "the only owner can't step down");
  ok((await owner.req(`${W}/members/${encodeURIComponent(viewer.email)}`, { body: { role: "editor" } })).status === 200, "owner changes a role");
  ok((await viewer.req("/api/me")).data.workspaces.find((w: any) => w.id === id)?.role === "editor", "the member's own list shows the new role");
  ok((await viewer.req(`${W}/events/${own.code}`, { method: "DELETE" })).status === 200, "editors can take events off the list");
  ok((await ed.req(`${W}/members/${encodeURIComponent(viewer.email)}`, { method: "DELETE" })).status === 400, "editors can't remove people");
  ok((await viewer.req(`${W}/members/${encodeURIComponent(viewer.email)}`, { method: "DELETE" })).status === 200, "anyone can leave");
  ok((await viewer.req(W)).status === 404 && !(await viewer.req("/api/me")).data.workspaces.length, "after leaving it's gone from their list");
  ok((await owner.req("/api/me", { method: "DELETE" })).status === 400, "the only owner can't delete their account while owning a workspace");

  // Cross-site requests are refused
  ok((await owner.req(W, { body: { name: "x" }, headers: { origin: "https://evil.example" } })).status === 403, "other websites can't change a workspace");

  // Delete
  ok((await ed.req(W, { method: "DELETE" })).status === 400, "only owners can delete it");
  ok((await owner.req(W, { method: "DELETE" })).status === 200, "owner deletes the workspace");
  ok((await ed.req("/api/me")).data.workspaces.length === 0, "it's gone from members' lists");
  ok((await owner.req(W)).status === 404, "and from the owner's");
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
