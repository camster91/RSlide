import { EventRoom, type Env } from "./room";
import { newCode, normCode, clean } from "./logic";
import { LIMITS } from "../shared/protocol";

export { EventRoom };

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api", "events", CODE, action]

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

    if (action === "" && request.method === "GET") {
      const info = await room.info();
      return info ? json(info) : json({ error: "Event not found" }, 404);
    }
    if (action === "ws") return room.fetch(request);
    if (action === "export") {
      const csv = await room.exportCsv(url.searchParams.get("key") ?? "");
      if (csv === null) return json({ error: "Forbidden" }, 403);
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="rslide-${code}.csv"`,
        },
      });
    }
    return json({ error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
