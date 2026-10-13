// /api/auth/… and /api/me/…: sign in (email link or single sign-on), and the events saved to an account.
import type { Env } from "./room";
import { SESSION_DAYS } from "./accounts";
import { accountId, isEmail, normEmail } from "./identity";
import { normCode, UserError } from "./logic";
import { devMode, mailReady, sendSignIn } from "./mail";
import { finish as ssoFinish, ssoName, ssoReady, startUrl as ssoStart } from "./sso";
import { statsFor } from "./workspaceRoutes";
import { accountsOn, cookie, json, sameSiteJson, session, SESSION_COOKIE, setCookie } from "./http";

const SSO_COOKIE = "rs_sso";

export async function accountRoutes(req: Request, env: Env, url: URL, parts: string[]): Promise<Response> {
  const on = accountsOn(env, url.hostname);
  if (parts[1] === "auth" && parts[2] === "config")
    return json({ accounts: on, email: on && (mailReady(env) || devMode(env, url.hostname)), sso: on ? ssoName(env) : null });
  if (!on) return json({ error: "Host accounts aren't set up on this server" }, 501);

  // Single sign-on: plain browser redirects, so these come before the JSON-only check.
  if (parts[1] === "auth" && parts[2] === "sso") {
    if (!ssoReady(env)) return json({ error: "Single sign-on isn't set up on this server" }, 501);
    if (parts[3] === "start" && req.method === "GET") {
      try {
        const s = await ssoStart(env, url.origin, url.searchParams.get("return") ?? "/events", devMode(env, url.hostname));
        return new Response(null, { status: 302, headers: { location: s.url, "set-cookie": setCookie(url, SSO_COOKIE, s.cookie, 600), "cache-control": "no-store" } });
      } catch (e) {
        console.error("SSO start failed:", (e as Error).message);
        return back(url, "Single sign-on isn't working right now. Try again soon.");
      }
    }
    if (parts[3] === "callback" && req.method === "GET") {
      const clear = setCookie(url, SSO_COOKIE, "", 0);
      const err = url.searchParams.get("error_description") ?? url.searchParams.get("error");
      if (err) return back(url, "Sign-in was cancelled or refused.", clear);
      try {
        const r = await ssoFinish(env, url.origin, url.searchParams.get("code") ?? "", cookie(req, SSO_COOKIE), url.searchParams.get("state") ?? "", devMode(env, url.hostname));
        const acct = await accountId(r.email);
        const sess = await env.ACCOUNTS!.getByName(acct).ssoSession(r.email);
        const headers = new Headers({ location: `${r.returnTo}${r.returnTo.includes("?") ? "&" : "?"}signedin=1`, "cache-control": "no-store" });
        headers.append("set-cookie", clear);
        headers.append("set-cookie", setCookie(url, SESSION_COOKIE, `${acct}.${sess}`, SESSION_DAYS * 86_400));
        return new Response(null, { status: 302, headers });
      } catch (e) {
        console.error("SSO callback failed:", (e as Error).message);
        return e instanceof UserError ? back(url, e.message, clear) : back(url, "Single sign-on didn't work. Try again.", clear);
      }
    }
    return json({ error: "Not found" }, 404);
  }

  const bad = sameSiteJson(req, url);
  if (bad) return bad;
  const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};

  if (parts[1] === "auth") {
    const what = parts[2];
    if (what === "start" && req.method === "POST") {
      if (!mailReady(env) && !devMode(env, url.hostname)) return json({ error: "Email sign-in isn't set up here. Use single sign-on." }, 501);
      const email = normEmail(body.email);
      if (!isEmail(email)) return json({ error: "Enter a valid email address" }, 400);
      const acct = await accountId(email);
      const token = await env.ACCOUNTS!.getByName(acct).startSignIn(email);
      if (!token) return json({ error: "Too many sign-in links. Wait a few minutes and try again." }, 429);
      const ret = typeof body.return === "string" && /^\/(?![/\\])/.test(body.return) ? `&r=${encodeURIComponent(body.return)}` : "";
      const link = `${url.origin}/signin?a=${acct}&t=${token}${ret}`;
      if (mailReady(env)) {
        try {
          await sendSignIn(env, email, link, String(body.lang ?? "en"));
        } catch (e) {
          console.error("Sign-in email failed:", (e as Error).message);
          return json({ error: "We couldn't send the email. Try again soon." }, 502);
        }
      }
      return json({ sent: true, ...(devMode(env, url.hostname) && !mailReady(env) ? { devLink: link } : {}) });
    }
    if (what === "finish" && req.method === "POST") {
      const acct = String(body.a ?? "");
      if (!/^[0-9a-f]{32}$/.test(acct)) return json({ error: "This sign-in link isn't valid" }, 400);
      const r = await env.ACCOUNTS!.getByName(acct).finishSignIn(String(body.t ?? ""));
      if (!r) return json({ error: "This sign-in link has expired or was already used. Ask for a new one." }, 400);
      return json({ email: r.email }, 200, { "set-cookie": setCookie(url, SESSION_COOKIE, `${acct}.${r.session}`, SESSION_DAYS * 86_400) });
    }
    if (what === "signout" && req.method === "POST") {
      const who = await session(req, env);
      if (who) await who.stub.signOut(who.token, body.everywhere === true);
      return json({ ok: true }, 200, { "set-cookie": setCookie(url, SESSION_COOKIE, "", 0) });
    }
    return json({ error: "Not found" }, 404);
  }

  // /api/me…
  const who = await session(req, env);
  if (!who) return json({ error: "Sign in first" }, 401);
  if (parts.length === 2 && req.method === "GET") return json({ email: who.email, events: await who.stub.events(), workspaces: await who.stub.workspaces() });
  if (parts.length === 2 && req.method === "DELETE") {
    // Leave every workspace first (an only owner must hand over or delete the workspace).
    for (const w of await who.stub.workspaces()) {
      try {
        await env.WORKSPACES?.getByName(w.id).removeMember(who.email, who.email);
      } catch {
        return json({ error: "You're the only owner of a workspace. Make someone else an owner, or delete it, first.", workspace: w.name }, 400);
      }
    }
    await who.stub.deleteAccount();
    return json({ ok: true }, 200, { "set-cookie": setCookie(url, SESSION_COOKIE, "", 0) });
  }
  if (parts[2] === "events" && parts.length === 3 && req.method === "POST") {
    // Add an event you host (proved by its host key) to your account.
    const code = normCode(body.code);
    const key = String(body.key ?? "");
    const room = env.EVENTS.getByName(code);
    if (!code || !(await room.isHost(key))) return json({ error: "That isn't a host link for this event" }, 403);
    const info = await room.info();
    if (!(await who.stub.addEvent({ code, title: info?.title ?? code, hostKey: key }))) return json({ error: "Your account has the most events allowed" }, 400);
    return json({ ok: true });
  }
  if (parts[2] === "analytics" && req.method === "GET") {
    const list = (await who.stub.events()).slice(0, 200);
    return json({ events: await statsFor(env, list) });
  }
  if (parts[2] === "events" && parts[3] && req.method === "DELETE") {
    await who.stub.removeEvent(normCode(parts[3]));
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}

/** Back to the sign-in page with a message (for browser redirects). */
function back(url: URL, message: string, ...cookies: string[]) {
  const headers = new Headers({ location: `/signin?error=${encodeURIComponent(message)}`, "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}
