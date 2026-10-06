import { DurableObject } from "cloudflare:workers";

// ---------- helpers ----------
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I confusion
const randomString = (len, chars = CODE_CHARS) => {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
};
const newId = () => randomString(10, "abcdefghijklmnopqrstuvwxyz0123456789");
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const clean = (s, max) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const LIMITS = { title: 120, question: 300, name: 40, option: 120, options: 10, answer: 200, word: 30 };
const POLL_TYPES = ["multiple", "wordcloud", "rating", "open", "quiz"];

// ---------- Worker entry ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ["api","events",CODE,...]

    if (parts[0] !== "api") return env.ASSETS.fetch(request);

    // POST /api/events  -> create a new event
    if (parts[1] === "events" && parts.length === 2 && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const title = clean(body.title, LIMITS.title) || "Untitled session";
      for (let i = 0; i < 5; i++) {
        const code = randomString(6);
        const stub = env.EVENTS.get(env.EVENTS.idFromName(code));
        const res = await stub.create(code, title);
        if (res.ok) return json(res, 201);
      }
      return json({ error: "Could not create event, try again" }, 500);
    }

    // /api/events/:code/...
    if (parts[1] === "events" && parts[2]) {
      const code = normCode(parts[2]);
      if (code.length < 4 || code.length > 10) return json({ error: "Bad code" }, 400);
      const stub = env.EVENTS.get(env.EVENTS.idFromName(code));
      return stub.fetch(request);
    }

    return json({ error: "Not found" }, 404);
  },
};

