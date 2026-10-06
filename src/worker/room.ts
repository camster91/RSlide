import { DurableObject } from "cloudflare:workers";
import {
  CLOSE,
  DEFAULT_SETTINGS,
  LIMITS,
  PING,
  PONG,
  PRESENT_MODES,
  type ClientMsg,
  type Me,
  type Meta,
  type Op,
  type Poll,
  type PollStatus,
  type PresentMode,
  type Question,
  type QuestionStatus,
  type ResponseValue,
  type Results,
  type Role,
  type ServerMsg,
  type Settings,
} from "../shared/protocol";
import { clean, newHostKey, newId, RateLimiter, tally, toCsv, UserError, validatePoll, validateResponse } from "./logic";

export interface Env {
  EVENTS: DurableObjectNamespace<EventRoom>;
  ASSETS: Fetcher;
  /** Delete events this many hours after creation. Empty = keep forever. */
  EVENT_TTL_HOURS?: string;
  /** Max attendees connected at once per event. 0 or empty = unlimited. */
  MAX_PARTICIPANTS?: string;
}

interface EventRecord {
  code: string;
  title: string;
  hostKey: string;
  createdAt: number;
  expiresAt: number | null;
  settings: Settings;
  presentMode: PresentMode;
  activePollId: string | null;
}

interface Attachment {
  role: Role;
  pid: string;
}

type QuestionRow = {
  id: string;
  text: string;
  name: string;
  pid: string;
  ts: number;
  status: QuestionStatus;
  highlighted: number;
  votes: number;
};

type PollRow = {
  id: string;
  ord: number;
  type: Poll["type"];
  title: string;
  options: string;
  correct: string;
  multi: number;
  scale: number;
  status: PollStatus;
  show_results: number;
  revealed: number;
  ts: number;
};

const FLUSH_MS = 80;
const ONLINE_MS = 2000;
const ROLES: Role[] = ["host", "present", "attendee"];

/**
 * One EventRoom per event code. Holds all questions, votes, polls and responses
 * in its own SQLite database and pushes small patches to every connected screen.
 */
export class EventRoom extends DurableObject<Env> {
  private sql: SqlStorage;
  private ev: EventRecord | null = null;
  private resultsCache = new Map<string, Results>();

  // Batched changes waiting to be sent.
  private dirtyMeta = false;
  private dirtyQ = new Set<string>();
  private deletedQ = new Set<string>();
  private dirtyP = new Set<string>();
  private deletedP = new Set<string>();
  private dirtyR = new Set<string>();
  private dirtyMe = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private onlineTimer: ReturnType<typeof setTimeout> | null = null;

