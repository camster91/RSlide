// /api/workspaces/…: team workspaces with roles, invites, shared events and analytics across events.
import type { Analytics, EventStats } from "../shared/protocol";
import type { Env } from "./room";
import { accountId, isEmail, normEmail, random } from "./identity";
import { normCode, UserError } from "./logic";
import { devMode, mailReady, sendInvite } from "./mail";
import { atLeast, isRole, USER_ERROR, WS_LIMITS } from "./workspace";
import { billingReady, capacity, checkoutUrl, planChange, portalUrl, verifyStripe } from "./billing";
import { json, sameSiteJson, session, type Session } from "./http";

export async function workspaceRoutes(req: Request, env: Env, url: URL, parts: string[]): Promise<Response> {
  if (!env.WORKSPACES) return json({ error: "Team workspaces aren't set up on this server" }, 501);
  const bad = sameSiteJson(req, url);
  if (bad) return bad;
  const who = await session(req, env);
  if (!who) return json({ error: "Sign in first" }, 401);
  const body = req.method === "POST" || req.method === "PUT" ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};
  try {
    return await route(req, env, url, parts, who, body);
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, 400);
    const m = e instanceof Error ? e.message : "";
    if (m.startsWith(USER_ERROR)) return json({ error: m.slice(USER_ERROR.length) }, 400);
    throw e;
  }
}

async function route(req: Request, env: Env, url: URL, parts: string[], who: Session, body: Record<string, unknown>): Promise<Response> {
  const WS = env.WORKSPACES!;
  // GET /api/workspaces → mine.  POST → make a new one (you're its owner).
  if (parts.length === 2) {
    if (req.method === "GET") return json({ workspaces: await who.stub.workspaces() });
    if (req.method === "POST") {
      const name = String(body.name ?? "").trim().slice(0, WS_LIMITS.name);
      if (!name) return json({ error: "Give the workspace a name" }, 400);
      const id = random(8);
      if (!(await who.stub.setWorkspace({ id, name, role: "owner" }))) return json({ error: "You're in the most workspaces allowed" }, 400);
      await WS.getByName(id).create(id, name, who.email);
      return json({ id, name, role: "owner" }, 201);
    }
    return json({ error: "Method not allowed" }, 405);
  }

  const id = parts[2];
  if (!/^[0-9a-f]{16}$/.test(id)) return json({ error: "Not found" }, 404);
  const ws = WS.getByName(id);
  const what = parts[3] ?? "";

  // Accepting an invite: you aren't a member yet.
  if (what === "join" && req.method === "POST") {
    const r = await ws.accept(String(body.t ?? ""), who.email);
    await who.stub.setWorkspace(r);
    return json(r);
  }

  const detail = await ws.detail(who.email);
  if (!detail) {
    await who.stub.dropWorkspace(id); // gone, or we were removed: tidy the list
    return json({ error: "You're not in this workspace" }, 404);
  }
  const role = detail.role;
  // Keep the account's list (name and role) in step.
  await who.stub.setWorkspace({ id, name: detail.name, role });

  if (what === "") {
    if (req.method === "GET") return json({ ...detail, billing: billingReady(env), limits: { free: capacity(env, "free"), pro: capacity(env, "pro") } });
    if (req.method === "POST") {
      const r = await ws.update(who.email, { name: typeof body.name === "string" ? body.name : undefined, brand: body.brand });
      await who.stub.setWorkspace({ id, name: r.name, role });
      return json(r);
    }
    if (req.method === "DELETE") {
      const members = await ws.destroy(who.email);
      await Promise.all(members.map(async (m) => env.ACCOUNTS!.getByName(await accountId(m)).dropWorkspace(id)));
      return json({ ok: true });
    }
  }

  if (what === "invites") {
    if (req.method === "POST") {
      const email = normEmail(body.email);
      if (!isEmail(email)) return json({ error: "Enter a valid email address" }, 400);
      const r = isRole(body.role) ? body.role : "editor";
      const token = await ws.invite(who.email, email, r);
      const link = `${url.origin}/join-team?w=${id}&t=${token}`;
      if (mailReady(env)) {
        try {
          await sendInvite(env, email, who.email, detail.name, link, String(body.lang ?? "en"));
        } catch (e) {
          console.error("Invite email failed:", (e as Error).message);
          // The invite still works; the owner can copy the link instead.
          return json({ sent: false, link });
        }
        return json({ sent: true, link });
      }
      // No email set up: the owner shares the link themselves.
      return json({ sent: false, link, ...(devMode(env, url.hostname) ? { devLink: link } : {}) });
    }
    if (req.method === "DELETE" && parts[4]) {
      await ws.cancelInvite(who.email, normEmail(decodeURIComponent(parts[4])));
      return json({ ok: true });
    }
  }

  if (what === "members" && parts[4]) {
    const email = normEmail(decodeURIComponent(parts[4]));
    const acct = env.ACCOUNTS!.getByName(await accountId(email));
    if (req.method === "POST") {
      if (!isRole(body.role)) return json({ error: "Pick a role" }, 400);
      await ws.setRole(who.email, email, body.role);
      await acct.setWorkspace({ id, name: detail.name, role: body.role });
      return json({ ok: true });
    }
    if (req.method === "DELETE") {
      await ws.removeMember(who.email, email);
      await acct.dropWorkspace(id);
      return json({ ok: true });
    }
  }

  if (what === "events") {
    // POST {code, key}: add an event you host.  DELETE /CODE: take it off the list (the event itself stays).
    if (req.method === "POST" && parts.length === 4) {
      const code = normCode(body.code);
      const key = String(body.key ?? "");
      const room = env.EVENTS.getByName(code);
      if (!code || !(await room.isHost(key))) return json({ error: "That isn't a host link for this event" }, 403);
      const info = await room.info();
      await ws.addEvent(who.email, { code, title: info?.title ?? code, hostKey: key });
      await room.setPlan(detail.plan);
      return json({ ok: true });
    }
    if (req.method === "DELETE" && parts[4]) {
      await ws.removeEvent(who.email, normCode(parts[4]));
      // Leaving a paid workspace drops the event back to the free limit.
      if (detail.plan === "pro") await env.EVENTS.getByName(normCode(parts[4])).setPlan("free");
      return json({ ok: true });
    }
    // GET /CODE/analytics: everyone in the workspace, viewers included (we use the host key for them).
    if (req.method === "GET" && parts[4] && parts[5] === "analytics") {
      const code = normCode(parts[4]);
      const key = (await ws.hostKeys(who.email, [code]))?.[0]?.hostKey;
      if (!key) return json({ error: "Not found" }, 404);
      const data = await env.EVENTS.getByName(code).analytics(key);
      return data ? json(data) : json({ error: "Not found" }, 404);
    }
  }

  // Paid plans (Stripe): owners start checkout or open the billing portal.
  if (what === "billing" && req.method === "POST") {
    if (!billingReady(env)) return json({ error: "Paid plans aren't set up on this server" }, 501);
    if (role !== "owner") return json({ error: "Only workspace owners can do that" }, 403);
    try {
      if (parts[4] === "checkout") return json({ url: await checkoutUrl(env, { origin: url.origin, workspace: id, email: who.email }) });
      if (parts[4] === "portal") {
        const customer = await ws.customerFor(who.email);
        if (!customer) return json({ error: "There's no billing account for this workspace yet" }, 400);
        return json({ url: await portalUrl(env, { origin: url.origin, workspace: id, customer }) });
      }
    } catch (e) {
      console.error("Stripe failed:", (e as Error).message);
      return json({ error: "Billing isn't working right now. Try again soon." }, 502);
    }
  }

  // GET /analytics: headline numbers for every event, to compare them over time.
  if (what === "analytics" && req.method === "GET") {
    const list = (await ws.hostKeys(who.email)) ?? [];
    return json({ events: await statsFor(env, list.slice(0, 200)) });
  }

  return json({ error: atLeast(role, "viewer") ? "Not found" : "Forbidden" }, 404);
}

