// Host accounts: sign in with an emailed link, see all your events in one place.
// One HostAccount Durable Object per email address (named by a hash of the address).
// Attendees never need an account; hosts don't either. Accounts are optional.
import { DurableObject } from "cloudflare:workers";

export const SESSION_DAYS = 30;
const TOKEN_MINUTES = 15;
const MAX_LINKS_PER_15_MIN = 5;
const MAX_EVENTS = 500;
export const MAX_WORKSPACES = 20;

import { normEmail, random, sha256 } from "./identity";
import type { WorkspaceRole, WorkspaceSummary } from "../shared/protocol";

export interface AccountEvent {
  code: string;
  title: string;
  hostKey: string;
  addedAt: number;
}

export class HostAccount extends DurableObject {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.sql = ctx.storage.sql;
    this.migrate();
  }

  private migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS starts (at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (code TEXT PRIMARY KEY, title TEXT NOT NULL, host_key TEXT NOT NULL, added_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, added_at INTEGER NOT NULL);
    `);
  }

  private clean(now = Date.now()) {
    this.sql.exec("DELETE FROM tokens WHERE expires < ?", now);
    this.sql.exec("DELETE FROM sessions WHERE expires < ?", now);
    this.sql.exec("DELETE FROM starts WHERE at < ?", now - TOKEN_MINUTES * 60_000);
  }

  /** Makes a single-use sign-in token. Returns null when too many were asked for recently. */
  async startSignIn(email: string): Promise<string | null> {
    const now = Date.now();
    this.clean(now);
    // Counted separately from tokens, so using a link doesn't free up room for more.
    const recent = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM starts").one().n;
    if (recent >= MAX_LINKS_PER_15_MIN) return null;
    this.sql.exec("INSERT INTO starts (at) VALUES (?)", now);
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('email', ?)", normEmail(email));
    const token = random();
    this.sql.exec("INSERT INTO tokens (hash, expires, created) VALUES (?,?,?)", await sha256(token), now + TOKEN_MINUTES * 60_000, now);
    return token;
  }

  /** Trades a sign-in token for a session. The token works once. */
  async finishSignIn(token: string): Promise<{ session: string; email: string } | null> {
    const now = Date.now();
    this.clean(now);
    const hash = await sha256(String(token));
    const row = this.sql.exec<{ hash: string }>("DELETE FROM tokens WHERE hash = ? AND expires >= ? RETURNING hash", hash, now).toArray()[0];
    if (!row) return null;
    const session = random();
    this.sql.exec("INSERT INTO sessions (hash, expires, created) VALUES (?,?,?)", await sha256(session), now + SESSION_DAYS * 86_400_000, now);
    return { session, email: this.email() };
  }

  /** Single sign-on: the identity provider already checked the email, so go straight to a session. */
  async ssoSession(email: string): Promise<string> {
    const now = Date.now();
    this.clean(now);
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('email', ?)", normEmail(email));
    const session = random();
    this.sql.exec("INSERT INTO sessions (hash, expires, created) VALUES (?,?,?)", await sha256(session), now + SESSION_DAYS * 86_400_000, now);
    return session;
  }

  async checkSession(session: string): Promise<string | null> {
    if (!session) return null;
    const row = this.sql.exec<{ expires: number }>("SELECT expires FROM sessions WHERE hash = ?", await sha256(session)).toArray()[0];
    return row && row.expires >= Date.now() ? this.email() : null;
  }

  async signOut(session: string, everywhere = false) {
    if (everywhere) this.sql.exec("DELETE FROM sessions");
    else this.sql.exec("DELETE FROM sessions WHERE hash = ?", await sha256(session));
  }

  async events(): Promise<AccountEvent[]> {
    return this.sql
      .exec<{ code: string; title: string; host_key: string; added_at: number }>("SELECT * FROM events ORDER BY added_at DESC")
      .toArray()
      .map((r) => ({ code: r.code, title: r.title, hostKey: r.host_key, addedAt: r.added_at }));
  }

  async addEvent(e: { code: string; title: string; hostKey: string }): Promise<boolean> {
    const n = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM events").one().n;
    if (n >= MAX_EVENTS) return false;
    this.sql.exec(
      "INSERT INTO events (code, title, host_key, added_at) VALUES (?,?,?,?) ON CONFLICT(code) DO UPDATE SET title = excluded.title, host_key = excluded.host_key",
      e.code, e.title, e.hostKey, Date.now(),
    );
    return true;
  }

  async removeEvent(code: string) {
    this.sql.exec("DELETE FROM events WHERE code = ?", code);
  }

  // ---------- workspaces this person belongs to (the Workspace object is the source of truth) ----------

  async workspaces(): Promise<WorkspaceSummary[]> {
    return this.sql
      .exec<{ id: string; name: string; role: WorkspaceRole }>("SELECT id, name, role FROM workspaces ORDER BY added_at")
      .toArray()
      .map((w) => ({ id: w.id, name: w.name, role: w.role }));
  }

  async setWorkspace(w: WorkspaceSummary) {
    if (this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM workspaces WHERE id != ?", w.id).one().n >= MAX_WORKSPACES) return false;
    this.sql.exec(
      "INSERT INTO workspaces (id, name, role, added_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role",
      w.id, w.name, w.role, Date.now(),
    );
    return true;
  }

  async dropWorkspace(id: string) {
    this.sql.exec("DELETE FROM workspaces WHERE id = ?", id);
  }

  /** Forgets the account: email, sessions and event list. The events themselves stay. */
  async deleteAccount() {
    await this.ctx.storage.deleteAll();
    this.migrate();
  }

  private email(): string {
    return this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'email'").toArray()[0]?.v ?? "";
  }
}
