import { DurableObject } from "cloudflare:workers";
import type { Workspace } from "./workspace";
import type { SsoEnv } from "./sso";
import { capacity, type BillingEnv, type Plan } from "./billing";
import type { HostAccount } from "./accounts";
import type { MailEnv } from "./mail";
import {
  CLOSE,
  DEFAULT_SETTINGS,
  DEFAULT_BRAND,
  LIMITS,
  MAIN_ROOM,
  PING,
  PONG,
  PRESENT_MODES,
  REACTIONS,
  THEMES,
  type Analytics,
  type ApiSetup,
  type WebhookEvent,
  type ClientMsg,
  type EventInfo,
  type EventTemplate,
  type Identity,
  type Item,
  type Label,
  type Leaderboard,
  type Me,
  type Meta,
  type Op,
  type Poll,
  type PollDraft,
  type PollStatus,
  type PresentMode,
  type Profanity,
  type Question,
  type QuestionStatus,
  type Recap,
  type Reaction,
  type Reply,
  type ResponseValue,
  type Results,
  type Role,
  type Room,
  type ServerMsg,
  type Settings,
} from "../shared/protocol";
import {
  clean,
  cleanBlockedWords,
  cleanBrand,
  cleanDeckUrl,
  cleanEmail,
  cleanLabels,
  cleanRooms,
  describeAnswer,
  isMediaId,
  maskWords,
  newHostKey,
  newId,
  normPasscode,
  quizPoints,
  resultsText,
  teamScores,
  RateLimiter,
  tally,
  toCsv,
  UserError,
  validatePoll,
  validateResponse,
  type CleanPoll,
} from "./logic";
import { buildXlsx, type Cell, type Sheet } from "./xlsx";
import { AI_DUPLICATE_SCORE, aiAvailable, chat, embed, packVector, POLLS_PROMPT, SUMMARY_PROMPT, unpackVector, type AiEnv } from "./ai";
import { parsePolls, type PasteResult } from "../shared/paste";
import { checkWebhookUrl, cleanWebhookEvents, newApiKey, newSecret, signWebhook, WEBHOOK_BATCH_MS, WEBHOOK_MAX_BATCH, WEBHOOK_TIMEOUT_MS } from "./api";
import { DUPLICATE_SCORE, fingerprint, similarity, vectorScore, type Fingerprint } from "../shared/similar";

export interface Env extends AiEnv, MailEnv, SsoEnv, BillingEnv {
  EVENTS: DurableObjectNamespace<EventRoom>;
  /** Optional host accounts (sign in by email link or single sign-on). */
  ACCOUNTS?: DurableObjectNamespace<HostAccount>;
  /** Optional team workspaces (needs accounts). */
  WORKSPACES?: DurableObjectNamespace<Workspace>;
  ASSETS: Fetcher;
  /** Optional R2 bucket for images in polls. */
  MEDIA?: R2Bucket;
  /** Delete events this many hours after creation. Empty = keep forever. */
  EVENT_TTL_HOURS?: string;
  /** Max attendees connected at once per event. 0 or empty = unlimited. */
  MAX_PARTICIPANTS?: string;
  /** "1" lets webhooks go to local addresses. Only for development and tests. */
  WEBHOOK_ALLOW_PRIVATE?: string;
}

interface EventRecord {
  code: string;
  title: string;
  hostKey: string;
  modKey: string;
  createdAt: number;
  expiresAt: number | null;
  settings: Settings;
  presentMode: PresentMode;
  activePollId: string | null;
  passcode: string;
  labels: Label[];
  rooms: Room[];
  stats: { peakOnline: number; peakAt: number | null };
  /** Public recap page: shared or not, and the host's summary. */
  recap: { public: boolean; summary: string };
  teams: Label[];
  api: ApiSetup;
  /** Paid plan (only matters when billing is set up): lifts the attendee limit. */
  plan?: Plan;
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
  room: string;
  labels: string;
  dup_of: string | null;
};

type ReplyRow = { id: string; qid: string; text: string; name: string; pid: string; ts: number; official: number };

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
  axes: string;
  image: string | null;
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

type Activity = "join" | "ask" | "vote" | "answer" | "react" | "reply";

