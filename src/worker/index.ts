import { EventRoom, type Env } from "./room";
import { clean, newCode, newId, normCode } from "./logic";
import { LIMITS, type EventTemplate } from "../shared/protocol";
import { templateById } from "../shared/templates";
import { apiJson, apiKeyFrom, apiPreflight, apiRaw } from "./api";
import { HostAccount, SESSION_DAYS } from "./accounts";
import { accountId, isEmail, normEmail } from "./identity";
import { devMode, mailReady, sendSignIn } from "./mail";

export { EventRoom, HostAccount };

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api", "events", CODE, action, ...]

    if (parts[0] !== "api") return env.ASSETS.fetch(request);

    // Public read-only API: /api/v1/events/CODE[/questions|/polls[/ID]|/leaderboard|/participants]
    if (parts[1] === "v1") {
      if (request.method === "OPTIONS") return apiPreflight();
      if (request.method !== "GET") return apiJson({ error: "The API is read-only. Use GET." }, 405);
      if (parts[2] !== "events" || !parts[3]) return apiJson({ error: "Not found. See docs/API.md." }, 404);
      const code = normCode(parts[3]);
      if (code.length < 4 || code.length > 10) return apiJson({ error: "Bad code" }, 400);
      const query = Object.fromEntries(url.searchParams);
      delete query.key;
      const r = await env.EVENTS.getByName(code).apiRead(apiKeyFrom(request), parts.slice(4), query);
      return apiRaw(r.json, r.status);
    }
    if (parts[1] === "auth" || parts[1] === "me") return accountRoutes(request, env, url, parts);
    if (parts[1] !== "events") return json({ error: "Not found" }, 404);

    // POST /api/events → create a new event
    if (parts.length === 2) {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      const body = (await request.json().catch(() => ({}))) as { title?: string; template?: string; from?: { code?: string; key?: string } };
      // Start from a built-in template, or copy one of your own events.
      let template: EventTemplate | null = null;
      let media: string[] = [];
      let fromCode = "";
      if (body.from) {
        fromCode = normCode(body.from.code);
        const copied = fromCode ? await env.EVENTS.getByName(fromCode).exportTemplate(String(body.from.key ?? "")) : null;
        if (!copied) return json({ error: "Couldn't copy that event. Check the host link." }, 403);
        template = copied.template as EventTemplate;
        media = copied.media;
      } else if (body.template) {
        template = templateById(body.template) ?? null;
        if (!template) return json({ error: "Unknown template" }, 400);
      }
      const title = clean(body.title, LIMITS.title) || (body.from && template?.title ? `${template.title} (copy)`.slice(0, LIMITS.title) : "Untitled session");
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const room = env.EVENTS.getByName(code);
        const res = await room.create(code, title);
        if (!res.ok) continue;
        // Signed-in hosts get the new event added to their account.
        const who = await session(request, env);
        if (who) await who.stub.addEvent({ code, title, hostKey: res.hostKey! });
        if (template) {
          if (media.length && env.MEDIA) await copyMedia(env.MEDIA, fromCode, code, media);
          await room.applyTemplate(template);
        }
        return json(res, 201);
      }
      return json({ error: "Could not create event, try again" }, 500);
    }

    const code = normCode(parts[2]);
    if (code.length < 4 || code.length > 10) return json({ error: "Bad code" }, 400);
    const room = env.EVENTS.getByName(code);
    const action = parts[3] ?? "";
    const key = url.searchParams.get("key") ?? "";

    if (action === "" && request.method === "GET") {
      const info = await room.info();
      return info ? json(info) : json({ error: "Event not found" }, 404);
    }

    if (action === "ws") return room.fetch(request);

    if (action === "recap" && request.method === "GET") {
      const recap = await room.recap();
      return recap ? json(recap) : json({ error: "This recap isn't shared" }, 404);
    }

    // Optional AI helpers. Both need the host key and Workers AI set up.
    if (action === "ai" && request.method === "POST") {
      const what = parts[4];
      if (what === "polls") {
        const body = (await request.json().catch(() => ({}))) as { text?: string };
        const r = await room.aiPolls(key, String(body.text ?? ""));
        return "error" in r ? json(r, r.error === "Forbidden" ? 403 : 400) : json(r);
      }
      if (what === "summary") {
        const r = await room.aiSummary(key);
        return "error" in r ? json(r, r.error === "Forbidden" ? 403 : 400) : json(r);
      }
      return json({ error: "Not found" }, 404);
    }

    if (action === "analytics") {
      const data = await room.analytics(key);
      return data ? json(data) : json({ error: "Forbidden" }, 403);
    }

    if (action === "export") {
      const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
      if (format === "xlsx") {
        const file = await room.exportXlsx(key);
        if (!file) return json({ error: "Forbidden" }, 403);
        return new Response(file, {
          headers: {
            "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": `attachment; filename="rslide-${code}.xlsx"`,
          },
        });
      }
      const csv = await room.exportCsv(key);
      if (csv === null) return json({ error: "Forbidden" }, 403);
      return new Response(csv, {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="rslide-${code}.csv"` },
      });
    }

    // Images for poll options. Uploads need the host key; anyone in the event can view them.
    if (action === "media") {
      if (!env.MEDIA) return json({ error: "Image uploads aren't set up on this server" }, 501);
      if (request.method === "POST" && parts.length === 4) {
        if (!(await room.isHost(key))) return json({ error: "Forbidden" }, 403);
        const type = (request.headers.get("content-type") ?? "").split(";")[0].trim();
        if (!IMAGE_TYPES.has(type)) return json({ error: "Use a PNG, JPG, WebP or GIF image" }, 415);
        const size = Number(request.headers.get("content-length") ?? 0);
        if (size > LIMITS.imageBytes) return json({ error: "Images must be under 2 MB" }, 413);
        const body = await request.arrayBuffer();
        if (body.byteLength > LIMITS.imageBytes) return json({ error: "Images must be under 2 MB" }, 413);
        const id = newId();
        await env.MEDIA.put(`events/${code}/${id}`, body, { httpMetadata: { contentType: type } });
        return json({ id }, 201);
      }
      const id = parts[4] ?? "";
      if (request.method === "GET" && /^[a-z0-9]{12}$/.test(id)) {
        const obj = await env.MEDIA.get(`events/${code}/${id}`);
        if (!obj) return json({ error: "Not found" }, 404);
        return new Response(obj.body, {
          headers: {
            "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
            "cache-control": "public, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
          },
        });
      }
      return json({ error: "Not found" }, 404);
    }

    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;

/** Images belong to an event, so copying an event copies its images too. */
async function copyMedia(bucket: R2Bucket, from: string, to: string, ids: string[]) {
  await Promise.all(
    ids.slice(0, 200).map(async (id) => {
      const obj = await bucket.get(`events/${from}/${id}`);
      if (obj) await bucket.put(`events/${to}/${id}`, obj.body, { httpMetadata: obj.httpMetadata });
    }),
  );
}

// ---------- host accounts ----------

const COOKIE = "rs_session";

function cookie(req: Request, name: string): string {
  const m = (req.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : "";
}

function sessionCookie(url: URL, value: string, maxAge: number) {
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${url.protocol === "https:" ? "; Secure" : ""}`;
}

/** The signed-in host for this request, if any. */
async function session(req: Request, env: Env) {
  if (!env.ACCOUNTS || !(mailReady(env) || devMode(env, new URL(req.url).hostname))) return null;
  const [acct, token] = cookie(req, COOKIE).split(".");
  if (!acct || !token || !/^[0-9a-f]{32}$/.test(acct)) return null;
  const stub = env.ACCOUNTS.getByName(acct);
  const email = await stub.checkSession(token);
  return email ? { acct, token, stub, email } : null;
}

async function accountRoutes(req: Request, env: Env, url: URL, parts: string[]): Promise<Response> {
  const on = !!env.ACCOUNTS && (mailReady(env) || devMode(env, url.hostname));
  if (parts[1] === "auth" && parts[2] === "config") return json({ accounts: on });
  if (!on) return json({ error: "Host accounts aren't set up on this server" }, 501);
  // Changes need a same-site JSON request, so other websites can't act for a signed-in host.
  if (req.method !== "GET") {
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin) return json({ error: "Forbidden" }, 403);
    if (req.method === "POST" && !(req.headers.get("content-type") ?? "").includes("application/json")) return json({ error: "Send JSON" }, 415);
  }
  const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};

  if (parts[1] === "auth") {
    const what = parts[2];
    if (what === "start" && req.method === "POST") {
      const email = normEmail(body.email);
      if (!isEmail(email)) return json({ error: "Enter a valid email address" }, 400);
      const acct = await accountId(email);
      const token = await env.ACCOUNTS!.getByName(acct).startSignIn(email);
      if (!token) return json({ error: "Too many sign-in links. Wait a few minutes and try again." }, 429);
      const link = `${url.origin}/signin?a=${acct}&t=${token}`;
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
      return json({ email: r.email }, 200, { "set-cookie": sessionCookie(url, `${acct}.${r.session}`, SESSION_DAYS * 86_400) });
    }
    if (what === "signout" && req.method === "POST") {
      const who = await session(req, env);
      if (who) await who.stub.signOut(who.token, body.everywhere === true);
      return json({ ok: true }, 200, { "set-cookie": sessionCookie(url, "", 0) });
    }
    return json({ error: "Not found" }, 404);
  }

  // /api/me…
  const who = await session(req, env);
  if (!who) return json({ error: "Sign in first" }, 401);
  if (parts.length === 2 && req.method === "GET") return json({ email: who.email, events: await who.stub.events() });
  if (parts.length === 2 && req.method === "DELETE") {
    await who.stub.deleteAccount();
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(url, "", 0) });
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
  if (parts[2] === "events" && parts[3] && req.method === "DELETE") {
    await who.stub.removeEvent(normCode(parts[3]));
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}