export async function statsFor(env: Env, list: { code: string; title: string; hostKey: string }[]): Promise<EventStats[]> {
  const out = await Promise.all(
    list.map(async (e) => {
      try {
        const a = await env.EVENTS.getByName(e.code).analytics(e.hostKey);
        return a ? toStats(a) : null;
      } catch {
        return null; // deleted or expired events drop out
      }
    }),
  );
  return out.filter((x): x is EventStats => !!x).sort((a, b) => a.createdAt - b.createdAt);
}

export const toStats = (a: Analytics): EventStats => ({
  code: a.code,
  title: a.title,
  createdAt: a.createdAt,
  participants: a.participants,
  peakOnline: a.peakOnline,
  questions: a.questions,
  votes: a.votes,
  polls: a.polls.length,
  answers: a.polls.reduce((n, p) => n + p.responses, 0),
  reactions: a.reactions,
});


/** POST /api/billing/webhook: Stripe tells us about payments. Signed, so nobody else can change plans. */
export async function billingWebhook(req: Request, env: Env): Promise<Response> {
  if (!billingReady(env) || !env.WORKSPACES) return json({ error: "Not found" }, 404);
  const payload = await req.text();
  try {
    await verifyStripe(payload, req.headers.get("stripe-signature") ?? "", env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return json({ error: "Bad signature" }, 400);
  }
  const change = planChange(JSON.parse(payload));
  if (change) {
    const codes = await env.WORKSPACES.getByName(change.workspace).setPlan(change.plan, change.customer, change.subscription);
    await Promise.all(codes.map((c) => env.EVENTS.getByName(c).setPlan(change.plan).catch(() => null)));
  }
  return json({ received: true });
}
