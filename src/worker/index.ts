import { EventRoom, type Env } from "./room";
import { clean, newCode, newId, normCode } from "./logic";
import { LIMITS, type EventTemplate } from "../shared/protocol";
import { templateById } from "../shared/templates";

export { EventRoom };

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api", "events", CODE, action, ...]

    if (parts[0] !== "api") return env.ASSETS.fetch(request);
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
