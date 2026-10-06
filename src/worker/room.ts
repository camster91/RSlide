import { DurableObject } from "cloudflare:workers";
import {
  CLOSE,
  DEFAULT_SETTINGS,
  LIMITS,
  PING,
  PONG,
  PRESENT_MODES,
  REACTIONS,
  THEMES,
  type ClientMsg,
  type EventInfo,
  type Identity,
  type Item,
  type Leaderboard,
  type Me,
  type Meta,
  type Op,
  type Poll,
  type PollStatus,
  type PresentMode,
  type Question,
  type QuestionStatus,
  type Reaction,
  type ResponseValue,
  type Results,
  type Role,
  type ServerMsg,
  type Settings,
} from "../shared/protocol";
import {
  clean,
  cleanEmail,
  describeAnswer,
  newHostKey,
  newId,
  normPasscode,
  quizPoints,
  RateLimiter,
  tally,
  toCsv,
  UserError,
  validatePoll,
  validateResponse,
} from "./logic";
import { buildXlsx, type Cell, type Sheet } from "./xlsx";

export interface Env {
  EVENTS: DurableObjectNamespace<EventRoom>;
  ASSETS: Fetcher;
  /** Optional R2 bucket for images in polls. */
  MEDIA?: R2Bucket;
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
  passcode: string;
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
  downs: number;
  edited: number;
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
  images: string;
  range: string;
  time_limit: number;
  started_at: number | null;
  items: string;
};

type ResponseRow = { pid: string; value: string; ts: number; elapsed: number | null };

interface LeaderData {
  board: Leaderboard;
  byPid: Map<string, { points: number; correct: number }>;
  /** Points each player got on each revealed quiz. */
  perPoll: Map<string, Map<string, number>>;
  ranked: { pid: string; points: number }[];
  /** Rank per player (ties share a rank). */
  rank: Map<string, number>;
}

const FLUSH_MS = 80;
const ONLINE_MS = 2000;
const ROLES: Role[] = ["host", "present", "attendee"];
const BOOL_SETTINGS = ["qaOpen", "moderation", "allowAnonymous", "allowDownvotes", "reactions"] as const;
const IDENTITIES: Identity[] = ["none", "name", "email"];
/** Extra time allowed after a quiz timer ends, for slow networks. */
const QUIZ_GRACE_MS = 1500;

/**
 * One EventRoom per event code. Holds all questions, votes, polls and responses
 * in its own SQLite database and pushes small patches to every connected screen.
 */
export class EventRoom extends DurableObject<Env> {
  private sql: SqlStorage;
  private ev: EventRecord | null = null;
  private resultsCache = new Map<string, Results>();
  private lbCache: LeaderData | null = null;

  // Batched changes waiting to be sent.
  private dirtyMeta = false;
  private dirtyLb = false;
  private dirtyAllMe = false;
  private dirtyQ = new Set<string>();
  private deletedQ = new Set<string>();
  private dirtyP = new Set<string>();
  private deletedP = new Set<string>();
  private dirtyR = new Set<string>();
  private dirtyMe = new Set<string>();
  private reactionCounts = new Map<Reaction, number>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private onlineTimer: ReturnType<typeof setTimeout> | null = null;

