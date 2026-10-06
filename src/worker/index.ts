import { EventRoom, type Env } from "./room";
import { clean, newCode, newId, normCode } from "./logic";
import { LIMITS } from "../shared/protocol";

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
      const body = (await request.json().catch(() => ({}))) as { title?: string };
      const title = clean(body.title, LIMITS.title) || "Untitled session";
      for (let i = 0; i < 5; i++) {
        const code = newCode();
        const res = await env.EVENTS.getByName(code).create(code, title);
        if (res.ok) return json(res, 201);
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