// ---------- One Durable Object per event ----------
export class EventRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.state = null;
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get("state")) || null;
    });
  }

  async save() {
    await this.ctx.storage.put("state", this.state);
  }

  // RPC from the Worker
  async create(code, title) {
    if (this.state) return { ok: false };
    this.state = {
      code,
      title,
      hostKey: randomString(24, "abcdefghijklmnopqrstuvwxyz0123456789"),
      createdAt: Date.now(),
      settings: {
        qaOpen: true,
        moderation: false, // host must approve questions before they show
        allowAnonymous: true,
        requireName: false,
        showVotes: true,
      },
      questions: [],
      polls: [],
      activePollId: null,
      presentMode: "auto", // auto | qa | poll | code
    };
    await this.save();
    return { ok: true, code, hostKey: this.state.hostKey, title };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const action = parts[3] || "";

    if (!this.state) return json({ error: "Event not found" }, 404);

    if (action === "" && request.method === "GET") {
      return json({ code: this.state.code, title: this.state.title });
    }

    if (action === "ws") {
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "Expected websocket" }, 426);
      let role = url.searchParams.get("role") || "attendee";
      const key = url.searchParams.get("key") || "";
      const pid = clean(url.searchParams.get("pid"), 40) || newId();
      if ((role === "host" || role === "present") && key !== this.state.hostKey) {
        if (role === "host") return json({ error: "Wrong host key" }, 403);
        role = "present"; // present screen is read-only; allow without key
      }
      if (!["attendee", "host", "present"].includes(role)) role = "attendee";
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [role]);
      pair[1].serializeAttachment({ role, pid });
      pair[1].send(JSON.stringify({ type: "state", state: this.view(role, pid), you: pid }));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    if (action === "export") {
      if (url.searchParams.get("key") !== this.state.hostKey) return json({ error: "Forbidden" }, 403);
      return new Response(this.toCsv(), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="rslide-${this.state.code}.csv"`,
        },
      });
    }

    return json({ error: "Not found" }, 404);
  }

  // ---------- WebSocket (hibernation API) ----------
  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const { role, pid } = ws.deserializeAttachment() || {};
    if (msg.type === "ping") return ws.send(JSON.stringify({ type: "pong" }));

    let changed = false;
    let error = null;
    try {
      if (role === "attendee" || role === "host") changed = this.handleAttendee(msg, pid);
      if (!changed && role === "host") changed = this.handleHost(msg);
    } catch (e) {
      error = e.message;
    }
    if (error) return ws.send(JSON.stringify({ type: "error", message: error }));
    if (changed) {
      await this.save();
      this.broadcast();
    }
  }

  async webSocketClose(ws, code) {
    try {
      ws.close(code, "bye");
    } catch {}
    this.broadcastCount();
  }
  async webSocketError() {
    this.broadcastCount();
  }

  // ---------- attendee actions ----------
  handleAttendee(msg, pid) {
    const s = this.state;
    switch (msg.type) {
      case "ask": {
        if (!s.settings.qaOpen) throw new Error("Questions are closed right now");
        const text = clean(msg.text, LIMITS.question);
        if (!text) throw new Error("Question is empty");
        let name = clean(msg.name, LIMITS.name);
        if (!name && s.settings.requireName) throw new Error("Please add your name");
        if (!s.settings.allowAnonymous && !name) throw new Error("Please add your name");
        const mine = s.questions.filter((q) => q.pid === pid && Date.now() - q.ts < 60_000).length;
        if (mine >= 5) throw new Error("Slow down a little — try again in a minute");
        s.questions.push({
          id: newId(),
          text,
          name: name || "",
          pid,
          ts: Date.now(),
          voters: [],
          status: s.settings.moderation ? "pending" : "live",
          highlighted: false,
        });
        return true;
      }
      case "vote": {
        const q = s.questions.find((x) => x.id === msg.id);
        if (!q || q.status === "pending") return false;
        const i = q.voters.indexOf(pid);
        if (i === -1) q.voters.push(pid);
        else q.voters.splice(i, 1);
        return true;
      }
      case "respond": {
        const p = s.polls.find((x) => x.id === msg.pollId);
        if (!p || p.status !== "active") throw new Error("This poll is not open");
        const v = this.validateResponse(p, msg.value);
        p.responses[pid] = v;
        return true;
      }
      default:
        return false;
    }
  }

  validateResponse(p, value) {
    if (p.type === "multiple" || p.type === "quiz") {
      const arr = (Array.isArray(value) ? value : [value]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < p.options.length);
      const uniq = [...new Set(arr)];
      if (!uniq.length) throw new Error("Pick an option");
      if (!p.multi && uniq.length > 1) throw new Error("Pick one option");
      return uniq;
    }
    if (p.type === "rating") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > (p.scale || 5)) throw new Error("Pick a rating");
      return n;
    }
    if (p.type === "wordcloud") {
      const words = (Array.isArray(value) ? value : [value]).map((w) => clean(w, LIMITS.word).toLowerCase()).filter(Boolean).slice(0, 3);
      if (!words.length) throw new Error("Type a word");
      return words;
    }
    if (p.type === "open") {
      const t = clean(value, LIMITS.answer);
      if (!t) throw new Error("Type an answer");
      return t;
    }
    throw new Error("Unknown poll type");
  }

  // ---------- host actions ----------
  handleHost(msg) {
    const s = this.state;
    const q = msg.id ? s.questions.find((x) => x.id === msg.id) : null;
    const p = msg.pollId ? s.polls.find((x) => x.id === msg.pollId) : null;
    switch (msg.type) {
      case "setTitle":
        s.title = clean(msg.title, LIMITS.title) || s.title;
        return true;
      case "setSettings": {
        for (const k of Object.keys(s.settings)) if (typeof msg.settings?.[k] === "boolean") s.settings[k] = msg.settings[k];
        return true;
      }
      case "setPresentMode":
        if (["auto", "qa", "poll", "code"].includes(msg.mode)) s.presentMode = msg.mode;
        return true;
      case "approve":
        if (q) q.status = "live";
        return !!q;
      case "answer":
        if (q) {
          q.status = q.status === "answered" ? "live" : "answered";
          if (q.status === "answered") q.highlighted = false;
        }
        return !!q;
      case "archive":
        if (q) {
          q.status = q.status === "archived" ? "live" : "archived";
          q.highlighted = false;
        }
        return !!q;
      case "highlight":
        if (q) {
          const on = !q.highlighted;
          s.questions.forEach((x) => (x.highlighted = false));
          q.highlighted = on;
          if (on && q.status === "pending") q.status = "live";
        }
        return !!q;
      case "deleteQuestion":
        s.questions = s.questions.filter((x) => x.id !== msg.id);
        return true;
      case "clearQuestions":
        s.questions = [];
        return true;
      case "savePoll": {
        const type = POLL_TYPES.includes(msg.poll?.type) ? msg.poll.type : "multiple";
        const title = clean(msg.poll?.title, LIMITS.question);
        if (!title) throw new Error("Poll needs a question");
        let options = [];
        if (type === "multiple" || type === "quiz") {
          options = (msg.poll.options || []).map((o) => clean(o, LIMITS.option)).filter(Boolean).slice(0, LIMITS.options);
          if (options.length < 2) throw new Error("Add at least 2 options");
        }
        let correct = [];
        if (type === "quiz") {
          correct = (msg.poll.correct || []).map(Number).filter((n) => n >= 0 && n < options.length);
          if (!correct.length) throw new Error("Mark the correct answer");
        }
        const data = { type, title, options, correct, multi: !!msg.poll.multi && type === "multiple", scale: type === "rating" ? 5 : undefined };
        const existing = msg.poll.id && s.polls.find((x) => x.id === msg.poll.id);
        if (existing) {
          const structural = existing.type !== type || JSON.stringify(existing.options) !== JSON.stringify(options);
          Object.assign(existing, data);
          if (structural) existing.responses = {};
        } else {
          s.polls.push({ id: newId(), ...data, status: "draft", responses: {}, showResults: true, revealed: false, ts: Date.now() });
        }
        return true;
      }
      case "activatePoll":
        s.polls.forEach((x) => {
          if (x.status === "active") x.status = "closed";
        });
        if (p) {
          p.status = "active";
          s.activePollId = p.id;
        } else s.activePollId = null;
        return true;
      case "closePoll":
        if (p) p.status = "closed";
        if (s.activePollId === msg.pollId) s.activePollId = null;
        return !!p;
      case "toggleResults":
        if (p) p.showResults = !p.showResults;
        return !!p;
      case "revealAnswer":
        if (p) p.revealed = !p.revealed;
        return !!p;
      case "resetPoll":
        if (p) {
          p.responses = {};
          p.revealed = false;
        }
        return !!p;
      case "deletePoll":
        s.polls = s.polls.filter((x) => x.id !== msg.pollId);
        if (s.activePollId === msg.pollId) s.activePollId = null;
        return true;
      case "movePoll": {
        const i = s.polls.findIndex((x) => x.id === msg.pollId);
        const j = i + (msg.dir === "up" ? -1 : 1);
        if (i < 0 || j < 0 || j >= s.polls.length) return false;
        [s.polls[i], s.polls[j]] = [s.polls[j], s.polls[i]];
        return true;
      }
      default:
        return false;
    }
  }

  // ---------- views ----------
  results(p) {
    const r = Object.values(p.responses);
    const total = r.length;
    if (p.type === "multiple" || p.type === "quiz") {
      const counts = p.options.map(() => 0);
      r.forEach((arr) => arr.forEach((i) => counts[i]++));
      return { total, counts };
    }
    if (p.type === "rating") {
      const counts = Array.from({ length: p.scale || 5 }, () => 0);
      r.forEach((n) => counts[n - 1]++);
      const avg = total ? r.reduce((a, b) => a + b, 0) / total : 0;
      return { total, counts, avg: Math.round(avg * 10) / 10 };
    }
    if (p.type === "wordcloud") {
      const m = {};
      r.forEach((ws) => ws.forEach((w) => (m[w] = (m[w] || 0) + 1)));
      const words = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 60);
      return { total, words };
    }
    if (p.type === "open") {
      return { total, answers: r.slice(-100).reverse() };
    }
    return { total };
  }

  view(role, pid) {
    const s = this.state;
    const isHost = role === "host";
    const questions = s.questions
      .filter((q) => isHost || q.status !== "pending" || q.pid === pid)
      .filter((q) => isHost || q.status !== "archived")
      .map((q) => ({
        id: q.id,
        text: q.text,
        name: q.name,
        ts: q.ts,
        votes: q.voters.length,
        voted: q.voters.includes(pid),
        mine: q.pid === pid,
        status: q.status,
        highlighted: q.highlighted,
      }));
    const pollView = (p) => {
      const showResults = isHost || role === "present" || p.showResults;
      const v = {
        id: p.id,
        type: p.type,
        title: p.title,
        options: p.options,
        multi: p.multi,
        scale: p.scale,
        status: p.status,
        showResults: p.showResults,
        revealed: p.revealed,
        myResponse: p.responses[pid] ?? null,
        results: showResults && (p.status !== "draft" || isHost) ? this.results(p) : { total: Object.keys(p.responses).length },
      };
      if (p.type === "quiz" && (isHost || p.revealed)) v.correct = p.correct;
      return v;
    };
    const polls = isHost
      ? s.polls.map(pollView)
      : s.polls.filter((p) => p.id === s.activePollId).map(pollView);
    return {
      code: s.code,
      title: s.title,
      settings: s.settings,
      presentMode: s.presentMode,
      activePollId: s.activePollId,
      questions,
      polls,
      online: this.ctx.getWebSockets().length,
      ...(isHost ? { hostKey: s.hostKey } : {}),
    };
  }

  broadcast() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        const { role, pid } = ws.deserializeAttachment() || {};
        ws.send(JSON.stringify({ type: "state", state: this.view(role, pid) }));
      } catch {}
    }
  }

  broadcastCount() {
    const online = this.ctx.getWebSockets().length;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify({ type: "online", online }));
      } catch {}
    }
  }

  toCsv() {
    const s = this.state;
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["Section", "Item", "Detail", "Count / Value", "Status", "Time"]];
    for (const q of s.questions)
      rows.push(["Q&A", q.text, q.name || "Anonymous", q.voters.length, q.status, new Date(q.ts).toISOString()]);
    for (const p of s.polls) {
      const r = this.results(p);
      if (p.counts || r.counts) {
        const labels = p.type === "rating" ? r.counts.map((_, i) => `${i + 1} stars`) : p.options;
        labels.forEach((o, i) => rows.push([`Poll (${p.type})`, p.title, o + (p.correct?.includes(i) ? " ✓" : ""), r.counts[i], p.status, ""]));
        if (p.type === "rating") rows.push([`Poll (rating)`, p.title, "Average", r.avg, p.status, ""]);
      } else if (r.words) r.words.forEach(([w, c]) => rows.push(["Poll (word cloud)", p.title, w, c, p.status, ""]));
      else if (p.type === "open") Object.values(p.responses).forEach((a) => rows.push(["Poll (open text)", p.title, a, "", p.status, ""]));
      rows.push([`Poll (${p.type})`, p.title, "Total responses", r.total, p.status, ""]);
    }
    return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  }
}