  private votesLimit = new RateLimiter(30, 10_000);
  private asksLimit = new RateLimiter(5, 60_000);
  private reactLimit = new RateLimiter(10, 5_000);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
      await this.importLegacy();
      const row = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'event'").toArray()[0];
      this.ev = row ? (JSON.parse(row.v) as EventRecord) : null;
      if (this.ev) {
        const old = this.ev.settings as Settings & { requireName?: boolean };
        this.ev.settings = { ...DEFAULT_SETTINGS, ...old };
        delete (this.ev.settings as { requireName?: boolean }).requireName;
        this.ev.passcode ??= "";
      }
    });
  }

  // ---------- database ----------

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
      CREATE TABLE IF NOT EXISTS participants (
        pid TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', joined_at INTEGER NOT NULL
      );
    `);
    // Columns added in v0.2
    this.addColumn("questions", "downs", "INTEGER NOT NULL DEFAULT 0");
    this.addColumn("questions", "edited", "INTEGER NOT NULL DEFAULT 0");
    this.addColumn("votes", "v", "INTEGER NOT NULL DEFAULT 1");
    this.addColumn("polls", "images", "TEXT NOT NULL DEFAULT '[]'");
    this.addColumn("polls", "range", "TEXT NOT NULL DEFAULT 'null'");
    this.addColumn("polls", "time_limit", "INTEGER NOT NULL DEFAULT 0");
    this.addColumn("polls", "started_at", "INTEGER");
    this.addColumn("polls", "items", "TEXT NOT NULL DEFAULT '[]'");
    this.addColumn("responses", "elapsed", "INTEGER");
  }

  private addColumn(table: string, column: string, def: string) {
    const cols = this.sql.exec<{ name: string }>(`PRAGMA table_info(${table})`).toArray();
    if (!cols.some((c) => c.name === column)) this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
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
      passcode: "",
    };
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('event', ?)", JSON.stringify(ev));
    for (const q of old.questions ?? []) {
      this.sql.exec("INSERT OR IGNORE INTO questions (id, text, name, pid, ts, status, highlighted, votes) VALUES (?,?,?,?,?,?,?,?)", q.id, q.text, q.name ?? "", q.pid, q.ts, q.status, q.highlighted ? 1 : 0, q.voters.length);
      for (const v of q.voters) this.sql.exec("INSERT OR IGNORE INTO votes (qid, pid) VALUES (?,?)", q.id, v);
    }
    (old.polls ?? []).forEach((p: any, i: number) => {
      this.sql.exec(
        "INSERT OR IGNORE INTO polls (id, ord, type, title, options, correct, multi, scale, status, show_results, revealed, ts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        p.id, i, p.type, p.title, JSON.stringify(p.options ?? []), JSON.stringify(p.correct ?? []), p.multi ? 1 : 0, p.scale ?? 0, p.status, p.showResults ? 1 : 0, p.revealed ? 1 : 0, p.ts ?? Date.now(),
      );
      for (const [pid, v] of Object.entries(p.responses ?? {})) this.sql.exec("INSERT OR IGNORE INTO responses (poll_id, pid, value, ts) VALUES (?,?,?,?)", p.id, pid, JSON.stringify(v), Date.now());
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
      passcode: "",
    };
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('event', ?)", JSON.stringify(this.ev));
    if (this.ev.expiresAt) await this.ctx.storage.setAlarm(this.ev.expiresAt);
    return { ok: true, code, hostKey: this.ev.hostKey, title };
  }

  async info(): Promise<EventInfo | null> {
    if (!this.ev) return null;
    const s = this.ev.settings;
    return { code: this.ev.code, title: this.ev.title, passcode: !!this.ev.passcode, identity: s.identity, theme: s.theme };
  }

  async isHost(key: string): Promise<boolean> {
    return !!this.ev && !!key && key === this.ev.hostKey;
  }

  async exportCsv(key: string): Promise<string | null> {
    if (!(await this.isHost(key))) return null;
    const rows: (string | number)[][] = [["Section", "Item", "Detail", "Count / Value", "Status", "Time"]];
    for (const q of this.sql.exec<QuestionRow>("SELECT * FROM questions ORDER BY ts").toArray())
      rows.push(["Q&A", q.text, q.name || "Anonymous", q.votes - q.downs, q.status, new Date(q.ts).toISOString()]);
    for (const r of this.pollSummaryRows()) rows.push([r[0], r[1], r[2], r[3], r[4], ""] as (string | number)[]);
    return toCsv(rows);
  }

  async exportXlsx(key: string): Promise<Uint8Array | null> {
    if (!(await this.isHost(key))) return null;
    const names = this.participantNames();
    const who = (pid: string) => names.get(pid)?.name || "Anonymous";
    const sheets: Sheet[] = [];

    sheets.push({
      name: "Questions",
      rows: [
        ["Question", "Asked by", "Upvotes", "Downvotes", "Score", "Status", "Asked at"],
        ...this.sql
          .exec<QuestionRow>("SELECT * FROM questions ORDER BY votes - downs DESC, ts")
          .toArray()
          .map((q) => [q.text, q.name || "Anonymous", q.votes, q.downs, q.votes - q.downs, q.status, new Date(q.ts).toISOString()] as Cell[]),
      ],
    });
    sheets.push({ name: "Poll results", rows: [["Poll", "Type", "Answer / option", "Count / value", "Status"], ...this.pollSummaryRows()] });

    const responses: Cell[][] = [["Poll", "Question", "Participant", "Answer", "Answered at"]];
    for (const p of this.allPolls()) {
      const rows = this.sql.exec<ResponseRow>("SELECT pid, value, ts, elapsed FROM responses WHERE poll_id = ? ORDER BY ts", p.id).toArray();
      for (const r of rows) {
        const v = JSON.parse(r.value);
        if (p.type === "survey") p.items.forEach((it, i) => responses.push([p.title, it.title, who(r.pid), describeAnswer(it, v[i]), new Date(r.ts).toISOString()]));
        else responses.push([p.title, "", who(r.pid), describeAnswer(p, v), new Date(r.ts).toISOString()]);
      }
    }
    sheets.push({ name: "All answers", rows: responses });

    const lb = this.leaderboard();
    if (lb.board.rounds > 0)
      sheets.push({
        name: "Quiz leaderboard",
        rows: [["Rank", "Player", "Points", "Correct answers"], ...lb.ranked.map((r, i) => [i + 1, who(r.pid), r.points, lb.byPid.get(r.pid)?.correct ?? 0] as Cell[])],
      });

    const people = [...names.entries()].filter(([, p]) => p.name || p.email);
    if (people.length)
      sheets.push({ name: "Participants", rows: [["Name", "Email", "Joined at"], ...people.map(([, p]) => [p.name, p.email, new Date(p.joinedAt).toISOString()] as Cell[])] });

    return buildXlsx(sheets);
  }

  async alarm() {
    if (this.ev?.expiresAt && Date.now() >= this.ev.expiresAt) {
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(CLOSE.NOT_FOUND, "Event expired");
        } catch {}
      }
      await this.deleteMedia(this.ev.code);
      this.ev = null;
      await this.ctx.storage.deleteAll();
    }
  }

  private async deleteMedia(code: string) {
    if (!this.env.MEDIA) return;
    let cursor: string | undefined;
    do {
      const list = await this.env.MEDIA.list({ prefix: `events/${code}/`, cursor });
      if (list.objects.length) await this.env.MEDIA.delete(list.objects.map((o) => o.key));
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
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
    if (role === "attendee" && this.ev.passcode && normPasscode(url.searchParams.get("pass")) !== this.ev.passcode)
      return reject(CLOSE.PASSCODE, "Passcode needed");
    const max = Number(this.env.MAX_PARTICIPANTS || 0);
    if (role === "attendee" && max > 0 && this.ctx.getWebSockets("attendee").length >= max) return reject(CLOSE.FULL, "This event is full");

    this.ctx.acceptWebSocket(server, [role, `pid:${pid}`]);
    server.serializeAttachment({ role, pid } satisfies Attachment);
    this.send(server, {
      type: "hello",
      role,
      snapshot: this.snapshot(role, pid),
      me: this.me(pid),
      now: Date.now(),
      ...(role === "host" ? { hostKey: this.ev.hostKey } : {}),
    });
    this.scheduleOnline();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (!this.ev || typeof raw !== "string" || raw.length > 20_000) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
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

  // ---------- participants ----------

  private participant(pid: string): { name: string; email: string } | null {
    return this.sql.exec<{ name: string; email: string }>("SELECT name, email FROM participants WHERE pid = ?", pid).toArray()[0] ?? null;
  }

  private participantNames(): Map<string, { name: string; email: string; joinedAt: number }> {
    const m = new Map<string, { name: string; email: string; joinedAt: number }>();
    for (const r of this.sql.exec<{ pid: string; name: string; email: string; joined_at: number }>("SELECT * FROM participants"))
      m.set(r.pid, { name: r.name, email: r.email, joinedAt: r.joined_at });
    return m;
  }

  private hasJoined(p: { name: string; email: string } | null): boolean {
    const id = this.ev!.settings.identity;
    if (id === "none") return true;
    if (!p?.name) return false;
    return id === "name" || !!p.email;
  }

  private requireJoined(pid: string, role: Role) {
    if (role === "host") return;
    if (!this.hasJoined(this.participant(pid)))
      throw new UserError(this.ev!.settings.identity === "email" ? "Please enter your name and email to take part" : "Please enter your name to take part");
  }

  // ---------- audience actions ----------

  /** Returns true if the message was an audience action (handled). */
  private handleAudience(msg: ClientMsg, pid: string, role: Role): boolean {
    const ev = this.ev!;
    switch (msg.type) {
      case "join": {
        const name = clean(msg.name, LIMITS.name);
        const needEmail = ev.settings.identity === "email";
        if (!name) throw new UserError("Please enter your name");
        const email = needEmail || msg.email ? cleanEmail(msg.email) : "";
        this.sql.exec(
          "INSERT INTO participants (pid, name, email, joined_at) VALUES (?,?,?,?) ON CONFLICT(pid) DO UPDATE SET name = excluded.name, email = CASE WHEN excluded.email = '' THEN participants.email ELSE excluded.email END",
          pid, name, email, Date.now(),
        );
        this.invalidateLb();
        this.touchMe(pid);
        return true;
      }
      case "ask": {
        this.requireJoined(pid, role);
        if (!ev.settings.qaOpen) throw new UserError("Questions are closed right now");
        const text = clean(msg.text, LIMITS.question);
        if (!text) throw new UserError("Question is empty");
        let name = clean(msg.name, LIMITS.name);
        if (ev.settings.identity !== "none" && role !== "host") name = this.participant(pid)?.name ?? name;
        if (!name && !ev.settings.allowAnonymous) throw new UserError("Please add your name");
        if (role !== "host" && !this.asksLimit.take(pid)) throw new UserError("Slow down a little — try again in a minute");
        const id = newId();
        const status: QuestionStatus = ev.settings.moderation && role !== "host" ? "pending" : "live";
        this.sql.exec("INSERT INTO questions (id, text, name, pid, ts, status) VALUES (?,?,?,?,?,?)", id, text, name, pid, Date.now(), status);
        // Remember the name they typed so it can show on the quiz leaderboard.
        if (name && role !== "host" && ev.settings.identity === "none") {
          this.sql.exec(
            "INSERT INTO participants (pid, name, email, joined_at) VALUES (?,?,'',?) ON CONFLICT(pid) DO UPDATE SET name = CASE WHEN participants.name = '' THEN excluded.name ELSE participants.name END",
            pid, name, Date.now(),
          );
          this.invalidateLb();
        }
        this.touchQ(id);
        this.touchMe(pid);
        return true;
      }
      case "vote": {
        this.requireJoined(pid, role);
        if (!this.votesLimit.take(pid)) throw new UserError("Too many clicks — slow down a little");
        const dir = msg.dir === -1 ? -1 : 1;
        if (dir === -1 && !ev.settings.allowDownvotes) throw new UserError("Downvotes are turned off");
        const id = String(msg.id);
        const q = this.sql.exec<{ status: string }>("SELECT status FROM questions WHERE id = ?", id).toArray()[0];
        if (!q || q.status === "pending" || q.status === "archived") return true;
        const cur = this.sql.exec<{ v: number }>("SELECT v FROM votes WHERE qid = ? AND pid = ?", id, pid).toArray()[0];
        if (cur?.v === dir) this.sql.exec("DELETE FROM votes WHERE qid = ? AND pid = ?", id, pid);
        else this.sql.exec("INSERT INTO votes (qid, pid, v) VALUES (?,?,?) ON CONFLICT(qid, pid) DO UPDATE SET v = excluded.v", id, pid, dir);
        this.recountVotes(id);
        this.touchQ(id);
        this.touchMe(pid);
        return true;
      }
      case "editQuestion": {
        const q = this.ownQuestion(msg.id, pid);
        if (q.status !== "pending" && q.status !== "live") throw new UserError("This question can't be edited any more");
        const text = clean(msg.text, LIMITS.question);
        if (!text) throw new UserError("Question is empty");
        this.sql.exec("UPDATE questions SET text = ?, edited = 1 WHERE id = ?", text, q.id);
        this.touchQ(q.id);
        return true;
      }
      case "withdraw": {
        const q = this.ownQuestion(msg.id, pid);
        this.removeQuestion(q.id);
        this.touchMe(pid);
        return true;
      }
      case "respond": {
        this.requireJoined(pid, role);
        if (!this.votesLimit.take(pid)) throw new UserError("Too many clicks — slow down a little");
        const p = this.pollRow(String(msg.pollId));
        if (!p || p.status !== "active") throw new UserError("This poll is not open");
        const now = Date.now();
        let elapsed: number | null = null;
        if (p.type === "quiz") {
          if (p.revealed) throw new UserError("Answers are closed — the answer has been revealed");
          if (p.timeLimit && p.startedAt && now > p.startedAt + p.timeLimit * 1000 + QUIZ_GRACE_MS) throw new UserError("Time's up!");
          if (this.sql.exec("SELECT 1 FROM responses WHERE poll_id = ? AND pid = ?", p.id, pid).toArray().length)
            throw new UserError("You've already answered this one");
          elapsed = p.startedAt ? Math.max(0, now - p.startedAt) : 0;
        }
        const value = validateResponse(p, msg.value);
        this.sql.exec(
          "INSERT INTO responses (poll_id, pid, value, ts, elapsed) VALUES (?,?,?,?,?) ON CONFLICT(poll_id, pid) DO UPDATE SET value = excluded.value, ts = excluded.ts",
          p.id, pid, JSON.stringify(value), now, elapsed,
        );
        this.touchR(p.id);
        this.touchMe(pid);
        return true;
      }
      case "react": {
        if (!ev.settings.reactions) return true;
        if (!REACTIONS.includes(msg.emoji)) return true;
        if (!this.reactLimit.take(pid)) return true; // silently drop spam
        this.reactionCounts.set(msg.emoji, (this.reactionCounts.get(msg.emoji) ?? 0) + 1);
        this.scheduleFlush();
        return true;
      }
      default:
        return false;
    }
  }

  private ownQuestion(id: string, pid: string): QuestionRow {
    const q = this.sql.exec<QuestionRow>("SELECT * FROM questions WHERE id = ?", String(id)).toArray()[0];
    if (!q || q.pid !== pid) throw new UserError("You can only change your own questions");
    return q;
  }

  private recountVotes(id: string) {
    this.sql.exec(
      "UPDATE questions SET votes = (SELECT COUNT(*) FROM votes WHERE qid = ? AND v = 1), downs = (SELECT COUNT(*) FROM votes WHERE qid = ? AND v = -1) WHERE id = ?",
      id, id, id,
    );
  }

  private removeQuestion(id: string) {
    this.sql.exec("DELETE FROM votes WHERE qid = ?", id);
    this.sql.exec("DELETE FROM questions WHERE id = ?", id);
    this.deletedQ.add(id);
    this.dirtyQ.delete(id);
    this.scheduleFlush();
  }

  // ---------- host actions ----------

  private handleHost(msg: ClientMsg) {
    const ev = this.ev!;
    switch (msg.type) {
      case "setTitle":
        ev.title = clean(msg.title, LIMITS.title) || ev.title;
        return this.saveEvent();
      case "setSettings": {
        const s = msg.settings ?? {};
        for (const k of BOOL_SETTINGS) if (typeof s[k] === "boolean") ev.settings[k] = s[k]!;
        if (s.identity && IDENTITIES.includes(s.identity)) {
          ev.settings.identity = s.identity;
          this.dirtyAllMe = true; // "joined" depends on this
        }
        if (s.theme && THEMES.includes(s.theme)) ev.settings.theme = s.theme;
        if (s.screen === "light" || s.screen === "dark") ev.settings.screen = s.screen;
        return this.saveEvent();
      }
      case "setPasscode":
        ev.passcode = normPasscode(msg.passcode);
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
        return this.removeQuestion(msg.id);
      case "clearQuestions":
        for (const r of this.sql.exec<{ id: string }>("DELETE FROM questions RETURNING id")) {
          this.deletedQ.add(r.id);
          this.dirtyQ.delete(r.id);
        }
        this.sql.exec("DELETE FROM votes");
        this.dirtyAllMe = true;
        return this.scheduleFlush();

      case "savePoll": {
        const d = validatePoll(msg.poll);
        const existing = msg.poll.id ? this.pollRow(msg.poll.id) : null;
        const cols = [d.type, d.title, JSON.stringify(d.options), JSON.stringify(d.correct), d.multi ? 1 : 0, d.scale, JSON.stringify(d.images), JSON.stringify(d.range), d.timeLimit, JSON.stringify(d.items)];
        if (existing) {
          const shape = (p: Pick<Poll, "type" | "options" | "range" | "items">) => JSON.stringify([p.type, p.options, p.range, p.items.map((i) => [i.type, i.options, i.range])]);
          const structural = shape(existing) !== shape(d);
          this.sql.exec("UPDATE polls SET type=?, title=?, options=?, correct=?, multi=?, scale=?, images=?, range=?, time_limit=?, items=? WHERE id=?", ...cols, existing.id);
          if (structural) this.clearResponses(existing.id);
          this.touchP(existing.id);
          this.touchR(existing.id);
          if (existing.type === "quiz" || d.type === "quiz") this.invalidateLb();
        } else this.insertPoll(cols);
        return;
      }
      case "duplicatePoll": {
        const p = this.pollRow(msg.pollId);
        if (!p) return;
        this.insertPoll([p.type, `${p.title} (copy)`.slice(0, LIMITS.question), JSON.stringify(p.options), JSON.stringify(p.correct ?? []), p.multi ? 1 : 0, p.scale, JSON.stringify(p.images), JSON.stringify(p.range), p.timeLimit, JSON.stringify(p.items)]);
        return;
      }
      case "activatePoll": {
        for (const r of this.sql.exec<{ id: string }>("UPDATE polls SET status = 'closed' WHERE status = 'active' RETURNING id")) {
          this.touchP(r.id);
          this.touchR(r.id);
        }
        const p = msg.pollId ? this.pollRow(msg.pollId) : null;
        if (p) {
          this.sql.exec("UPDATE polls SET status = 'active', started_at = ? WHERE id = ?", Date.now(), p.id);
          this.touchP(p.id);
          this.touchR(p.id);
        }
        ev.activePollId = p?.id ?? null;
        return this.saveEvent();
      }
      case "closePoll":
        this.sql.exec("UPDATE polls SET status = 'closed' WHERE id = ?", msg.pollId);
        this.touchP(msg.pollId);
        this.touchR(msg.pollId);
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
        this.touchP(msg.pollId);
        this.touchR(msg.pollId);
        this.invalidateLb();
        this.dirtyAllMe = true; // everyone's points and rank may change
        return;
      case "resetPoll": {
        this.clearResponses(msg.pollId);
        this.sql.exec("UPDATE polls SET revealed = 0, started_at = CASE status WHEN 'active' THEN ? ELSE started_at END WHERE id = ?", Date.now(), msg.pollId);
        this.touchP(msg.pollId);
        this.invalidateLb();
        return this.touchR(msg.pollId);
      }
      case "deletePoll":
        this.clearResponses(msg.pollId);
        this.sql.exec("DELETE FROM polls WHERE id = ?", msg.pollId);
        this.resultsCache.delete(msg.pollId);
        this.deletedP.add(msg.pollId);
        this.dirtyP.delete(msg.pollId);
        this.dirtyR.delete(msg.pollId);
        this.invalidateLb();
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

  private insertPoll(cols: (string | number)[]) {
    const id = newId();
    const ord = (this.sql.exec<{ m: number | null }>("SELECT MAX(ord) AS m FROM polls").one().m ?? -1) + 1;
    this.sql.exec(
      "INSERT INTO polls (type, title, options, correct, multi, scale, images, range, time_limit, items, id, ord, status, show_results, revealed, ts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'draft', 1, 0, ?)",
      ...cols, id, ord, Date.now(),
    );
    this.touchP(id);
  }

  private clearResponses(pollId: string) {
    for (const r of this.sql.exec<{ pid: string }>("DELETE FROM responses WHERE poll_id = ? RETURNING pid", pollId)) this.touchMe(r.pid);
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
      images: JSON.parse(r.images || "[]"),
      correct: JSON.parse(r.correct),
      multi: !!r.multi,
      scale: r.scale,
      range: JSON.parse(r.range || "null"),
      status: r.status,
      showResults: !!r.show_results,
      revealed: !!r.revealed,
      timeLimit: r.time_limit ?? 0,
      startedAt: r.started_at ?? null,
      items: JSON.parse(r.items || "[]"),
    };
  }

  private toQuestion(r: QuestionRow): Question {
    return { id: r.id, text: r.text, name: r.name, ts: r.ts, votes: r.votes, downs: r.downs ?? 0, status: r.status, highlighted: !!r.highlighted, edited: !!r.edited };
  }

  /** Full tally for a poll (cached until a response changes). */
  private results(pollId: string): Results {
    let r = this.resultsCache.get(pollId);
    if (!r) {
      const p = this.pollRow(pollId);
      if (!p) return { total: 0 };
      const values = this.sql.exec<{ value: string }>("SELECT value FROM responses WHERE poll_id = ?", pollId).toArray().map((x) => JSON.parse(x.value) as ResponseValue);
      r = tally(p, values);
      this.resultsCache.set(pollId, r);
    }
    return r;
  }

  private pollSummaryRows(): Cell[][] {
    const rows: Cell[][] = [];
    const add = (poll: string, it: Item, r: Results, status: string) => {
      const kind = it.type;
      if (r.scores) it.options.map((o, i) => [o, r.scores![i]] as const).sort((a, b) => b[1] - a[1]).forEach(([o, s]) => rows.push([poll, kind, `${o} (avg points)`, s, status]));
      else if (r.counts) {
        const labels =
          it.type === "rating"
            ? r.counts.map((_, i) => `${i + 1} stars`)
            : it.type === "scale"
              ? r.counts.map((_, i) => String((it.range?.min ?? 1) + i))
              : it.options;
        labels.forEach((o, i) => rows.push([poll, kind, o, r.counts![i], status]));
        if (r.avg !== undefined) rows.push([poll, kind, "Average", r.avg, status]);
      } else if (r.words) r.words.forEach(([w, c]) => rows.push([poll, kind, w, c, status]));
      else if (r.answers) r.answers.forEach((a) => rows.push([poll, kind, a, "", status]));
      rows.push([poll, kind, "Total responses", r.total, status]);
    };
    for (const p of this.allPolls()) {
      const r = this.results(p.id);
      if (p.type === "survey") p.items.forEach((it, i) => add(`${p.title} — ${it.title}`, it, r.items?.[i] ?? { total: 0 }, p.status));
      else
        add(
          p.title,
          { ...p, options: p.options.map((o, i) => (p.correct?.includes(i) ? `${o} ✓` : o)) } as Item,
          r,
          p.status,
        );
    }
    return rows;
  }

  // ---------- quiz leaderboard ----------

  private invalidateLb() {
    this.lbCache = null;
    this.dirtyLb = true;
    this.scheduleFlush();
  }

  /** Points only count once the host reveals a quiz question's answer. */
  private leaderboard(): LeaderData {
    if (this.lbCache) return this.lbCache;
    const byPid = new Map<string, { points: number; correct: number }>();
    const perPoll = new Map<string, Map<string, number>>();
    const quizzes = this.allPolls().filter((p) => p.type === "quiz" && p.revealed);
    for (const p of quizzes) {
      const pts = new Map<string, number>();
      for (const r of this.sql.exec<ResponseRow>("SELECT pid, value, ts, elapsed FROM responses WHERE poll_id = ?", p.id)) {
        const points = quizPoints(p.correct ?? [], JSON.parse(r.value) as number[], p.timeLimit, r.elapsed ?? 0);
        pts.set(r.pid, points);
        const cur = byPid.get(r.pid) ?? { points: 0, correct: 0 };
        cur.points += points;
        if (points > 0) cur.correct++;
        byPid.set(r.pid, cur);
      }
      perPoll.set(p.id, pts);
    }
    const ranked = [...byPid.entries()].map(([pid, v]) => ({ pid, points: v.points })).sort((a, b) => b.points - a.points);
    const rank = new Map<string, number>();
    ranked.forEach((r, i) => rank.set(r.pid, i > 0 && ranked[i - 1].points === r.points ? rank.get(ranked[i - 1].pid)! : i + 1));
    const names = ranked.length ? this.participantNames() : new Map();
    const top = ranked.slice(0, 10).map((r) => ({
      name: names.get(r.pid)?.name || `Player ${r.pid.slice(-4).toUpperCase()}`,
      points: r.points,
      correct: byPid.get(r.pid)!.correct,
    }));
    this.lbCache = { board: { top, players: ranked.length, rounds: quizzes.length }, byPid, perPoll, ranked, rank };
    return this.lbCache;
  }

  private me(pid: string): Me {
    const responses: Record<string, ResponseValue> = {};
    for (const r of this.sql.exec<{ poll_id: string; value: string }>("SELECT poll_id, value FROM responses WHERE pid = ?", pid)) responses[r.poll_id] = JSON.parse(r.value);
    const votes: string[] = [];
    const downs: string[] = [];
    for (const r of this.sql.exec<{ qid: string; v: number }>("SELECT qid, v FROM votes WHERE pid = ?", pid)) (r.v === -1 ? downs : votes).push(r.qid);
    const p = this.participant(pid);

    let quiz: Me["quiz"] = null;
    const lb = this.leaderboard();
    const mine = lb.byPid.get(pid);
    if (mine) {
      const rank = lb.rank.get(pid) ?? lb.ranked.length;
      const active = this.ev?.activePollId;
      const last = active && lb.perPoll.has(active) ? (lb.perPoll.get(active)!.get(pid) ?? null) : null;
      quiz = { points: mine.points, rank, players: lb.board.players, last };
    }
    return {
      pid,
      name: p?.name ?? "",
      email: p?.email ?? "",
      joined: this.ev ? this.hasJoined(p) : true,
      votes,
      downs,
      questions: this.sql.exec<{ id: string }>("SELECT id FROM questions WHERE pid = ?", pid).toArray().map((r) => r.id),
      responses,
      quiz,
    };
  }

  private metaView(role: Role): Meta {
    const ev = this.ev!;
    return {
      code: ev.code,
      title: ev.title,
      settings: { ...ev.settings },
      presentMode: ev.presentMode,
      activePollId: ev.activePollId,
      ...(role === "host" ? { passcode: ev.passcode } : {}),
    };
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
    const full = this.results(p.id);
    if (role === "host") return full;
    // Quiz results stay hidden until the answer is revealed, so nobody copies the crowd.
    if (p.type === "quiz" && !p.revealed) return { total: full.total, hidden: true };
    if (role === "attendee" && !p.showResults) return { total: full.total, hidden: true };
    return full;
  }

  private snapshot(role: Role, pid: string) {
    const questions = this.sql
      .exec<QuestionRow>("SELECT * FROM questions ORDER BY ts")
      .toArray()
      .filter((q) => this.questionVisible(q, role, pid))
      .map((q) => this.toQuestion(q));
    const polls = this.allPolls().filter((p) => this.pollVisible(p, role));
    const results: Record<string, Results> = {};
    for (const p of polls) if (p.status !== "draft") results[p.id] = this.resultsView(p, role);
    return {
      meta: this.metaView(role),
      questions,
      polls: polls.map((p) => this.pollView(p, role)),
      results,
      leaderboard: this.leaderboard().board,
      online: this.onlineCount(),
    };
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
    const board = this.dirtyLb ? this.leaderboard().board : null;

    const base = (role: Role): Op[] => {
      const ops: Op[] = [];
      if (this.dirtyMeta) ops.push({ k: "meta", d: this.metaView(role) });
      for (const q of qRows) ops.push(this.questionVisible(q, role) ? { k: "q", d: this.toQuestion(q) } : { k: "q-", id: q.id });
      for (const id of this.deletedQ) ops.push({ k: "q-", id });
      for (const p of polls) {
        const visible = this.pollVisible(p, role);
        if (this.dirtyP.has(p.id)) ops.push(visible ? { k: "p", d: this.pollView(p, role) } : { k: "p-", id: p.id });
        if (visible && p.status !== "draft" && this.dirtyR.has(p.id)) ops.push({ k: "r", id: p.id, d: this.resultsView(p, role) });
      }
      for (const id of this.deletedP) ops.push({ k: "p-", id });
      if (board) ops.push({ k: "lb", d: board });
      return ops;
    };

    for (const role of ROLES) {
      const ops = base(role);
      if (!ops.length) continue;
      const msg = JSON.stringify({ type: "patch", ops } satisfies ServerMsg);
      for (const ws of this.ctx.getWebSockets(role)) this.sendRaw(ws, msg);
    }

    // Authors see their own questions while they wait for approval.
    const pendingByAuthor = new Map<string, Question[]>();
    for (const q of qRows) if (q.status === "pending") pendingByAuthor.set(q.pid, [...(pendingByAuthor.get(q.pid) ?? []), this.toQuestion(q)]);
    for (const [pid, qs] of pendingByAuthor) {
      const msg = JSON.stringify({ type: "patch", ops: qs.map((d) => ({ k: "q", d })) } satisfies ServerMsg);
      for (const ws of this.ctx.getWebSockets(`pid:${pid}`)) {
        if ((ws.deserializeAttachment() as Attachment).role !== "host") this.sendRaw(ws, msg);
      }
    }

    // Personal data (own votes, answers, quiz score).
    const mePids = this.dirtyAllMe
      ? new Set(this.ctx.getWebSockets().map((ws) => (ws.deserializeAttachment() as Attachment).pid))
      : this.dirtyMe;
    for (const pid of mePids) {
      const sockets = this.ctx.getWebSockets(`pid:${pid}`);
      if (!sockets.length) continue;
      const msg = JSON.stringify({ type: "me", me: this.me(pid) } satisfies ServerMsg);
      for (const ws of sockets) this.sendRaw(ws, msg);
    }

    // Reactions go to the big screen and the host only.
    if (this.reactionCounts.size) {
      const msg = JSON.stringify({ type: "reactions", counts: Object.fromEntries(this.reactionCounts) } satisfies ServerMsg);
      for (const ws of this.ctx.getWebSockets("present")) this.sendRaw(ws, msg);
      for (const ws of this.ctx.getWebSockets("host")) this.sendRaw(ws, msg);
      this.reactionCounts.clear();
    }

    this.dirtyMeta = false;
    this.dirtyLb = false;
    this.dirtyAllMe = false;
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