const FLUSH_MS = 80;
const ONLINE_MS = 2000;
const ROLES: Role[] = ["host", "mod", "present", "attendee"];
const BOOL_SETTINGS = ["qaOpen", "moderation", "allowAnonymous", "allowDownvotes", "reactions", "audienceReplies", "hideNames", "aiAssist", "selfPaced"] as const;
const IDENTITIES: Identity[] = ["none", "name", "email"];
const PROFANITY: Profanity[] = ["off", "mask", "review"];
/** Extra time allowed after a quiz timer ends, for slow networks. */
const QUIZ_GRACE_MS = 1500;
const isStaff = (role: Role) => role === "host" || role === "mod";
/** Compares secrets in constant time, so timing doesn't leak how much of a key was right. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

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
  /** Activity per minute, waiting to be saved for analytics. */
  private activity = new Map<string, number>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Webhook events waiting to be sent, and the timer that sends them. */
  private hookQueue: { type: WebhookEvent | "ping"; at: number; data: unknown }[] = [];
  private hookTimer: ReturnType<typeof setTimeout> | null = null;
  /** Word fingerprints of questions, for duplicate hints. Rebuilt on demand. */
  private prints = new Map<string, Fingerprint>();
  private onlineTimer: ReturnType<typeof setTimeout> | null = null;

  private votesLimit = new RateLimiter(30, 10_000);
  private asksLimit = new RateLimiter(5, 60_000);
  private repliesLimit = new RateLimiter(5, 60_000);
  private reactLimit = new RateLimiter(10, 5_000);
  /** AI calls cost money on the host's account, so keep them to a sensible pace. */
  private aiLimit = new RateLimiter(10, 600_000);

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
        // Fill in fields added by newer versions.
        const old = this.ev.settings as Settings & { requireName?: boolean };
        this.ev.settings = { ...DEFAULT_SETTINGS, ...old };
        delete (this.ev.settings as { requireName?: boolean }).requireName;
        this.ev.passcode ??= "";
        this.ev.modKey ??= newHostKey();
        this.ev.labels ??= [];
        this.ev.rooms ??= [];
        this.ev.stats ??= { peakOnline: 0, peakAt: null };
        this.ev.recap ??= { public: false, summary: "" };
        this.ev.teams ??= [];
        this.ev.api ??= { key: null, webhook: null };
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
      CREATE TABLE IF NOT EXISTS replies (
        id TEXT PRIMARY KEY, qid TEXT NOT NULL, text TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', pid TEXT NOT NULL,
        ts INTEGER NOT NULL, official INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS replies_qid ON replies(qid);
      CREATE INDEX IF NOT EXISTS replies_pid ON replies(pid);
      CREATE TABLE IF NOT EXISTS timeline (minute INTEGER NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (minute, kind));
      CREATE TABLE IF NOT EXISTS seen (pid TEXT PRIMARY KEY, first INTEGER NOT NULL, last INTEGER NOT NULL);
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
    // Columns added in v0.3
    this.addColumn("questions", "room", `TEXT NOT NULL DEFAULT '${MAIN_ROOM}'`);
    this.addColumn("questions", "labels", "TEXT NOT NULL DEFAULT '[]'");
    this.addColumn("polls", "axes", "TEXT NOT NULL DEFAULT 'null'");
    this.addColumn("polls", "image", "TEXT");
    // v0.4: Smart Q&A
    this.addColumn("questions", "dup_of", "TEXT");
    this.sql.exec("CREATE TABLE IF NOT EXISTS vectors (qid TEXT PRIMARY KEY, room TEXT NOT NULL, vec BLOB NOT NULL)");
    // v0.7: quiz teams
    this.addColumn("participants", "team", "TEXT");
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
      modKey: newHostKey(),
      createdAt: old.createdAt,
      expiresAt: null,
      settings: { ...DEFAULT_SETTINGS, ...old.settings },
      presentMode: old.presentMode ?? "auto",
      activePollId: old.activePollId ?? null,
      passcode: "",
      labels: [],
      rooms: [],
      stats: { peakOnline: 0, peakAt: null },
      recap: { public: false, summary: "" },
      teams: [],
      api: { key: null, webhook: null },
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

  /** Saves the event record without telling anyone (for stats). */
  private persistEvent() {
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('event', ?)", JSON.stringify(this.ev));
  }

  private saveEvent() {
    this.persistEvent();
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
      modKey: newHostKey(),
      createdAt: now,
      expiresAt: ttl > 0 ? now + ttl * 3_600_000 : null,
      settings: { ...DEFAULT_SETTINGS },
      presentMode: "auto",
      activePollId: null,
      passcode: "",
      labels: [],
      rooms: [],
      stats: { peakOnline: 0, peakAt: null },
      recap: { public: false, summary: "" },
      teams: [],
      api: { key: null, webhook: null },
    };
    this.persistEvent();
    await this.scheduleAlarm();
    return { ok: true, code, hostKey: this.ev.hostKey, title };
  }

  async info(): Promise<EventInfo | null> {
    if (!this.ev) return null;
    const s = this.ev.settings;
    return { code: this.ev.code, title: this.ev.title, passcode: !!this.ev.passcode, identity: s.identity, theme: s.theme, logo: s.logo, brand: s.brand ?? DEFAULT_BRAND };
  }

  async isHost(key: string): Promise<boolean> {
    return !!this.ev && !!key && safeEqual(key, this.ev.hostKey);
  }

  /** Set by the server when the event's workspace changes plan. Not reachable from outside. */
  async setPlan(plan: Plan) {
    if (!this.ev || (this.ev.plan ?? "free") === plan) return;
    this.ev.plan = plan;
    this.persistEvent();
    this.dirtyMeta = true;
    this.scheduleFlush();
  }

  /** The polls in this event, for picking one in a slide add-in. Host only. */
  async pollList(key: string): Promise<{ title: string; polls: { id: string; title: string; type: string; status: string }[] } | null> {
    if (!(await this.isHost(key))) return null;
    return { title: this.ev!.title, polls: this.allPolls().map((p) => ({ id: p.id, title: p.title, type: p.type, status: p.status })) };
  }

  /** Copies this event's setup (not its answers) so it can be reused. */
  async exportTemplate(key: string): Promise<{ template: EventTemplate; media: string[] } | null> {
    if (!(await this.isHost(key))) return null;
    const ev = this.ev!;
    const { qaOpen, moderation, allowAnonymous, allowDownvotes, reactions, identity, theme, screen, audienceReplies, hideNames, profanity, blockedWords, logo } = ev.settings;
    const polls: PollDraft[] = this.allPolls().map((p) => ({
      type: p.type,
      title: p.title,
      options: p.options,
      images: p.images,
      correct: p.correct ?? [],
      multi: p.multi,
      range: p.range,
      timeLimit: p.timeLimit,
      axes: p.axes,
      image: p.image,
      items: p.items.map((it) => ({ type: it.type as Exclude<Item["type"], "quiz">, title: it.title, options: it.options, images: it.images, multi: it.multi, range: it.range, axes: it.axes, image: it.image })),
    }));
    const media = new Set<string>();
    const addImgs = (x: { images?: (string | null)[]; image?: string | null }) => {
      x.images?.forEach((i) => i && media.add(i));
      if (x.image) media.add(x.image);
    };
    for (const p of polls) {
      addImgs(p);
      p.items?.forEach(addImgs);
    }
    if (logo) media.add(logo);
    return {
      template: {
        title: ev.title,
        settings: { qaOpen, moderation, allowAnonymous, allowDownvotes, reactions, identity, theme, screen, audienceReplies, hideNames, profanity, blockedWords, logo },
        labels: ev.labels.map(({ name, color }) => ({ name, color })),
        rooms: ev.rooms.map(({ name }) => ({ name })),
        teams: ev.teams.map(({ name, color }) => ({ name, color })),
        polls,
      },
      media: [...media],
    };
  }

  /** Sets up a brand-new event from a template. Polls that don't validate are skipped. */
  async applyTemplate(t: EventTemplate): Promise<{ polls: number }> {
    if (!this.ev) return { polls: 0 };
    this.applySettings(t.settings ?? {});
    if (t.labels?.length) this.ev.labels = cleanLabels(t.labels, newId);
    if (t.rooms?.length) this.ev.rooms = this.withMainRoom(cleanRooms(t.rooms, newId));
    if (t.teams?.length) this.ev.teams = cleanLabels(t.teams, newId);
    let n = 0;
    for (const d of (t.polls ?? []).slice(0, LIMITS.importPolls)) {
      try {
        this.insertPoll(validatePoll(d));
        n++;
      } catch {}
    }
    this.persistEvent();
    return { polls: n };
  }

  async exportCsv(key: string): Promise<string | null> {
    if (!(await this.isHost(key))) return null;
    const rows: (string | number)[][] = [["Section", "Item", "Detail", "Count / Value", "Status", "Time"]];
    const roomName = this.roomNamer();
    for (const q of this.sql.exec<QuestionRow>("SELECT * FROM questions ORDER BY ts").toArray())
      rows.push([`Q&A${this.ev!.rooms.length > 1 ? ` (${roomName(q.room)})` : ""}`, q.text, q.name || "Anonymous", q.votes - q.downs, q.status, new Date(q.ts).toISOString()]);
    for (const r of this.pollSummaryRows()) rows.push([r[0], r[1], r[2], r[3], r[4], ""] as (string | number)[]);
    return toCsv(rows);
  }

  async exportXlsx(key: string): Promise<Uint8Array | null> {
    if (!(await this.isHost(key))) return null;
    const names = this.participantNames();
    const who = (pid: string) => names.get(pid)?.name || "Anonymous";
    const labelName = new Map(this.ev!.labels.map((l) => [l.id, l.name]));
    const roomName = this.roomNamer();
    const replies = this.repliesFor(null);
    const sheets: Sheet[] = [];

    sheets.push({
      name: "Questions",
      rows: [
        ["Question", "Asked by", "Upvotes", "Downvotes", "Score", "Status", "Room", "Labels", "Replies", "Asked at"],
        ...this.sql
          .exec<QuestionRow>("SELECT * FROM questions ORDER BY votes - downs DESC, ts")
          .toArray()
          .map(
            (q) =>
              [
                q.text,
                q.name || "Anonymous",
                q.votes,
                q.downs,
                q.votes - q.downs,
                q.status,
                roomName(q.room),
                (JSON.parse(q.labels) as string[]).map((l) => labelName.get(l) ?? "").filter(Boolean).join(", "),
                (replies.get(q.id) ?? []).map((r) => `${r.official ? "[Host] " : ""}${r.name ? r.name + ": " : ""}${r.text}`).join("\n"),
                new Date(q.ts).toISOString(),
              ] as Cell[],
          ),
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
    const teamIds = this.ev!.teams.length ? new Map(this.sql.exec<{ pid: string; team: string }>("SELECT pid, team FROM participants WHERE team IS NOT NULL").toArray().map((r) => [r.pid, r.team])) : null;
    const teamName = teamIds ? (pid: string) => this.ev!.teams.find((t) => t.id === teamIds.get(pid))?.name ?? "" : null;
    if (lb.board.rounds > 0 && lb.board.teams?.length)
      sheets.push({
        name: "Team leaderboard",
        rows: [["Rank", "Team", "Average points", "Total points", "Players", "Members"], ...lb.board.teams.map((t, i) => [i + 1, t.name, t.avg, t.points, t.players, t.members] as Cell[])],
      });
    if (lb.board.rounds > 0)
      sheets.push({
        name: "Quiz leaderboard",
        rows: [["Rank", "Player", "Points", "Correct answers"], ...lb.ranked.map((r) => [lb.rank.get(r.pid) ?? 0, who(r.pid), r.points, lb.byPid.get(r.pid)?.correct ?? 0] as Cell[])],
      });

    const people = [...names.entries()].filter(([, p]) => p.name || p.email);
    if (people.length)
      sheets.push({ name: "Participants", rows: [["Name", "Email", "Joined at", ...(teamName ? ["Team"] : [])], ...people.map(([pid, p]) => [p.name, p.email, new Date(p.joinedAt).toISOString(), ...(teamName ? [teamName(pid)] : [])] as Cell[])] });

    return buildXlsx(sheets);
  }

  // ---------- recap and AI helpers ----------

  /** The public recap page. Null unless the host chose to share it. */
  async recap(): Promise<Recap | null> {
    const ev = this.ev;
    if (!ev?.recap.public) return null;
    const count = (q: string) => this.sql.exec<{ n: number }>(q).one().n;
    const hide = ev.settings.hideNames;
    const replies = this.repliesFor(null);
    const questions = this.sql
      .exec<QuestionRow>("SELECT * FROM questions WHERE status IN ('live','answered') ORDER BY (votes - downs) DESC, ts ASC LIMIT 30")
      .toArray()
      .map((q) => ({
        text: ev.settings.profanity === "review" ? maskWords(q.text, ev.settings.blockedWords).text : q.text,
        name: hide ? "" : q.name,
        score: q.votes - (q.downs ?? 0),
        answered: q.status === "answered",
        replies: (replies.get(q.id) ?? []).filter((r) => r.official),
      }));
    // Only polls whose results the audience was allowed to see.
    const polls = this.allPolls()
      .filter((p) => p.status !== "draft" && (p.type === "quiz" ? p.revealed : p.showResults))
      .map((p) => ({ poll: this.pollView(p, "present"), results: this.results(p.id) }))
      .filter((x) => x.results.total > 0);
    const lb = this.leaderboard().board;
    return {
      code: ev.code,
      title: ev.title,
      createdAt: ev.createdAt,
      summary: ev.recap.summary,
      logo: ev.settings.logo,
      theme: ev.settings.theme,
      brand: ev.settings.brand ?? DEFAULT_BRAND,
      stats: {
        participants: count("SELECT COUNT(*) AS n FROM seen"),
        questions: count("SELECT COUNT(*) AS n FROM questions WHERE status != 'pending'"),
        votes: count("SELECT COUNT(*) AS n FROM votes"),
        answers: count("SELECT COUNT(*) AS n FROM responses"),
      },
      questions,
      polls,
      leaderboard: lb.rounds > 0 ? { ...lb, top: lb.top.slice(0, 10) } : null,
    };
  }

  private async aiGate(key: string) {
    if (!(await this.isHost(key))) throw new UserError("Forbidden");
    if (!aiAvailable(this.env)) throw new UserError("AI isn't set up on this server");
    if (!this.aiLimit.take("host")) throw new UserError("That's a lot of AI requests. Try again in a few minutes.");
  }

  /** Turns rough notes into poll drafts. The host reviews them before adding. */
  async aiPolls(key: string, text: string): Promise<PasteResult | { error: string }> {
    try {
      await this.aiGate(key);
      const notes = clean(text, LIMITS.pasteText);
      if (notes.length < 10) throw new UserError("Paste a few more lines of notes first");
      const out = await chat(this.env, POLLS_PROMPT, notes, 1200);
      const result = parsePolls(out);
      if (!result.polls.length) throw new UserError("The AI didn't come up with any polls. Try more detailed notes.");
      return result;
    } catch (e) {
      return { error: e instanceof UserError ? e.message : "The AI service didn't answer. Try again." };
    }
  }

  /** Drafts the recap summary from questions and poll results. The host edits before sharing. */
  async aiSummary(key: string): Promise<{ summary: string } | { error: string }> {
    try {
      await this.aiGate(key);
      const ev = this.ev!;
      const qs = this.sql
        .exec<QuestionRow>("SELECT * FROM questions WHERE status IN ('live','answered') ORDER BY (votes - downs) DESC LIMIT 40")
        .toArray();
      const replies = this.repliesFor(qs.map((q) => q.id));
      const qText = qs
        .map((q) => {
          const official = (replies.get(q.id) ?? []).filter((r) => r.official).map((r) => ` | host reply: ${r.text.slice(0, 200)}`).join("");
          return `- (${q.votes - (q.downs ?? 0)} votes${q.status === "answered" ? ", answered" : ", not answered"}) ${q.text}${official}`;
        })
        .join("\n");
      const pText = this.allPolls()
        .filter((p) => p.status !== "draft")
        .map((p) => (p.type === "survey" ? [`Survey: ${p.title}`, ...p.items.map((it, i) => resultsText(it, this.results(p.id).items?.[i] ?? { total: 0 }, 1))].join("\n") : resultsText(p, this.results(p.id))))
        .join("\n\n");
      if (!qs.length && !pText) throw new UserError("There's nothing to summarize yet");
      const data = `Event: ${ev.title}\n\nTop audience questions:\n${qText || "(none)"}\n\nPolls:\n${pText || "(none)"}`.slice(0, 12_000);
      const summary = (await chat(this.env, SUMMARY_PROMPT, data, 500)).slice(0, LIMITS.summary);
      return { summary };
    } catch (e) {
      return { error: e instanceof UserError ? e.message : "The AI service didn't answer. Try again." };
    }
  }

  // ---------- public API ----------

  private apiAllowed(key: string): boolean {
    const ev = this.ev;
    return !!ev && !!key && ((!!ev.api.key && safeEqual(key, ev.api.key)) || safeEqual(key, ev.hostKey));
  }

  /** Read-only JSON API. `path` is what comes after /api/v1/events/CODE. */
  async apiRead(key: string, path: string[], query: Record<string, string>): Promise<{ status: number; json: string }> {
    const r = this.apiData(key, path, query);
    return { status: r.status, json: JSON.stringify(r.body) };
  }

  private apiData(key: string, path: string[], query: Record<string, string>): { status: number; body: unknown } {
    if (!this.ev) return { status: 404, body: { error: "Event not found" } };
    if (!key) return { status: 401, body: { error: "Send your API key: Authorization: Bearer <key>" } };
    if (!this.apiAllowed(key)) return { status: 403, body: { error: "Wrong API key" } };
    const ev = this.ev;
    const count = (q: string) => this.sql.exec<{ n: number }>(q).one().n;
    const [what = "", id] = path;
    if (what === "" && !id)
      return {
        status: 200,
        body: {
          code: ev.code,
          title: ev.title,
          createdAt: ev.createdAt,
          online: this.onlineCount(),
          presentMode: ev.presentMode,
          activePollId: ev.activePollId,
          qaOpen: ev.settings.qaOpen,
          rooms: ev.rooms,
          labels: ev.labels,
          teams: ev.teams,
          counts: {
            questions: count("SELECT COUNT(*) AS n FROM questions"),
            polls: count("SELECT COUNT(*) AS n FROM polls"),
            participants: count("SELECT COUNT(*) AS n FROM seen"),
            responses: count("SELECT COUNT(*) AS n FROM responses"),
          },
        },
      };
    if (what === "questions" && !id) {
      const status = query.status && ["pending", "live", "answered", "archived"].includes(query.status) ? query.status : null;
      const rows = this.sql.exec<QuestionRow>(`SELECT * FROM questions ${status ? "WHERE status = ?" : ""} ORDER BY ts LIMIT 5000`, ...(status ? [status] : [])).toArray();
      const replies = this.repliesFor(null);
      const room = query.room;
      return { status: 200, body: { questions: rows.filter((q) => !room || q.room === room).map((q) => this.toQuestion(q, "host", replies.get(q.id) ?? [])) } };
    }
    if (what === "polls") {
      const polls = this.allPolls();
      if (!id) return { status: 200, body: { polls: polls.map((p) => ({ ...p, results: this.results(p.id) })) } };
      const p = polls.find((x) => x.id === id);
      if (!p) return { status: 404, body: { error: "Poll not found" } };
      const body: Record<string, unknown> = { poll: p, results: this.results(p.id) };
      if (query.responses === "1") {
        const names = this.participantNames();
        body.responses = this.sql
          .exec<ResponseRow>("SELECT pid, value, ts, elapsed FROM responses WHERE poll_id = ? ORDER BY ts LIMIT 10000", p.id)
          .toArray()
          .map((r) => ({ participant: r.pid, name: names.get(r.pid)?.name ?? "", value: JSON.parse(r.value), at: r.ts }));
      }
      return { status: 200, body };
    }
    if (what === "leaderboard" && !id) {
      const lb = this.leaderboard();
      const names = this.participantNames();
      return {
        status: 200,
        body: {
          rounds: lb.board.rounds,
          players: lb.ranked.map((r) => ({ rank: lb.rank.get(r.pid), participant: r.pid, name: names.get(r.pid)?.name ?? "", points: r.points, correct: lb.byPid.get(r.pid)?.correct ?? 0, team: this.teamOf(r.pid) ?? null })),
          teams: lb.board.teams ?? [],
        },
      };
    }
    if (what === "participants" && !id) {
      const rows = this.sql.exec<{ pid: string; name: string; email: string; joined_at: number; team: string | null }>("SELECT * FROM participants ORDER BY joined_at").toArray();
      return { status: 200, body: { participants: rows.map((r) => ({ id: r.pid, name: r.name, email: r.email, team: r.team, joinedAt: r.joined_at })) } };
    }
    return { status: 404, body: { error: "Not found. See docs/API.md for the endpoints." } };
  }

  // ---------- webhooks ----------

  private hook(type: WebhookEvent, data: unknown) {
    const w = this.ev?.api.webhook;
    if (!w || !w.events.includes(type)) return;
    if (this.hookQueue.length >= WEBHOOK_MAX_BATCH * 20) return; // receiver is far behind: drop rather than eat memory
    this.hookQueue.push({ type, at: Date.now(), data });
    this.scheduleWebhooks(WEBHOOK_BATCH_MS);
  }

  private hookQuestion(type: "question.created" | "question.updated", id: string) {
    const q = this.sql.exec<QuestionRow>("SELECT * FROM questions WHERE id = ?", id).toArray()[0];
    if (q) this.hook(type, { question: this.toQuestion(q, "host", this.repliesFor([id]).get(id) ?? []) });
  }

  private hookPoll(type: "poll.launched" | "poll.closed" | "poll.revealed", id: string) {
    const p = this.pollRow(id);
    if (p) this.hook(type, { poll: p, results: this.results(id) });
  }

  /** Turns a handled message into webhook events. */
  private webhookFor(msg: ClientMsg, pid: string, activeBefore: string | null) {
    switch (msg.type) {
      case "ask": {
        const q = this.sql.exec<{ id: string }>("SELECT id FROM questions WHERE pid = ? ORDER BY ts DESC LIMIT 1", pid).toArray()[0];
        if (q) this.hookQuestion("question.created", q.id);
        return;
      }
      case "editQuestion":
      case "approve":
      case "answer":
      case "archive":
      case "highlight":
      case "tagQuestion":
      case "moveQuestion":
        return this.hookQuestion("question.updated", msg.id);
      case "withdraw":
      case "deleteQuestion":
        return this.hook("question.deleted", { id: msg.id });
      case "mergeQuestion":
        this.hook("question.deleted", { id: msg.id, mergedInto: msg.into });
        return this.hookQuestion("question.updated", msg.into);
      case "reply": {
        const r = this.sql.exec<ReplyRow>("SELECT * FROM replies WHERE qid = ? AND pid = ? ORDER BY ts DESC LIMIT 1", msg.id, pid).toArray()[0];
        if (r) this.hook("reply.created", { questionId: r.qid, reply: { id: r.id, text: r.text, name: r.name, ts: r.ts, official: !!r.official } });
        return;
      }
      case "respond": {
        const r = this.sql.exec<ResponseRow>("SELECT pid, value, ts, elapsed FROM responses WHERE poll_id = ? AND pid = ?", msg.pollId, pid).toArray()[0];
        if (r) this.hook("response.created", { pollId: msg.pollId, participant: pid, name: this.participant(pid)?.name ?? "", value: JSON.parse(r.value), at: r.ts });
        return;
      }
      case "activatePoll":
        if (activeBefore && activeBefore !== msg.pollId) this.hookPoll("poll.closed", activeBefore);
        if (msg.pollId && this.ev!.activePollId === msg.pollId) this.hookPoll("poll.launched", msg.pollId);
        return;
      case "closePoll":
        return this.hookPoll("poll.closed", msg.pollId);
      case "revealAnswer":
        if (this.pollRow(msg.pollId)?.revealed) this.hookPoll("poll.revealed", msg.pollId);
        return;
    }
  }

  private scheduleWebhooks(ms: number) {
    if (this.hookTimer) {
      if (ms > 0) return;
      clearTimeout(this.hookTimer);
    }
    this.hookTimer = setTimeout(() => {
      this.hookTimer = null;
      void this.deliverWebhooks();
    }, ms);
  }

  /** Sends queued events in one signed POST. Retries once after 5 seconds if it fails. */
  private async deliverWebhooks(retry = false) {
    const w = this.ev?.api.webhook;
    if (!w || !this.hookQueue.length) return;
    const batch = this.hookQueue.splice(0, WEBHOOK_MAX_BATCH);
    const at = Date.now();
    const body = JSON.stringify({ event: this.ev!.code, sentAt: at, events: batch });
    let last: NonNullable<ApiSetup["webhook"]>["last"];
    try {
      const r = await fetch(w.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "RSlide-Webhooks/1",
          "x-rslide-event": this.ev!.code,
          "x-rslide-timestamp": String(at),
          "x-rslide-signature": await signWebhook(w.secret, at, body),
        },
        body,
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      last = { at, ok: r.ok, status: r.status, ...(r.ok ? {} : { error: `The server answered ${r.status}` }) };
    } catch (e) {
      last = { at, ok: false, status: 0, error: (e as Error).name === "TimeoutError" ? "No answer within 8 seconds" : "Couldn't reach that address" };
    }
    // The host may have removed or changed the webhook while we waited.
    if (this.ev?.api.webhook?.url !== w.url) return;
    this.ev.api.webhook.last = last;
    this.persistEvent();
    this.dirtyMeta = true;
    this.scheduleFlush();
    if (!last.ok && !retry) {
      this.hookQueue.unshift(...batch);
      setTimeout(() => void this.deliverWebhooks(true), 5000);
      return;
    }
    if (this.hookQueue.length) this.scheduleWebhooks(WEBHOOK_BATCH_MS);
  }

  async analytics(key: string): Promise<Analytics | null> {
    if (!(await this.isHost(key))) return null;
    this.saveActivity();
    const ev = this.ev!;
    const count = (q: string, ...args: unknown[]) => this.sql.exec<{ n: number }>(q, ...args).one().n;
    const minutes = new Map<number, Analytics["timeline"][number]>();
    let reactions = 0;
    for (const r of this.sql.exec<{ minute: number; kind: Activity; n: number }>("SELECT minute, kind, n FROM timeline ORDER BY minute")) {
      const row = minutes.get(r.minute) ?? { t: r.minute * 60_000, joins: 0, questions: 0, votes: 0, answers: 0, reactions: 0 };
      if (r.kind === "join") row.joins += r.n;
      else if (r.kind === "ask") row.questions += r.n;
      else if (r.kind === "vote") row.votes += r.n;
      else if (r.kind === "answer") row.answers += r.n;
      else if (r.kind === "react") row.reactions += r.n;
      if (r.kind === "react") reactions += r.n;
      minutes.set(r.minute, row);
    }
    const roomName = this.roomNamer();
    return {
      code: ev.code,
      title: ev.title,
      createdAt: ev.createdAt,
      participants: count("SELECT COUNT(*) AS n FROM seen"),
      peakOnline: Math.max(ev.stats.peakOnline, this.onlineCount()),
      peakAt: ev.stats.peakAt,
      questions: count("SELECT COUNT(*) AS n FROM questions"),
      askers: count("SELECT COUNT(DISTINCT pid) AS n FROM questions"),
      votes: count("SELECT COUNT(*) AS n FROM votes"),
      replies: count("SELECT COUNT(*) AS n FROM replies"),
      reactions,
      polls: this.allPolls()
        .filter((p) => p.status !== "draft")
        .map((p) => ({ id: p.id, title: p.title, type: p.type, responses: count("SELECT COUNT(*) AS n FROM responses WHERE poll_id = ?", p.id) })),
      timeline: [...minutes.values()],
      topQuestions: this.sql
        .exec<{ text: string; score: number; status: QuestionStatus }>("SELECT text, votes - downs AS score, status FROM questions ORDER BY score DESC, ts LIMIT 5")
        .toArray(),
      rooms: this.sql
        .exec<{ room: string; n: number }>("SELECT room, COUNT(*) AS n FROM questions GROUP BY room ORDER BY n DESC")
        .toArray()
        .map((r) => ({ name: roomName(r.room), questions: r.n })),
    };
  }

  // ---------- scheduled jobs (one alarm per event, set to whichever comes first) ----------

  private async scheduleAlarm() {
    const ev = this.ev;
    if (!ev) return;
    const s = ev.settings;
    const times = [ev.expiresAt, s.deleteAt, s.qaOpensAt, s.qaClosesAt].filter((t): t is number => typeof t === "number" && t > 0);
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
    else await this.ctx.storage.deleteAlarm();
  }

  /** Deletes everything: answers, questions, images. Everyone connected is told the event is gone. */
  private async destroy() {
    const ev = this.ev;
    if (!ev) return;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE.NOT_FOUND, "Event deleted");
      } catch {}
    }
    await this.deleteMedia(ev.code);
    this.ev = null;
    await this.ctx.storage.deleteAll();
  }

  async alarm() {
    const ev = this.ev;
    if (!ev) return;
    const now = Date.now();
    const s = ev.settings;
    if ((ev.expiresAt && now >= ev.expiresAt) || (s.deleteAt && now >= s.deleteAt)) {
      await this.destroy();
      return;
    }
    let changed = false;
    if (s.qaOpensAt && now >= s.qaOpensAt) {
      s.qaOpen = true;
      s.qaOpensAt = null;
      changed = true;
    }
    if (s.qaClosesAt && now >= s.qaClosesAt) {
      s.qaOpen = false;
      s.qaClosesAt = null;
      changed = true;
    }
    if (changed) {
      this.saveEvent();
      this.flush();
    }
    await this.scheduleAlarm();
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

    const ev = this.ev;
    if (!ev) return reject(CLOSE.NOT_FOUND, "Event not found");
    if (role === "host" && key !== ev.hostKey) return reject(CLOSE.FORBIDDEN, "Wrong host link");
    // The host link also works as a moderator link.
    if (role === "mod" && key !== ev.modKey && key !== ev.hostKey) return reject(CLOSE.FORBIDDEN, "This moderator link has expired");
    // The big screen is read-only. Without the key it sees what attendees see.
    if (role === "present" && key !== ev.hostKey) role = "attendee";
    if (role === "attendee" && ev.passcode && normPasscode(url.searchParams.get("pass")) !== ev.passcode) return reject(CLOSE.PASSCODE, "Passcode needed");
    const max = capacity(this.env, ev.plan ?? "free");
    if (role === "attendee" && max > 0 && this.ctx.getWebSockets("attendee").length >= max) return reject(CLOSE.FULL, "This event is full");

    this.ctx.acceptWebSocket(server, [role, `pid:${pid}`]);
    server.serializeAttachment({ role, pid } satisfies Attachment);
    if (role === "attendee") {
      const now = Date.now();
      const isNew = !this.sql.exec("SELECT 1 FROM seen WHERE pid = ?", pid).toArray().length;
      this.sql.exec("INSERT INTO seen (pid, first, last) VALUES (?,?,?) ON CONFLICT(pid) DO UPDATE SET last = excluded.last", pid, now, now);
      if (isNew) this.track("join");
    }
    this.send(server, {
      type: "hello",
      role,
      snapshot: this.snapshot(role, pid),
      me: this.me(pid),
      now: Date.now(),
      ...(role === "host" ? { hostKey: ev.hostKey } : {}),
    });
    this.scheduleOnline();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (!this.ev || typeof raw !== "string" || raw.length > 40_000) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const { role, pid } = ws.deserializeAttachment() as Attachment;
    // The big screen (opened with the host link) may only launch polls and switch what it shows,
    // so a slide add-in can start "its" poll when the slide comes up.
    if (role === "present" && msg.type !== "activatePoll" && msg.type !== "setPresentMode") return;
    const before = this.ev.api.webhook ? { active: this.ev.activePollId } : null;
    try {
      if (this.handleAudience(msg, pid, role)) {
        if (before) this.webhookFor(msg, pid, before.active);
        return;
      }
      if (isStaff(role) && this.handleModeration(msg)) {
        if (before) this.webhookFor(msg, pid, before.active);
        return;
      }
      if (role === "host" || role === "present") {
        this.handleHost(msg);
        if (before) this.webhookFor(msg, pid, before.active);
      }
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

  private teamOf(pid: string): string | undefined {
    return this.sql.exec<{ team: string | null }>("SELECT team FROM participants WHERE pid = ?", pid).toArray()[0]?.team ?? undefined;
  }

  private autoTeam(pid: string) {
    const counts = this.teamCounts();
    const team = [...this.ev!.teams].sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0))[0];
    this.sql.exec("INSERT INTO participants (pid, name, email, joined_at, team) VALUES (?,'','',?,?) ON CONFLICT(pid) DO UPDATE SET team = excluded.team", pid, Date.now(), team.id);
    this.invalidateLb();
    this.touchMe(pid);
  }

  private teamCounts(): Map<string, number> {
    const m = new Map<string, number>();
    for (const r of this.sql.exec<{ team: string; n: number }>("SELECT team, COUNT(*) AS n FROM participants WHERE team IS NOT NULL GROUP BY team")) m.set(r.team, r.n);
    return m;
  }

  /** True once they've answered any quiz question (so their team is locked in). */
  private playedQuiz(pid: string): boolean {
    return this.sql.exec("SELECT 1 FROM responses r JOIN polls p ON p.id = r.poll_id WHERE r.pid = ? AND p.type = 'quiz' LIMIT 1", pid).toArray().length > 0;
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
    if (isStaff(role)) return;
    if (!this.hasJoined(this.participant(pid)))
      throw new UserError(this.ev!.settings.identity === "email" ? "Please enter your name and email to take part" : "Please enter your name to take part");
  }

  // ---------- word filter ----------

  /** Applies the host's word filter. Staff are never filtered. */
  private filter(text: string, role: Role): { text: string; hit: boolean } {
    const s = this.ev!.settings;
    if (s.profanity === "off" || isStaff(role)) return { text, hit: false };
    return maskWords(text, s.blockedWords);
  }

  // ---------- rooms ----------

  private roomIds(): Set<string> {
    const rooms = this.ev!.rooms;
    return new Set(rooms.length ? rooms.map((r) => r.id) : [MAIN_ROOM]);
  }

  private roomNamer() {
    const names = new Map(this.ev!.rooms.map((r) => [r.id, r.name]));
    return (id: string) => names.get(id) ?? "Main";
  }

  /** The first room keeps the "main" ID so existing questions stay put. */
  private withMainRoom(rooms: Room[]): Room[] {
    if (!rooms.length || rooms.some((r) => r.id === MAIN_ROOM)) return rooms;
    return [{ ...rooms[0], id: MAIN_ROOM }, ...rooms.slice(1)];
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
        const raw = clean(msg.text, LIMITS.question);
        if (!raw) throw new UserError("Question is empty");
        let name = clean(msg.name, LIMITS.name);
        if (ev.settings.identity !== "none" && !isStaff(role)) name = this.participant(pid)?.name ?? name;
        if (!name && !ev.settings.allowAnonymous) throw new UserError("Please add your name");
        if (!isStaff(role) && !this.asksLimit.take(pid)) throw new UserError("Slow down a little — try again in a minute");
        const { text, hit } = this.filter(raw, role);
        const room = this.roomIds().has(String(msg.room)) ? String(msg.room) : [...this.roomIds()][0];
        const id = newId();
        const status: QuestionStatus = isStaff(role) ? "live" : ev.settings.moderation || (hit && ev.settings.profanity === "review") ? "pending" : "live";
        // In review mode the host sees the original words, so they can decide.
        const stored = ev.settings.profanity === "review" ? raw : text;
        this.sql.exec("INSERT INTO questions (id, text, name, pid, ts, status, room) VALUES (?,?,?,?,?,?,?)", id, stored, name, pid, Date.now(), status, room);
        // Remember the name they typed so it can show on the quiz leaderboard.
        if (name && !isStaff(role) && ev.settings.identity === "none") {
          this.sql.exec(
            "INSERT INTO participants (pid, name, email, joined_at) VALUES (?,?,'',?) ON CONFLICT(pid) DO UPDATE SET name = CASE WHEN participants.name = '' THEN excluded.name ELSE participants.name END",
            pid, name, Date.now(),
          );
          this.invalidateLb();
        }
        this.track("ask");
        this.checkDuplicate(id, raw, room);
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
        this.track("vote");
        this.touchQ(id);
        this.touchMe(pid);
        return true;
      }
      case "editQuestion": {
        const q = this.ownQuestion(msg.id, pid);
        if (q.status !== "pending" && q.status !== "live") throw new UserError("This question can't be edited any more");
        const raw = clean(msg.text, LIMITS.question);
        if (!raw) throw new UserError("Question is empty");
        const { text, hit } = this.filter(raw, role);
        const review = ev.settings.profanity === "review";
        const status = review && hit ? "pending" : q.status;
        this.sql.exec("UPDATE questions SET text = ?, edited = 1, status = ?, dup_of = NULL WHERE id = ?", review ? raw : text, status, q.id);
        this.sql.exec("DELETE FROM vectors WHERE qid = ?", q.id);
        this.prints.delete(q.id);
        this.checkDuplicate(q.id, raw, q.room);
        this.touchQ(q.id);
        return true;
      }
      case "withdraw": {
        const q = this.ownQuestion(msg.id, pid);
        this.removeQuestion(q.id);
        this.touchMe(pid);
        return true;
      }
      case "reply": {
        this.requireJoined(pid, role);
        const official = isStaff(role);
        if (!official && !ev.settings.audienceReplies) throw new UserError("Replies are turned off");
        const q = this.sql.exec<{ status: string }>("SELECT status FROM questions WHERE id = ?", String(msg.id)).toArray()[0];
        if (!q || (!official && (q.status === "pending" || q.status === "archived"))) throw new UserError("You can't reply to this question");
        const raw = clean(msg.text, LIMITS.reply);
        if (!raw) throw new UserError("Reply is empty");
        if (!official && !this.repliesLimit.take(pid)) throw new UserError("Slow down a little — try again in a minute");
        if (this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM replies WHERE qid = ?", msg.id).one().n >= LIMITS.replies)
          throw new UserError("This question has the most replies allowed");
        let name = clean(msg.name, LIMITS.name);
        if (!official && ev.settings.identity !== "none") name = this.participant(pid)?.name ?? name;
        if (official && !name) name = role === "host" ? "Host" : "Moderator";
        const id = newId();
        this.sql.exec("INSERT INTO replies (id, qid, text, name, pid, ts, official) VALUES (?,?,?,?,?,?,?)", id, msg.id, this.filter(raw, role).text, name, pid, Date.now(), official ? 1 : 0);
        this.track("reply");
        this.touchQ(msg.id);
        this.touchMe(pid);
        return true;
      }
      case "deleteReply": {
        const r = this.sql.exec<ReplyRow>("SELECT * FROM replies WHERE id = ? AND qid = ?", String(msg.replyId), String(msg.id)).toArray()[0];
        if (!r) return true;
        if (r.pid !== pid && !isStaff(role)) throw new UserError("You can only delete your own replies");
        this.sql.exec("DELETE FROM replies WHERE id = ?", r.id);
        this.touchQ(r.qid);
        this.touchMe(r.pid);
        return true;
      }
      case "respond": {
        this.requireJoined(pid, role);
        if (!this.votesLimit.take(pid)) throw new UserError("Too many clicks — slow down a little");
        const p = this.pollRow(String(msg.pollId));
        if (!p || p.status !== "active") throw new UserError("This poll is not open");
        const now = Date.now();
        let elapsed: number | null = null;
        const selfPaced = ev.settings.selfPaced;
        if (p.type === "quiz") {
          if (p.revealed) throw new UserError("Answers are closed — the answer has been revealed");
          // Self-paced quizzes have no shared clock, so no timer.
          if (!selfPaced && p.timeLimit && p.startedAt && now > p.startedAt + p.timeLimit * 1000 + QUIZ_GRACE_MS) throw new UserError("Time's up!");
          if (this.sql.exec("SELECT 1 FROM responses WHERE poll_id = ? AND pid = ?", p.id, pid).toArray().length) throw new UserError("You've already answered this one");
          // No team yet: join the smallest one, so nobody loses quiz time picking.
          if (ev.teams.length && !isStaff(role) && !this.teamOf(pid)) this.autoTeam(pid);
          elapsed = selfPaced ? 0 : p.startedAt ? Math.max(0, now - p.startedAt) : 0;
        }
        const value = this.filterAnswer(p, validateResponse(p, msg.value), role);
        this.sql.exec(
          "INSERT INTO responses (poll_id, pid, value, ts, elapsed) VALUES (?,?,?,?,?) ON CONFLICT(poll_id, pid) DO UPDATE SET value = excluded.value, ts = excluded.ts",
          p.id, pid, JSON.stringify(value), now, elapsed,
        );
        this.track("answer");
        this.touchR(p.id);
        this.touchMe(pid);
        if (selfPaced && p.type === "quiz") this.invalidateLb();
        return true;
      }
      case "joinTeam": {
        if (!ev.teams.length) throw new UserError("This event doesn't have teams");
        this.requireJoined(pid, role);
        const counts = this.teamCounts();
        const team = msg.team === "auto" ? [...ev.teams].sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0))[0].id : String(msg.team);
        if (!ev.teams.some((t) => t.id === team)) throw new UserError("That team doesn't exist any more");
        const cur = this.teamOf(pid);
        if (cur === team) return true;
        if (cur && this.playedQuiz(pid)) throw new UserError("You've already played for your team");
        this.sql.exec(
          "INSERT INTO participants (pid, name, email, joined_at, team) VALUES (?,'','',?,?) ON CONFLICT(pid) DO UPDATE SET team = excluded.team",
          pid, Date.now(), team,
        );
        this.invalidateLb();
        this.touchMe(pid);
        return true;
      }
      case "react": {
        if (!ev.settings.reactions) return true;
        if (!REACTIONS.includes(msg.emoji)) return true;
        if (!this.reactLimit.take(pid)) return true; // silently drop spam
        this.reactionCounts.set(msg.emoji, (this.reactionCounts.get(msg.emoji) ?? 0) + 1);
        this.track("react");
        this.scheduleFlush();
        return true;
      }
      default:
        return false;
    }
  }

  /** Masks free text in answers. Filtered word-cloud words are dropped, not shown as stars. */
  private filterAnswer(p: Poll, value: ResponseValue, role: Role): ResponseValue {
    if (this.ev!.settings.profanity === "off" || isStaff(role)) return value;
    const one = (type: string, v: unknown): unknown => {
      if (type === "open" && typeof v === "string") return this.filter(v, role).text;
      if (type === "wordcloud" && Array.isArray(v)) {
        const kept = (v as string[]).filter((w) => !this.filter(w, role).hit);
        if (!kept.length) throw new UserError("Please choose a different word");
        return kept;
      }
      return v;
    };
    if (p.type === "survey") return (value as unknown[]).map((v, i) => (v === null ? null : one(p.items[i].type, v))) as ResponseValue;
    return one(p.type, value) as ResponseValue;
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
    for (const r of this.sql.exec<{ pid: string }>("DELETE FROM replies WHERE qid = ? RETURNING pid", id)) this.dirtyMe.add(r.pid);
    this.sql.exec("DELETE FROM votes WHERE qid = ?", id);
    this.sql.exec("DELETE FROM questions WHERE id = ?", id);
    this.sql.exec("DELETE FROM vectors WHERE qid = ?", id);
    this.prints.delete(id);
    for (const r of this.sql.exec<{ id: string }>("UPDATE questions SET dup_of = NULL WHERE dup_of = ? RETURNING id", id)) this.touchQ(r.id);
    this.deletedQ.add(id);
    this.dirtyQ.delete(id);
    this.scheduleFlush();
  }

  // ---------- smart Q&A ----------

  private printOf(id: string, text: string): Fingerprint {
    let f = this.prints.get(id);
    if (!f) this.prints.set(id, (f = fingerprint(text)));
    return f;
  }

  /**
   * Marks a new question as a likely repeat of an earlier one in the same room.
   * Word matching runs right away; if the host turned on AI help, an AI check follows.
   */
  private checkDuplicate(id: string, text: string, room: string) {
    const others = this.sql
      .exec<{ id: string; text: string }>("SELECT id, text FROM questions WHERE room = ? AND id != ? AND status != 'archived' AND dup_of IS NULL ORDER BY ts DESC LIMIT 1000", room, id)
      .toArray();
    if (!others.length) return;
    const mine = fingerprint(text);
    this.prints.set(id, mine);
    let best: { id: string; score: number } | null = null;
    for (const o of others) {
      const score = similarity(mine, this.printOf(o.id, o.text));
      if (score >= DUPLICATE_SCORE && (!best || score > best.score)) best = { id: o.id, score };
    }
    if (best) this.sql.exec("UPDATE questions SET dup_of = ? WHERE id = ?", best.id, id);
    if (this.ev!.settings.aiAssist && aiAvailable(this.env)) void this.aiDuplicate(id, text, room, !best);
  }

  /** Embeds the question; if no word match was found, compares it with stored vectors. */
  private async aiDuplicate(id: string, text: string, room: string, look: boolean) {
    let vec: number[];
    try {
      [vec] = await embed(this.env, [text]);
    } catch (e) {
      console.warn("AI duplicate check skipped:", (e as Error).message);
      return;
    }
    // The question may have been removed while we waited.
    const q = this.sql.exec<{ dup_of: string | null; room: string }>("SELECT dup_of, room FROM questions WHERE id = ?", id).toArray()[0];
    if (!q) return;
    if (look && !q.dup_of) {
      let best: { id: string; score: number } | null = null;
      for (const r of this.sql.exec<{ qid: string; vec: ArrayBuffer }>("SELECT v.qid, v.vec FROM vectors v JOIN questions q ON q.id = v.qid WHERE v.room = ? AND q.status != 'archived' AND q.dup_of IS NULL", room)) {
        const score = vectorScore(vec, unpackVector(r.vec));
        if (score >= AI_DUPLICATE_SCORE && (!best || score > best.score)) best = { id: r.qid, score };
      }
      if (best) {
        this.sql.exec("UPDATE questions SET dup_of = ? WHERE id = ?", best.id, id);
        this.touchQ(id);
      }
    }
    this.sql.exec("INSERT OR REPLACE INTO vectors (qid, room, vec) VALUES (?,?,?)", id, q.room, packVector(vec));
  }

  /** Folds one question into another: its votes, its asker's support and its replies move over. */
  private mergeQuestion(id: string, into: string) {
    if (id === into) throw new UserError("Pick a different question to merge into");
    const src = this.sql.exec<QuestionRow>("SELECT * FROM questions WHERE id = ?", id).toArray()[0];
    const dst = this.sql.exec<QuestionRow>("SELECT * FROM questions WHERE id = ?", into).toArray()[0];
    if (!src || !dst) throw new UserError("That question was removed");
    const moved = this.sql.exec<{ pid: string }>("SELECT pid FROM votes WHERE qid = ?", id).toArray().map((r) => r.pid);
    this.sql.exec("INSERT OR IGNORE INTO votes (qid, pid, v) SELECT ?, pid, v FROM votes WHERE qid = ?", into, id);
    // Asking the same thing counts as an upvote.
    if (src.pid !== dst.pid) this.sql.exec("INSERT OR IGNORE INTO votes (qid, pid, v) VALUES (?,?,1)", into, src.pid);
    this.sql.exec("UPDATE replies SET qid = ? WHERE qid = ?", into, id);
    // Merging is a moderation decision, so the kept question goes live.
    if (dst.status === "pending") this.sql.exec("UPDATE questions SET status = 'live' WHERE id = ?", into);
    // Other repeats of the removed question now point at the kept one.
    for (const r of this.sql.exec<{ id: string }>("UPDATE questions SET dup_of = ? WHERE dup_of = ? AND id != ? RETURNING id", into, id, into)) this.touchQ(r.id);
    if (src.highlighted && !dst.highlighted) this.sql.exec("UPDATE questions SET highlighted = 1 WHERE id = ?", into);
    this.removeQuestion(id);
    this.recountVotes(into);
    this.touchQ(into);
    for (const p of new Set([...moved, src.pid])) this.touchMe(p);
  }

  // ---------- moderation (host and moderators) ----------

  /** Returns true if handled. */
  private handleModeration(msg: ClientMsg): boolean {
    switch (msg.type) {
      case "approve":
        this.sql.exec("UPDATE questions SET status = 'live' WHERE id = ? AND status = 'pending'", msg.id);
        this.touchQ(msg.id);
        return true;
      case "answer":
        this.sql.exec(
          "UPDATE questions SET status = CASE status WHEN 'answered' THEN 'live' ELSE 'answered' END, highlighted = 0 WHERE id = ? AND status IN ('live','answered')",
          msg.id,
        );
        this.touchQ(msg.id);
        return true;
      case "archive":
        this.sql.exec("UPDATE questions SET status = CASE status WHEN 'archived' THEN 'live' ELSE 'archived' END, highlighted = 0 WHERE id = ?", msg.id);
        this.touchQ(msg.id);
        return true;
      case "highlight": {
        const cur = this.sql.exec<{ highlighted: number }>("SELECT highlighted FROM questions WHERE id = ?", msg.id).toArray()[0];
        if (!cur) return true;
        for (const r of this.sql.exec<{ id: string }>("UPDATE questions SET highlighted = 0 WHERE highlighted = 1 RETURNING id")) this.touchQ(r.id);
        if (!cur.highlighted) this.sql.exec("UPDATE questions SET highlighted = 1, status = CASE status WHEN 'pending' THEN 'live' ELSE status END WHERE id = ?", msg.id);
        this.touchQ(msg.id);
        return true;
      }
      case "deleteQuestion":
        this.removeQuestion(msg.id);
        return true;
      case "tagQuestion": {
        if (!this.ev!.labels.some((l) => l.id === msg.label)) throw new UserError("That label doesn't exist any more");
        const q = this.sql.exec<{ labels: string }>("SELECT labels FROM questions WHERE id = ?", msg.id).toArray()[0];
        if (!q) return true;
        const cur = JSON.parse(q.labels) as string[];
        const next = cur.includes(msg.label) ? cur.filter((l) => l !== msg.label) : [...cur, msg.label];
        this.sql.exec("UPDATE questions SET labels = ? WHERE id = ?", JSON.stringify(next), msg.id);
        this.touchQ(msg.id);
        return true;
      }
      case "moveQuestion":
        if (!this.roomIds().has(msg.room)) throw new UserError("That room doesn't exist");
        this.sql.exec("UPDATE questions SET room = ?, dup_of = NULL WHERE id = ?", msg.room, msg.id);
        this.sql.exec("UPDATE vectors SET room = ? WHERE qid = ?", msg.room, msg.id);
        this.touchQ(msg.id);
        return true;
      case "mergeQuestion":
        this.mergeQuestion(String(msg.id), String(msg.into));
        return true;
      case "notDuplicate":
        this.sql.exec("UPDATE questions SET dup_of = NULL WHERE id = ?", msg.id);
        this.touchQ(msg.id);
        return true;
      default:
        return false;
    }
  }

  // ---------- host actions ----------

  /** Checks everything first, then saves, so a bad value never leaves settings half-changed. */
  private applySettings(s: Partial<Settings>) {
    const cur = { ...this.ev!.settings };
    for (const k of BOOL_SETTINGS) if (typeof s[k] === "boolean") cur[k] = s[k]!;
    if (s.identity && IDENTITIES.includes(s.identity)) cur.identity = s.identity;
    if (s.theme && THEMES.includes(s.theme)) cur.theme = s.theme;
    if (s.screen === "light" || s.screen === "dark") cur.screen = s.screen;
    if (s.profanity && PROFANITY.includes(s.profanity)) cur.profanity = s.profanity;
    if (s.blockedWords !== undefined) cur.blockedWords = cleanBlockedWords(s.blockedWords);
    if (s.logo !== undefined) cur.logo = isMediaId(s.logo) ? s.logo : null;
    if (s.brand !== undefined) cur.brand = cleanBrand(s.brand, cur.brand ?? DEFAULT_BRAND);
    if (s.deckUrl !== undefined) cur.deckUrl = cleanDeckUrl(s.deckUrl);
    const time = (v: unknown) => (v === null ? null : typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined);
    for (const k of ["qaOpensAt", "qaClosesAt", "deleteAt"] as const) {
      if (!(k in s)) continue;
      const t = time(s[k]);
      if (t !== undefined) cur[k] = t;
    }
    if (cur.qaOpensAt && cur.qaClosesAt && cur.qaClosesAt <= cur.qaOpensAt) throw new UserError("Closing time must be after opening time");
    if (cur.identity !== this.ev!.settings.identity) this.dirtyAllMe = true; // "joined" depends on this
    this.ev!.settings = cur;
  }

  private handleHost(msg: ClientMsg) {
    const ev = this.ev!;
    switch (msg.type) {
      case "deleteEvent":
        if (String(msg.confirm ?? "").trim().toUpperCase() !== ev.code) throw new UserError("Type the event code to confirm");
        void this.destroy();
        return;
      case "setApiKey":
        ev.api.key = msg.on ? newApiKey() : null;
        return this.saveEvent();
      case "setWebhook": {
        const url = checkWebhookUrl(msg.url, this.env.WEBHOOK_ALLOW_PRIVATE === "1");
        ev.api.webhook = { url, secret: ev.api.webhook?.secret ?? newSecret(), events: cleanWebhookEvents(msg.events), last: ev.api.webhook?.url === url ? ev.api.webhook.last : null };
        return this.saveEvent();
      }
      case "removeWebhook":
        ev.api.webhook = null;
        this.hookQueue = [];
        return this.saveEvent();
      case "testWebhook":
        if (!ev.api.webhook) throw new UserError("Add a webhook address first");
        this.hookQueue.push({ type: "ping", at: Date.now(), data: { message: "Test from RSlide. Your webhook works." } });
        return this.scheduleWebhooks(0);
      case "setRecap":
        if (typeof msg.public === "boolean") ev.recap.public = msg.public;
        if (typeof msg.summary === "string") ev.recap.summary = msg.summary.replace(/\r\n?/g, "\n").trim().slice(0, LIMITS.summary);
        return this.saveEvent();
      case "setTitle":
        ev.title = clean(msg.title, LIMITS.title) || ev.title;
        return this.saveEvent();
      case "setSettings": {
        const before = JSON.stringify([ev.settings.qaOpensAt, ev.settings.qaClosesAt, ev.settings.deleteAt]);
        this.applySettings(msg.settings ?? {});
        // Hiding or showing names changes every question.
        if (msg.settings && "hideNames" in msg.settings) this.touchAllQuestions();
        if (msg.settings && "selfPaced" in msg.settings) this.paceChanged();
        this.saveEvent();
        if (JSON.stringify([ev.settings.qaOpensAt, ev.settings.qaClosesAt, ev.settings.deleteAt]) !== before) this.ctx.waitUntil(this.scheduleAlarm());
        return;
      }
      case "setPasscode":
        ev.passcode = normPasscode(msg.passcode);
        return this.saveEvent();
      case "setPresentMode":
        if (PRESENT_MODES.includes(msg.mode)) ev.presentMode = msg.mode;
        return this.saveEvent();
      case "newModKey":
        ev.modKey = newHostKey();
        for (const ws of this.ctx.getWebSockets("mod")) {
          try {
            ws.close(CLOSE.FORBIDDEN, "Moderator link changed");
          } catch {}
        }
        return this.saveEvent();
      case "setTeams": {
        ev.teams = cleanLabels(msg.teams, newId);
        const keep = ev.teams.map((t) => t.id);
        // People on a removed team go back to having none.
        if (keep.length) this.sql.exec(`UPDATE participants SET team = NULL WHERE team IS NOT NULL AND team NOT IN (${keep.map(() => "?").join(",")})`, ...keep);
        else this.sql.exec("UPDATE participants SET team = NULL WHERE team IS NOT NULL");
        this.invalidateLb();
        this.dirtyAllMe = true;
        return this.saveEvent();
      }
      case "setLabels": {
        ev.labels = cleanLabels(msg.labels, newId);
        const keep = new Set(ev.labels.map((l) => l.id));
        for (const q of this.sql.exec<{ id: string; labels: string }>("SELECT id, labels FROM questions WHERE labels != '[]'").toArray()) {
          const cur = JSON.parse(q.labels) as string[];
          const next = cur.filter((l) => keep.has(l));
          if (next.length !== cur.length) {
            this.sql.exec("UPDATE questions SET labels = ? WHERE id = ?", JSON.stringify(next), q.id);
            this.touchQ(q.id);
          }
        }
        return this.saveEvent();
      }
      case "setRooms": {
        ev.rooms = this.withMainRoom(cleanRooms(msg.rooms, newId));
        // Questions in a room that was removed move to the first room.
        const ids = [...this.roomIds()];
        for (const r of this.sql.exec<{ id: string }>(`UPDATE questions SET room = ? WHERE room NOT IN (${ids.map(() => "?").join(",")}) RETURNING id`, ids[0], ...ids)) this.touchQ(r.id);
        return this.saveEvent();
      }
      case "clearQuestions":
        for (const r of this.sql.exec<{ id: string }>("DELETE FROM questions RETURNING id")) {
          this.deletedQ.add(r.id);
          this.dirtyQ.delete(r.id);
        }
        this.sql.exec("DELETE FROM votes");
        this.sql.exec("DELETE FROM replies");
        this.sql.exec("DELETE FROM vectors");
        this.prints.clear();
        this.dirtyAllMe = true;
        return this.scheduleFlush();

      case "savePoll": {
        const d = validatePoll(msg.poll);
        const existing = msg.poll.id ? this.pollRow(msg.poll.id) : null;
        if (existing) {
          const shape = (p: Pick<Poll, "type" | "options" | "range" | "items" | "axes" | "image">) =>
            JSON.stringify([p.type, p.options, p.range, p.axes, p.image, p.items.map((i) => [i.type, i.options, i.range, i.axes, i.image])]);
          const structural = shape(existing) !== shape(d);
          this.sql.exec(
            "UPDATE polls SET type=?, title=?, options=?, correct=?, multi=?, scale=?, images=?, range=?, time_limit=?, items=?, axes=?, image=? WHERE id=?",
            ...this.pollCols(d),
            existing.id,
          );
          if (structural) this.clearResponses(existing.id);
          this.touchP(existing.id);
          this.touchR(existing.id);
          if (existing.type === "quiz" || d.type === "quiz") this.invalidateLb();
        } else this.insertPoll(d);
        return;
      }
      case "importPolls": {
        const list = Array.isArray(msg.polls) ? msg.polls.slice(0, LIMITS.importPolls) : [];
        const clean = list.map((p) => validatePoll(p)); // all or nothing, so a half-added template never happens
        for (const d of clean) this.insertPoll(d);
        return;
      }
      case "duplicatePoll": {
        const p = this.pollRow(msg.pollId);
        if (!p) return;
        this.insertPoll({ ...p, title: `${p.title} (copy)`.slice(0, LIMITS.question), correct: p.correct ?? [] });
        return;
      }
      case "activatePoll": {
        // Self-paced: opening a poll leaves the others open too.
        if (ev.settings.selfPaced) {
          const p = msg.pollId ? this.pollRow(msg.pollId) : null;
          if (p && p.status !== "active") {
            this.sql.exec("UPDATE polls SET status = 'active', started_at = ? WHERE id = ?", Date.now(), p.id);
            this.touchP(p.id);
            this.touchR(p.id);
          }
          return;
        }
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

  private pollCols(d: CleanPoll): (string | number | null)[] {
    return [
      d.type,
      d.title,
      JSON.stringify(d.options),
      JSON.stringify(d.correct),
      d.multi ? 1 : 0,
      d.scale,
      JSON.stringify(d.images),
      JSON.stringify(d.range),
      d.timeLimit,
      JSON.stringify(d.items),
      JSON.stringify(d.axes),
      d.image,
    ];
  }

  private insertPoll(d: CleanPoll) {
    const id = newId();
    const ord = (this.sql.exec<{ m: number | null }>("SELECT MAX(ord) AS m FROM polls").one().m ?? -1) + 1;
    this.sql.exec(
      "INSERT INTO polls (type, title, options, correct, multi, scale, images, range, time_limit, items, axes, image, id, ord, status, show_results, revealed, ts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft', 1, 0, ?)",
      ...this.pollCols(d),
      id,
      ord,
      Date.now(),
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
    const items = (JSON.parse(r.items || "[]") as Partial<Item>[]).map((it) => ({ ...it, axes: it.axes ?? null, image: it.image ?? null }) as Item);
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
      axes: JSON.parse(r.axes || "null"),
      image: r.image ?? null,
      status: r.status,
      showResults: !!r.show_results,
      revealed: !!r.revealed,
      timeLimit: r.time_limit ?? 0,
      startedAt: r.started_at ?? null,
      items,
    };
  }

  /** Replies grouped by question. `ids` null = all questions. */
  private repliesFor(ids: string[] | null): Map<string, Reply[]> {
    const m = new Map<string, Reply[]>();
    const add = (r: ReplyRow) => {
      const list = m.get(r.qid) ?? [];
      list.push({ id: r.id, text: r.text, name: r.name, ts: r.ts, official: !!r.official });
      m.set(r.qid, list);
    };
    if (ids === null) for (const r of this.sql.exec<ReplyRow>("SELECT * FROM replies ORDER BY ts")) add(r);
    else
      for (let i = 0; i < ids.length; i += 90) {
        const chunk = ids.slice(i, i + 90);
        for (const r of this.sql.exec<ReplyRow>(`SELECT * FROM replies WHERE qid IN (${chunk.map(() => "?").join(",")}) ORDER BY ts`, ...chunk)) add(r);
      }
    return m;
  }

  private toQuestion(r: QuestionRow, role: Role, replies: Reply[]): Question {
    const hide = this.ev!.settings.hideNames && !isStaff(role);
    const mask = this.ev!.settings.profanity === "review" && !isStaff(role);
    return {
      id: r.id,
      text: mask ? maskWords(r.text, this.ev!.settings.blockedWords).text : r.text,
      name: hide ? "" : r.name,
      ts: r.ts,
      votes: r.votes,
      downs: r.downs ?? 0,
      status: r.status,
      highlighted: !!r.highlighted,
      edited: !!r.edited,
      room: r.room ?? MAIN_ROOM,
      labels: JSON.parse(r.labels || "[]"),
      replies: hide ? replies.map((x) => (x.official ? x : { ...x, name: "" })) : replies,
      ...(r.dup_of && isStaff(role) ? { dupOf: r.dup_of } : {}),
    };
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
      if (r.scores) {
        const unit = it.type === "points" ? "avg points given" : "avg ranking points";
        it.options.map((o, i) => [o, r.scores![i]] as const).sort((a, b) => b[1] - a[1]).forEach(([o, s]) => rows.push([poll, kind, `${o} (${unit})`, s, status]));
      } else if (r.pairs) {
        const [ax, ay] = it.axes ?? ["X", "Y"];
        it.options.forEach((o, i) => rows.push([poll, kind, `${o} (${ax} / ${ay})`, `${r.pairs![i][0]} / ${r.pairs![i][1]}`, status]));
      } else if (r.pins) rows.push([poll, kind, "Pins dropped", r.pins.length, status]);
      else if (r.counts) {
        const labels =
          it.type === "rating" ? r.counts.map((_, i) => `${i + 1} stars`) : it.type === "scale" ? r.counts.map((_, i) => String((it.range?.min ?? 1) + i)) : it.options;
        labels.forEach((o, i) => rows.push([poll, kind, o, r.counts![i], status]));
        if (r.avg !== undefined) rows.push([poll, kind, "Average", r.avg, status]);
      } else if (r.words) r.words.forEach(([w, c]) => rows.push([poll, kind, w, c, status]));
      else if (r.answers) r.answers.forEach((a) => rows.push([poll, kind, a, "", status]));
      rows.push([poll, kind, "Total responses", r.total, status]);
    };
    for (const p of this.allPolls()) {
      const r = this.results(p.id);
      if (p.type === "survey") p.items.forEach((it, i) => add(`${p.title} — ${it.title}`, it, r.items?.[i] ?? { total: 0 }, p.status));
      else add(p.title, { ...p, options: p.options.map((o, i) => (p.correct?.includes(i) ? `${o} ✓` : o)) } as unknown as Item, r, p.status);
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
    // Self-paced quizzes count as soon as people answer (each person sees their own result).
    const self = !!this.ev?.settings.selfPaced;
    const quizzes = this.allPolls().filter((p) => p.type === "quiz" && (p.revealed || (self && p.status !== "draft")));
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
    const teamIds = this.ev?.teams.length ? new Map(this.sql.exec<{ pid: string; team: string }>("SELECT pid, team FROM participants WHERE team IS NOT NULL").toArray().map((r) => [r.pid, r.team])) : null;
    const top = ranked.slice(0, 10).map((r) => ({
      name: names.get(r.pid)?.name || `Player ${r.pid.slice(-4).toUpperCase()}`,
      points: r.points,
      correct: byPid.get(r.pid)!.correct,
      ...(teamIds?.get(r.pid) ? { team: teamIds.get(r.pid) } : {}),
    }));
    const board: Leaderboard = { top, players: ranked.length, rounds: quizzes.length };
    if (teamIds) board.teams = teamScores(this.ev!.teams, teamIds, byPid);
    this.lbCache = { board, byPid, perPoll, ranked, rank };
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
      replies: this.sql.exec<{ id: string }>("SELECT id FROM replies WHERE pid = ?", pid).toArray().map((r) => r.id),
      responses,
      quiz,
      team: this.ev?.teams.length ? (this.teamOf(pid) ?? null) : null,
      ...(this.ev?.settings.selfPaced ? { checked: this.checkedFor(pid, responses) } : {}),
    };
  }

  /** Self-paced: the right answers to the quizzes this person has answered, so they see how they did. */
  private checkedFor(pid: string, responses: Record<string, ResponseValue>): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const p of this.allPolls()) if (p.type === "quiz" && p.id in responses) out[p.id] = p.correct ?? [];
    return out;
  }

  /** Switching between live and self-paced. */
  private paceChanged() {
    const ev = this.ev!;
    if (ev.settings.selfPaced) {
      // The live poll stays open; there's just no "current" poll any more.
      ev.activePollId = null;
    } else {
      // Back to live: close everything that was open, the host launches one at a time again.
      for (const r of this.sql.exec<{ id: string }>("UPDATE polls SET status = 'closed' WHERE status = 'active' RETURNING id")) {
        this.touchP(r.id);
        this.touchR(r.id);
      }
      ev.activePollId = null;
    }
    this.invalidateLb();
    this.dirtyAllMe = true;
  }

  private metaView(role: Role): Meta {
    const ev = this.ev!;
    const settings = { ...ev.settings };
    // Attendees don't need the host's private word list.
    if (role !== "host") settings.blockedWords = [];
    return {
      code: ev.code,
      title: ev.title,
      settings,
      presentMode: ev.presentMode,
      activePollId: ev.activePollId,
      labels: ev.labels,
      rooms: ev.rooms,
      teams: ev.teams,
      recapPublic: ev.recap.public,
      ...(role === "host" ? { passcode: ev.passcode, modKey: ev.modKey, ai: aiAvailable(this.env), recapSummary: ev.recap.summary, api: ev.api, capacity: capacity(this.env, ev.plan ?? "free"), plan: ev.plan ?? "free" } : {}),
    };
  }

  // ---------- who sees what ----------

  private questionVisible(q: { status: QuestionStatus; pid?: string }, role: Role, pid?: string): boolean {
    if (isStaff(role)) return true;
    if (q.status === "archived") return false;
    if (q.status === "pending") return !!pid && q.pid === pid;
    return true;
  }

  private pollVisible(p: Poll, role: Role): boolean {
    // The big screen (host link) gets every poll, so a slide can show or start "its" poll.
    return role === "host" || role === "present" || p.status === "active";
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
    const rows = this.sql
      .exec<QuestionRow>("SELECT * FROM questions ORDER BY ts")
      .toArray()
      .filter((q) => this.questionVisible(q, role, pid));
    const replies = this.repliesFor(null);
    const polls = this.allPolls().filter((p) => this.pollVisible(p, role));
    const results: Record<string, Results> = {};
    for (const p of polls) if (p.status !== "draft") results[p.id] = this.resultsView(p, role);
    return {
      meta: this.metaView(role),
      questions: rows.map((q) => this.toQuestion(q, role, replies.get(q.id) ?? [])),
      polls: polls.map((p) => this.pollView(p, role)),
      results,
      leaderboard: this.leaderboard().board,
      online: this.onlineCount(),
    };
  }

  // ---------- analytics ----------

  private track(kind: Activity) {
    const key = `${Math.floor(Date.now() / 60_000)}|${kind}`;
    this.activity.set(key, (this.activity.get(key) ?? 0) + 1);
    this.scheduleFlush();
  }

  private saveActivity() {
    for (const [key, n] of this.activity) {
      const [minute, kind] = key.split("|");
      this.sql.exec("INSERT INTO timeline (minute, kind, n) VALUES (?,?,?) ON CONFLICT(minute, kind) DO UPDATE SET n = n + excluded.n", Number(minute), kind, n);
    }
    this.activity.clear();
  }

  // ---------- batching and sending ----------

  private touchQ(id: string) {
    this.dirtyQ.add(id);
    this.scheduleFlush();
  }
  private touchAllQuestions() {
    for (const r of this.sql.exec<{ id: string }>("SELECT id FROM questions")) this.dirtyQ.add(r.id);
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
    this.saveActivity();
    const qRows: QuestionRow[] = [];
    const ids = [...this.dirtyQ];
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      qRows.push(...this.sql.exec<QuestionRow>(`SELECT * FROM questions WHERE id IN (${chunk.map(() => "?").join(",")})`, ...chunk).toArray());
    }
    // A question that was touched but no longer exists counts as deleted.
    const found = new Set(qRows.map((q) => q.id));
    for (const id of this.dirtyQ) if (!found.has(id)) this.deletedQ.add(id);
    const replies = qRows.length ? this.repliesFor(qRows.map((q) => q.id)) : new Map<string, Reply[]>();

    const polls = [...new Set([...this.dirtyP, ...this.dirtyR])].map((id) => this.pollRow(id)).filter((p): p is Poll => !!p);
    for (const id of this.dirtyP) if (!polls.find((p) => p.id === id)) this.deletedP.add(id);
    const board = this.dirtyLb ? this.leaderboard().board : null;

    const base = (role: Role): Op[] => {
      const ops: Op[] = [];
      if (this.dirtyMeta) ops.push({ k: "meta", d: this.metaView(role) });
      for (const q of qRows) ops.push(this.questionVisible(q, role) ? { k: "q", d: this.toQuestion(q, role, replies.get(q.id) ?? []) } : { k: "q-", id: q.id });
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
      const sockets = this.ctx.getWebSockets(role);
      if (!sockets.length) continue;
      const ops = base(role);
      if (!ops.length) continue;
      const msg = JSON.stringify({ type: "patch", ops } satisfies ServerMsg);
      for (const ws of sockets) this.sendRaw(ws, msg);
    }

    // Authors see their own questions while they wait for approval.
    const pendingByAuthor = new Map<string, Question[]>();
    for (const q of qRows)
      if (q.status === "pending") pendingByAuthor.set(q.pid, [...(pendingByAuthor.get(q.pid) ?? []), this.toQuestion(q, "attendee", replies.get(q.id) ?? [])]);
    for (const [pid, qs] of pendingByAuthor) {
      const msg = JSON.stringify({ type: "patch", ops: qs.map((d) => ({ k: "q", d })) } satisfies ServerMsg);
      for (const ws of this.ctx.getWebSockets(`pid:${pid}`)) {
        if (!isStaff((ws.deserializeAttachment() as Attachment).role)) this.sendRaw(ws, msg);
      }
    }

    // Personal data (own votes, answers, quiz score).
    const mePids = this.dirtyAllMe ? new Set(this.ctx.getWebSockets().map((ws) => (ws.deserializeAttachment() as Attachment).pid)) : this.dirtyMe;
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
      if (!this.ev) return;
      const n = this.onlineCount();
      if (n > this.ev.stats.peakOnline) {
        this.ev.stats = { peakOnline: n, peakAt: Date.now() };
        this.persistEvent();
      }
      const msg = JSON.stringify({ type: "online", n } satisfies ServerMsg);
      for (const role of ["host", "mod", "present"] as const) for (const ws of this.ctx.getWebSockets(role)) this.sendRaw(ws, msg);
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