  private votesLimit = new RateLimiter(30, 10_000);
  private asksLimit = new RateLimiter(5, 60_000);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
      await this.importLegacy();
      const row = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'event'").toArray()[0];
      this.ev = row ? (JSON.parse(row.v) as EventRecord) : null;
      if (this.ev) this.ev.settings = { ...DEFAULT_SETTINGS, ...this.ev.settings };
    });
  }

  private migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY, text TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', pid TEXT NOT NULL,
        ts INTEGER NOT NULL, status TEXT NOT NULL, highlighted INTEGER NOT NULL DEFAULT 0, votes INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS questions_pid ON questions(pid);
      CREATE TABLE IF NOT EXISTS votes (qid TEXT NOT NULL, pid TEXT NOT NULL, PRIMARY KEY (qid, pid));
      CREATE INDEX IF NOT EXISTS votes_pid ON votes(pid);
      CREATE TABLE IF NOT EXISTS polls (
        id TEXT PRIMARY KEY, ord INTEGER NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL,
        options TEXT NOT NULL DEFAULT '[]', correct TEXT NOT NULL DEFAULT '[]', multi INTEGER NOT NULL DEFAULT 0,
        scale INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, show_results INTEGER NOT NULL DEFAULT 1,
        revealed INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS responses (
        poll_id TEXT NOT NULL, pid TEXT NOT NULL, value TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (poll_id, pid)
      );
      CREATE INDEX IF NOT EXISTS responses_pid ON responses(pid);
    `);
  }

  /** Moves events saved by the v0.1 prototype (one JSON blob) into the tables. */
  private async importLegacy() {
    const old = await this.ctx.storage.get<any>("state");
    if (!old) return;
    const ev: EventRecord = {
      code: old.code,
      title: old.title,
      hostKey: old.hostKey,
      createdAt: old.createdAt,
      expiresAt: null,
      settings: { ...DEFAULT_SETTINGS, ...old.settings },
      presentMode: old.presentMode ?? "auto",
      activePollId: old.activePollId ?? null,
    };
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('event', ?)", JSON.stringify(ev));
    for (const q of old.questions ?? []) {
      this.sql.exec("INSERT OR IGNORE INTO questions VALUES (?,?,?,?,?,?,?,?)", q.id, q.text, q.name ?? "", q.pid, q.ts, q.status, q.highlighted ? 1 : 0, q.voters.length);
      for (const v of q.voters) this.sql.exec("INSERT OR IGNORE INTO votes VALUES (?,?)", q.id, v);
    }
    (old.polls ?? []).forEach((p: any, i: number) => {
      this.sql.exec(
        "INSERT OR IGNORE INTO polls VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        p.id, i, p.type, p.title, JSON.stringify(p.options ?? []), JSON.stringify(p.correct ?? []), p.multi ? 1 : 0, p.scale ?? 0, p.status, p.showResults ? 1 : 0, p.revealed ? 1 : 0, p.ts ?? Date.now(),
      );
      for (const [pid, v] of Object.entries(p.responses ?? {})) this.sql.exec("INSERT OR IGNORE INTO responses VALUES (?,?,?,?)", p.id, pid, JSON.stringify(v), Date.now());
    });
    await this.ctx.storage.delete("state");
  }

  private saveEvent() {
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('event', ?)", JSON.stringify(this.ev));
    this.dirtyMeta = true;
    this.scheduleFlush();
  }

  // ---------- RPC from the Worker ----------

  async create(code: string, title: string): Promise<{ ok: boolean; code?: string; hostKey?: string; title?: string }> {
    if (this.ev) return { ok: false };
    const ttl = Number(this.env.EVENT_TTL_HOURS || 0);
    const now = Date.now();
    this.ev = {
      code,
      title,
      hostKey: newHostKey(),
      createdAt: now,
      expiresAt: ttl > 0 ? now + ttl * 3_600_000 : null,
      settings: { ...DEFAULT_SETTINGS },
      presentMode: "auto",
      activePollId: null,
    };
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('event', ?)", JSON.stringify(this.ev));
    if (this.ev.expiresAt) await this.ctx.storage.setAlarm(this.ev.expiresAt);
    return { ok: true, code, hostKey: this.ev.hostKey, title };
  }

  async info(): Promise<{ code: string; title: string } | null> {
    return this.ev ? { code: this.ev.code, title: this.ev.title } : null;
  }

  async exportCsv(key: string): Promise<string | null> {
    if (!this.ev || key !== this.ev.hostKey) return null;
    const rows: (string | number)[][] = [["Section", "Item", "Detail", "Count / Value", "Status", "Time"]];
    for (const q of this.sql.exec<QuestionRow>("SELECT * FROM questions ORDER BY ts").toArray())
      rows.push(["Q&A", q.text, q.name || "Anonymous", q.votes, q.status, new Date(q.ts).toISOString()]);
    for (const p of this.allPolls()) {
      const r = this.results(p.id, true);
      const kind = `Poll (${p.type})`;
      if (r.counts) {
        const labels = p.type === "rating" ? r.counts.map((_, i) => `${i + 1} stars`) : p.options;
        labels.forEach((o, i) => rows.push([kind, p.title, o + (p.correct?.includes(i) ? " ✓" : ""), r.counts![i], p.status, ""]));
        if (p.type === "rating") rows.push([kind, p.title, "Average", r.avg ?? 0, p.status, ""]);
      } else if (r.words) r.words.forEach(([w, c]) => rows.push([kind, p.title, w, c, p.status, ""]));
      else if (p.type === "open")
        for (const a of this.sql.exec<{ value: string }>("SELECT value FROM responses WHERE poll_id = ? ORDER BY ts", p.id))
          rows.push([kind, p.title, JSON.parse(a.value), "", p.status, ""]);
      rows.push([kind, p.title, "Total responses", r.total, p.status, ""]);
    }
    return toCsv(rows);
  }

  async alarm() {
    if (this.ev?.expiresAt && Date.now() >= this.ev.expiresAt) {
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(CLOSE.NOT_FOUND, "Event expired");
        } catch {}
      }
      this.ev = null;
      await this.ctx.storage.deleteAll();
    }
  }

  // ---------- WebSocket connect ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
    const url = new URL(request.url);
    const pid = clean(url.searchParams.get("pid"), 40).replace(/[^a-zA-Z0-9_-]/g, "") || newId();
    const key = url.searchParams.get("key") ?? "";
    let role = (url.searchParams.get("role") ?? "attendee") as Role;
    if (!ROLES.includes(role)) role = "attendee";

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    const reject = (code: number, reason: string) => {
      server.accept();
      server.close(code, reason);
      return new Response(null, { status: 101, webSocket: client });
    };
    if (!this.ev) return reject(CLOSE.NOT_FOUND, "Event not found");
    if (role === "host" && key !== this.ev.hostKey) return reject(CLOSE.FORBIDDEN, "Wrong host link");
    // The big screen is read-only. Without the key it sees what attendees see.
    if (role === "present" && key !== this.ev.hostKey) role = "attendee";
    const max = Number(this.env.MAX_PARTICIPANTS || 0);
    if (role === "attendee" && max > 0 && this.ctx.getWebSockets("attendee").length >= max)
      return reject(CLOSE.FULL, "This event is full");

    this.ctx.acceptWebSocket(server, [role, `pid:${pid}`]);
    server.serializeAttachment({ role, pid } satisfies Attachment);
    this.send(server, {
      type: "hello",
      role,
      snapshot: this.snapshot(role, pid),
      me: this.me(pid),
      ...(role === "host" ? { hostKey: this.ev.hostKey } : {}),
    });
    this.scheduleOnline();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (!this.ev || typeof raw !== "string" || raw.length > 4000) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const { role, pid } = ws.deserializeAttachment() as Attachment;
    try {
      if (role === "attendee" || role === "host") {
        if (this.handleAudience(msg, pid, role)) return;
      }
      if (role === "host") this.handleHost(msg);
    } catch (e) {
      if (e instanceof UserError) this.send(ws, { type: "error", message: e.message });
      else throw e;
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code, "bye");
    } catch {}
    this.scheduleOnline();
  }

  async webSocketError() {
    this.scheduleOnline();
  }

  // ---------- audience actions ----------

  /** Returns true if the message was an audience action (handled). */
  private handleAudience(msg: ClientMsg, pid: string, role: Role): boolean {
    const ev = this.ev!;
    switch (msg.type) {
      case "ask": {
        if (!ev.settings.qaOpen) throw new UserError("Questions are closed right now");
        const text = clean(msg.text, LIMITS.question);
        if (!text) throw new UserError("Question is empty");
        const name = clean(msg.name, LIMITS.name);
        if (!name && (ev.settings.requireName || !ev.settings.allowAnonymous)) throw new UserError("Please add your name");
        if (role !== "host" && !this.asksLimit.take(pid)) throw new UserError("Slow down a little — try again in a minute");
        const id = newId();
        const status: QuestionStatus = ev.settings.moderation && role !== "host" ? "pending" : "live";
        this.sql.exec("INSERT INTO questions (id, text, name, pid, ts, status) VALUES (?,?,?,?,?,?)", id, text, name, pid, Date.now(), status);
        this.touchQ(id);
        this.touchMe(pid);
        return true;
      }
      case "vote": {
        if (!this.votesLimit.take(pid)) throw new UserError("Too many clicks — slow down a little");
        const q = this.sql.exec<{ status: string }>("SELECT status FROM questions WHERE id = ?", String(msg.id)).toArray()[0];
        if (!q || q.status === "pending" || q.status === "archived") return true;
        const removed = this.sql.exec("DELETE FROM votes WHERE qid = ? AND pid = ?", msg.id, pid).rowsWritten;
        if (!removed) this.sql.exec("INSERT INTO votes (qid, pid) VALUES (?, ?)", msg.id, pid);
        this.sql.exec("UPDATE questions SET votes = votes + ? WHERE id = ?", removed ? -1 : 1, msg.id);
        this.touchQ(msg.id);
        this.touchMe(pid);
        return true;
      }
      case "respond": {
        if (!this.votesLimit.take(pid)) throw new UserError("Too many clicks — slow down a little");
        const p = this.pollRow(String(msg.pollId));
        if (!p || p.status !== "active") throw new UserError("This poll is not open");
        const value = validateResponse(p, msg.value);
        this.sql.exec(
          "INSERT INTO responses (poll_id, pid, value, ts) VALUES (?,?,?,?) ON CONFLICT(poll_id, pid) DO UPDATE SET value = excluded.value, ts = excluded.ts",
          p.id, pid, JSON.stringify(value), Date.now(),
        );
        this.touchR(p.id);
        this.touchMe(pid);
        return true;
      }
      default:
        return false;
    }
  }

  // ---------- host actions ----------

  private handleHost(msg: ClientMsg) {
    const ev = this.ev!;
    switch (msg.type) {
      case "setTitle":
        ev.title = clean(msg.title, LIMITS.title) || ev.title;
        return this.saveEvent();
      case "setSettings":
        for (const k of Object.keys(ev.settings) as (keyof Settings)[])
          if (typeof msg.settings?.[k] === "boolean") ev.settings[k] = msg.settings[k]!;
        return this.saveEvent();
      case "setPresentMode":
        if (PRESENT_MODES.includes(msg.mode)) ev.presentMode = msg.mode;
        return this.saveEvent();

      case "approve":
        this.sql.exec("UPDATE questions SET status = 'live' WHERE id = ? AND status = 'pending'", msg.id);
        return this.touchQ(msg.id);
      case "answer":
        this.sql.exec(
          "UPDATE questions SET status = CASE status WHEN 'answered' THEN 'live' ELSE 'answered' END, highlighted = 0 WHERE id = ? AND status IN ('live','answered')",
          msg.id,
        );
        return this.touchQ(msg.id);
      case "archive":
        this.sql.exec("UPDATE questions SET status = CASE status WHEN 'archived' THEN 'live' ELSE 'archived' END, highlighted = 0 WHERE id = ?", msg.id);
        return this.touchQ(msg.id);
      case "highlight": {
        const cur = this.sql.exec<{ highlighted: number }>("SELECT highlighted FROM questions WHERE id = ?", msg.id).toArray()[0];
        if (!cur) return;
        for (const r of this.sql.exec<{ id: string }>("UPDATE questions SET highlighted = 0 WHERE highlighted = 1 RETURNING id")) this.touchQ(r.id);
        if (!cur.highlighted)
          this.sql.exec("UPDATE questions SET highlighted = 1, status = CASE status WHEN 'pending' THEN 'live' ELSE status END WHERE id = ?", msg.id);
        return this.touchQ(msg.id);
      }
      case "deleteQuestion":
        this.sql.exec("DELETE FROM votes WHERE qid = ?", msg.id);
        this.sql.exec("DELETE FROM questions WHERE id = ?", msg.id);
        this.deletedQ.add(msg.id);
        this.dirtyQ.delete(msg.id);
        return this.scheduleFlush();
      case "clearQuestions":
        for (const r of this.sql.exec<{ id: string }>("DELETE FROM questions RETURNING id")) {
          this.deletedQ.add(r.id);
          this.dirtyQ.delete(r.id);
        }
        this.sql.exec("DELETE FROM votes");
        return this.scheduleFlush();

      case "savePoll": {
        const d = validatePoll(msg.poll);
        const existing = msg.poll.id ? this.pollRow(msg.poll.id) : null;
        if (existing) {
          const structural = existing.type !== d.type || JSON.stringify(existing.options) !== JSON.stringify(d.options);
          this.sql.exec(
            "UPDATE polls SET type=?, title=?, options=?, correct=?, multi=?, scale=? WHERE id=?",
            d.type, d.title, JSON.stringify(d.options), JSON.stringify(d.correct), d.multi ? 1 : 0, d.scale, existing.id,
          );
          if (structural) this.sql.exec("DELETE FROM responses WHERE poll_id = ?", existing.id);
          this.touchP(existing.id);
          this.touchR(existing.id);
        } else {
          const id = newId();
          const ord = (this.sql.exec<{ m: number | null }>("SELECT MAX(ord) AS m FROM polls").one().m ?? -1) + 1;
          this.sql.exec(
            "INSERT INTO polls (id, ord, type, title, options, correct, multi, scale, status, show_results, revealed, ts) VALUES (?,?,?,?,?,?,?,?, 'draft', 1, 0, ?)",
            id, ord, d.type, d.title, JSON.stringify(d.options), JSON.stringify(d.correct), d.multi ? 1 : 0, d.scale, Date.now(),
          );
          this.touchP(id);
        }
        return;
      }
      case "activatePoll": {
        for (const r of this.sql.exec<{ id: string }>("UPDATE polls SET status = 'closed' WHERE status = 'active' RETURNING id")) this.touchP(r.id);
        const p = msg.pollId ? this.pollRow(msg.pollId) : null;
        if (p) {
          this.sql.exec("UPDATE polls SET status = 'active' WHERE id = ?", p.id);
          this.touchP(p.id);
          this.touchR(p.id);
        }
        ev.activePollId = p?.id ?? null;
        return this.saveEvent();
      }
      case "closePoll":
        this.sql.exec("UPDATE polls SET status = 'closed' WHERE id = ?", msg.pollId);
        this.touchP(msg.pollId);
        if (ev.activePollId === msg.pollId) {
          ev.activePollId = null;
          this.saveEvent();
        }
        return;
      case "toggleResults":
        this.sql.exec("UPDATE polls SET show_results = 1 - show_results WHERE id = ?", msg.pollId);
        this.touchP(msg.pollId);
        return this.touchR(msg.pollId);
      case "revealAnswer":
        this.sql.exec("UPDATE polls SET revealed = 1 - revealed WHERE id = ?", msg.pollId);
        return this.touchP(msg.pollId);
      case "resetPoll":
        for (const r of this.sql.exec<{ pid: string }>("DELETE FROM responses WHERE poll_id = ? RETURNING pid", msg.pollId)) this.touchMe(r.pid);
        this.sql.exec("UPDATE polls SET revealed = 0 WHERE id = ?", msg.pollId);
        this.touchP(msg.pollId);
        return this.touchR(msg.pollId);
      case "deletePoll":
        this.sql.exec("DELETE FROM responses WHERE poll_id = ?", msg.pollId);
        this.sql.exec("DELETE FROM polls WHERE id = ?", msg.pollId);
        this.resultsCache.delete(msg.pollId);
        this.deletedP.add(msg.pollId);
        this.dirtyP.delete(msg.pollId);
        this.dirtyR.delete(msg.pollId);
        if (ev.activePollId === msg.pollId) {
          ev.activePollId = null;
          this.saveEvent();
        }
        return this.scheduleFlush();
      case "movePoll": {
        const list = this.sql.exec<{ id: string; ord: number }>("SELECT id, ord FROM polls ORDER BY ord").toArray();
        const i = list.findIndex((x) => x.id === msg.pollId);
        const j = i + (msg.dir === "up" ? -1 : 1);
        if (i < 0 || j < 0 || j >= list.length) return;
        this.sql.exec("UPDATE polls SET ord = ? WHERE id = ?", list[j].ord, list[i].id);
        this.sql.exec("UPDATE polls SET ord = ? WHERE id = ?", list[i].ord, list[j].id);
        this.touchP(list[i].id);
        return this.touchP(list[j].id);
      }
    }
  }

  // ---------- reading data ----------

  private pollRow(id: string): Poll | null {
    const r = this.sql.exec<PollRow>("SELECT * FROM polls WHERE id = ?", id).toArray()[0];
    return r ? this.toPoll(r) : null;
  }

  private allPolls(): Poll[] {
    return this.sql.exec<PollRow>("SELECT * FROM polls ORDER BY ord").toArray().map((r) => this.toPoll(r));
  }

  private toPoll(r: PollRow): Poll {
    return {
      id: r.id,
      ord: r.ord,
      type: r.type,
      title: r.title,
      options: JSON.parse(r.options),
      correct: JSON.parse(r.correct),
      multi: !!r.multi,
      scale: r.scale,
      status: r.status,
      showResults: !!r.show_results,
      revealed: !!r.revealed,
    };
  }

  private toQuestion(r: QuestionRow): Question {
    return { id: r.id, text: r.text, name: r.name, ts: r.ts, votes: r.votes, status: r.status, highlighted: !!r.highlighted };
  }

  /** Full tally for a poll (cached until a response changes). */
  private results(pollId: string, full: boolean): Results {
    let r = this.resultsCache.get(pollId);
    if (!r) {
      const p = this.pollRow(pollId);
      if (!p) return { total: 0 };
      const values = this.sql.exec<{ value: string }>("SELECT value FROM responses WHERE poll_id = ?", pollId).toArray().map((x) => JSON.parse(x.value) as ResponseValue);
      r = tally(p, values);
      this.resultsCache.set(pollId, r);
    }
    return full ? r : { total: r.total, hidden: true };
  }

  private me(pid: string): Me {
    const responses: Record<string, ResponseValue> = {};
    for (const r of this.sql.exec<{ poll_id: string; value: string }>("SELECT poll_id, value FROM responses WHERE pid = ?", pid)) responses[r.poll_id] = JSON.parse(r.value);
    return {
      pid,
      votes: this.sql.exec<{ qid: string }>("SELECT qid FROM votes WHERE pid = ?", pid).toArray().map((r) => r.qid),
      questions: this.sql.exec<{ id: string }>("SELECT id FROM questions WHERE pid = ?", pid).toArray().map((r) => r.id),
      responses,
    };
  }

  private metaView(): Meta {
    const ev = this.ev!;
    return { code: ev.code, title: ev.title, settings: { ...ev.settings }, presentMode: ev.presentMode, activePollId: ev.activePollId };
  }

  // ---------- who sees what ----------

  private questionVisible(q: { status: QuestionStatus; pid?: string }, role: Role, pid?: string): boolean {
    if (role === "host") return true;
    if (q.status === "archived") return false;
    if (q.status === "pending") return !!pid && q.pid === pid;
    return true;
  }

  private pollVisible(p: Poll, role: Role): boolean {
    return role === "host" || p.status === "active";
  }

  private pollView(p: Poll, role: Role): Poll {
    const v = { ...p };
    if (role !== "host" && !p.revealed) delete v.correct;
    return v;
  }

  private resultsView(p: Poll, role: Role): Results {
    if (role === "attendee" && !p.showResults) return this.results(p.id, false);
    return this.results(p.id, true);
  }

  private snapshot(role: Role, pid: string): {
    meta: Meta;
    questions: Question[];
    polls: Poll[];
    results: Record<string, Results>;
    online: number;
  } {
    const questions = this.sql
      .exec<QuestionRow>("SELECT * FROM questions ORDER BY ts")
      .toArray()
      .filter((q) => this.questionVisible(q, role, pid))
      .map((q) => this.toQuestion(q));
    const polls = this.allPolls().filter((p) => this.pollVisible(p, role));
    const results: Record<string, Results> = {};
    for (const p of polls) if (p.status !== "draft") results[p.id] = this.resultsView(p, role);
    return { meta: this.metaView(), questions, polls: polls.map((p) => this.pollView(p, role)), results, online: this.onlineCount() };
  }

  // ---------- batching and sending ----------

  private touchQ(id: string) {
    this.dirtyQ.add(id);
    this.scheduleFlush();
  }
  private touchP(id: string) {
    this.dirtyP.add(id);
    this.scheduleFlush();
  }
  private touchR(id: string) {
    this.resultsCache.delete(id);
    this.dirtyR.add(id);
    this.scheduleFlush();
  }
  private touchMe(pid: string) {
    this.dirtyMe.add(pid);
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, FLUSH_MS);
  }

  /** Sends every change since the last flush, as one small message per role. */
  flush() {
    if (!this.ev) return;
    const qRows: QuestionRow[] = [];
    const ids = [...this.dirtyQ];
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      qRows.push(...this.sql.exec<QuestionRow>(`SELECT * FROM questions WHERE id IN (${chunk.map(() => "?").join(",")})`, ...chunk).toArray());
    }
    // A question that was touched but no longer exists counts as deleted.
    const found = new Set(qRows.map((q) => q.id));
    for (const id of this.dirtyQ) if (!found.has(id)) this.deletedQ.add(id);

    const polls = [...new Set([...this.dirtyP, ...this.dirtyR])].map((id) => this.pollRow(id)).filter((p): p is Poll => !!p);
    for (const id of this.dirtyP) if (!polls.find((p) => p.id === id)) this.deletedP.add(id);

    const base = (role: Role): Op[] => {
      const ops: Op[] = [];
      if (this.dirtyMeta) ops.push({ k: "meta", d: this.metaView() });
      for (const q of qRows) ops.push(this.questionVisible(q, role) ? { k: "q", d: this.toQuestion(q) } : { k: "q-", id: q.id });
      for (const id of this.deletedQ) ops.push({ k: "q-", id });
      for (const p of polls) {
        const visible = this.pollVisible(p, role);
        if (this.dirtyP.has(p.id)) ops.push(visible ? { k: "p", d: this.pollView(p, role) } : { k: "p-", id: p.id });
        if (visible && p.status !== "draft" && this.dirtyR.has(p.id)) ops.push({ k: "r", id: p.id, d: this.resultsView(p, role) });
      }
      for (const id of this.deletedP) ops.push({ k: "p-", id });
      return ops;
    };

    const encoded = new Map<Role, string | null>();
    for (const role of ROLES) {
      const ops = base(role);
      encoded.set(role, ops.length ? JSON.stringify({ type: "patch", ops } satisfies ServerMsg) : null);
    }
    // Authors see their own questions while they wait for approval.
    const pendingByAuthor = new Map<string, Question[]>();
    for (const q of qRows) if (q.status === "pending") pendingByAuthor.set(q.pid, [...(pendingByAuthor.get(q.pid) ?? []), this.toQuestion(q)]);

    for (const role of ROLES) {
      const msg = encoded.get(role);
      if (!msg) continue;
      for (const ws of this.ctx.getWebSockets(role)) this.sendRaw(ws, msg);
    }
    for (const [pid, qs] of pendingByAuthor) {
      const msg = JSON.stringify({ type: "patch", ops: qs.map((d) => ({ k: "q", d })) } satisfies ServerMsg);
      for (const ws of this.ctx.getWebSockets(`pid:${pid}`)) {
        if ((ws.deserializeAttachment() as Attachment).role !== "host") this.sendRaw(ws, msg);
      }
    }
    for (const pid of this.dirtyMe) {
      const sockets = this.ctx.getWebSockets(`pid:${pid}`);
      if (!sockets.length) continue;
      const msg = JSON.stringify({ type: "me", me: this.me(pid) } satisfies ServerMsg);
      for (const ws of sockets) this.sendRaw(ws, msg);
    }

    this.dirtyMeta = false;
    this.dirtyQ.clear();
    this.deletedQ.clear();
    this.dirtyP.clear();
    this.deletedP.clear();
    this.dirtyR.clear();
    this.dirtyMe.clear();
  }

  private onlineCount() {
    return this.ctx.getWebSockets("attendee").length;
  }

  /** Online count changes are sent at most every 2 seconds, so 2,000 people joining isn't 2,000 broadcasts. */
  private scheduleOnline() {
    if (this.onlineTimer) return;
    this.onlineTimer = setTimeout(() => {
      this.onlineTimer = null;
      const msg = JSON.stringify({ type: "online", n: this.onlineCount() } satisfies ServerMsg);
      for (const ws of this.ctx.getWebSockets("host")) this.sendRaw(ws, msg);
      for (const ws of this.ctx.getWebSockets("present")) this.sendRaw(ws, msg);
    }, ONLINE_MS);
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    this.sendRaw(ws, JSON.stringify(msg));
  }

  private sendRaw(ws: WebSocket, data: string) {
    try {
      ws.send(data);
    } catch {}
  }
}
