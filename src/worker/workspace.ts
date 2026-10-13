// Team workspaces: a shared list of events, with people and roles.
// One Workspace Durable Object per workspace. Members are identified by email
// (they sign in with a link or single sign-on, see accounts.ts).
import { DurableObject } from "cloudflare:workers";
import { DEFAULT_BRAND, WORKSPACE_ROLES, type Brand, type WorkspaceDetail, type WorkspaceRole } from "../shared/protocol";
import { random, sha256 } from "./identity";
import { cleanBrand, UserError } from "./logic";

const RANK: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, owner: 3 };
const INVITE_DAYS = 7;
export const WS_LIMITS = { members: 200, events: 2000, invites: 100, name: 60 } as const;

export const atLeast = (role: WorkspaceRole | null | undefined, need: WorkspaceRole) => !!role && RANK[role] >= RANK[need];
export const isRole = (r: unknown): r is WorkspaceRole => WORKSPACE_ROLES.includes(r as WorkspaceRole);

export class Workspace extends DurableObject {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.sql = ctx.storage.sql;
    this.migrate();
  }

  private migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members (email TEXT PRIMARY KEY, role TEXT NOT NULL, added_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS invites (hash TEXT PRIMARY KEY, email TEXT NOT NULL, role TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events (code TEXT PRIMARY KEY, title TEXT NOT NULL, host_key TEXT NOT NULL, added_at INTEGER NOT NULL, added_by TEXT NOT NULL);
    `);
  }

  // ---------- reading ----------

  private get(k: string): string | null {
    return this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = ?", k).toArray()[0]?.v ?? null;
  }
  private put(k: string, v: string) {
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", k, v);
  }
  private exists() {
    return this.get("id") !== null;
  }

  async roleOf(email: string): Promise<WorkspaceRole | null> {
    const r = this.sql.exec<{ role: string }>("SELECT role FROM members WHERE email = ?", email).toArray()[0]?.role;
    return isRole(r) ? r : null;
  }

  private brand(): Brand {
    try {
      return { ...DEFAULT_BRAND, ...(JSON.parse(this.get("brand") ?? "{}") as Partial<Brand>) };
    } catch {
      return DEFAULT_BRAND;
    }
  }

  /** Everything a member may see. Null when they aren't a member. */
  async detail(email: string): Promise<WorkspaceDetail | null> {
    if (!this.exists()) return null;
    const role = await this.roleOf(email);
    if (!role) return null;
    const now = Date.now();
    const canHost = atLeast(role, "editor");
    return {
      id: this.get("id")!,
      name: this.get("name") ?? "",
      role,
      brand: this.brand(),
      members: this.sql
        .exec<{ email: string; role: WorkspaceRole; added_at: number }>("SELECT * FROM members ORDER BY added_at")
        .toArray()
        .map((m) => ({ email: m.email, role: m.role, addedAt: m.added_at })),
      invites:
        role === "owner"
          ? this.sql
              .exec<{ email: string; role: WorkspaceRole; expires: number }>("SELECT email, role, expires FROM invites WHERE expires > ? ORDER BY expires DESC", now)
              .toArray()
          : [],
      plan: this.get("plan") === "pro" ? "pro" : "free",
      events: this.sql
        .exec<{ code: string; title: string; host_key: string; added_at: number; added_by: string }>("SELECT * FROM events ORDER BY added_at DESC")
        .toArray()
        .map((e) => ({ code: e.code, title: e.title, addedAt: e.added_at, addedBy: e.added_by, ...(canHost ? { hostKey: e.host_key } : {}) })),
    };
  }

  /** Host keys never leave the workspace for viewers; the server uses them on their behalf (analytics). */
  async hostKeys(email: string, codes?: string[]): Promise<{ code: string; title: string; hostKey: string }[] | null> {
    if (!atLeast(await this.roleOf(email), "viewer")) return null;
    const rows = this.sql.exec<{ code: string; title: string; host_key: string }>("SELECT code, title, host_key FROM events ORDER BY added_at DESC").toArray();
    return rows.filter((r) => !codes || codes.includes(r.code)).map((r) => ({ code: r.code, title: r.title, hostKey: r.host_key }));
  }

  // ---------- changing ----------

  async create(id: string, name: string, owner: string) {
    if (this.exists()) throw new UserError("That workspace already exists");
    this.put("id", id);
    this.put("name", name);
    this.put("created", String(Date.now()));
    this.sql.exec("INSERT INTO members (email, role, added_at) VALUES (?, 'owner', ?)", owner, Date.now());
  }

  private async need(email: string, role: WorkspaceRole) {
    if (!this.exists()) throw new UserError("This workspace doesn't exist any more");
    if (atLeast(await this.roleOf(email), role)) return;
    if (role === "owner") throw new UserError("Only workspace owners can do that");
    throw new UserError("You can't do that in this workspace");
  }

  async update(by: string, patch: { name?: string; brand?: unknown }): Promise<{ name: string; brand: Brand }> {
    await this.need(by, "owner");
    if (typeof patch.name === "string" && patch.name.trim()) this.put("name", patch.name.trim().slice(0, WS_LIMITS.name));
    if (patch.brand !== undefined) this.put("brand", JSON.stringify(cleanBrand(patch.brand, this.brand())));
    return { name: this.get("name") ?? "", brand: this.brand() };
  }

  /** Makes an invite link token. Re-inviting the same email replaces the old invite. */
  async invite(by: string, email: string, role: WorkspaceRole): Promise<string> {
    await this.need(by, "owner");
    if (await this.roleOf(email)) throw new UserError("They're already in this workspace");
    const now = Date.now();
    this.sql.exec("DELETE FROM invites WHERE expires < ? OR email = ?", now, email);
    if (this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM invites").one().n >= WS_LIMITS.invites) throw new UserError("Too many open invites. Cancel some first.");
    const token = random();
    this.sql.exec("INSERT INTO invites (hash, email, role, expires) VALUES (?,?,?,?)", await sha256(token), email, role, now + INVITE_DAYS * 86_400_000);
    return token;
  }

  async cancelInvite(by: string, email: string) {
    await this.need(by, "owner");
    this.sql.exec("DELETE FROM invites WHERE email = ?", email);
  }

  /** The invite only works for the email it was sent to, once. */
  async accept(token: string, email: string): Promise<{ id: string; name: string; role: WorkspaceRole }> {
    if (!this.exists()) throw new UserError("This workspace doesn't exist any more");
    const row = this.sql
      .exec<{ email: string; role: WorkspaceRole }>("SELECT email, role FROM invites WHERE hash = ? AND expires > ?", await sha256(String(token)), Date.now())
      .toArray()[0];
    if (!row) throw new UserError("This invite has expired or was already used. Ask for a new one.");
    if (row.email !== email) throw new UserError("This invite was sent to a different email address. Sign in with that one.");
    if (this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM members").one().n >= WS_LIMITS.members) throw new UserError("This workspace is full");
    this.sql.exec("DELETE FROM invites WHERE email = ?", email);
    this.sql.exec("INSERT OR REPLACE INTO members (email, role, added_at) VALUES (?,?,?)", email, row.role, Date.now());
    return { id: this.get("id")!, name: this.get("name") ?? "", role: row.role };
  }

  private owners() {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM members WHERE role = 'owner'").one().n;
  }

  async setRole(by: string, email: string, role: WorkspaceRole) {
    await this.need(by, "owner");
    const cur = await this.roleOf(email);
    if (!cur) throw new UserError("They aren't in this workspace");
    if (cur === "owner" && role !== "owner" && this.owners() <= 1) throw new UserError("A workspace needs at least one owner");
    this.sql.exec("UPDATE members SET role = ? WHERE email = ?", role, email);
  }

  /** Owners can remove anyone; anyone can remove themselves (leave). */
  async removeMember(by: string, email: string) {
    if (by !== email) await this.need(by, "owner");
    const cur = await this.roleOf(email);
    if (!cur) return;
    if (cur === "owner" && this.owners() <= 1) throw new UserError("A workspace needs at least one owner. Make someone else an owner first.");
    this.sql.exec("DELETE FROM members WHERE email = ?", email);
  }

  async addEvent(by: string, e: { code: string; title: string; hostKey: string }) {
    await this.need(by, "editor");
    if (this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM events").one().n >= WS_LIMITS.events) throw new UserError("This workspace has the most events allowed");
    this.sql.exec(
      "INSERT INTO events (code, title, host_key, added_at, added_by) VALUES (?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET title = excluded.title, host_key = excluded.host_key",
      e.code, e.title, e.hostKey, Date.now(), by,
    );
  }

  async removeEvent(by: string, code: string) {
    await this.need(by, "editor");
    this.sql.exec("DELETE FROM events WHERE code = ?", code);
  }

  // ---------- plan (set by the Stripe webhook) ----------

  async plan(): Promise<"free" | "pro"> {
    return this.get("plan") === "pro" ? "pro" : "free";
  }

  /** The Stripe customer, for the "manage billing" page. Owners only. */
  async customerFor(email: string): Promise<string | null> {
    return (await this.roleOf(email)) === "owner" ? this.get("customer") : null;
  }

  /** Returns the event codes, so their attendee limits can be updated. */
  async setPlan(plan: "free" | "pro", customer?: string, subscription?: string): Promise<string[]> {
    if (!this.exists()) return [];
    this.put("plan", plan);
    if (customer) this.put("customer", customer);
    if (subscription) this.put("subscription", subscription);
    return this.sql.exec<{ code: string }>("SELECT code FROM events").toArray().map((r) => r.code);
  }

  /** The workspace brand, used as the starting look for new events made in it. */
  async brandFor(email: string): Promise<Brand | null> {
    return atLeast(await this.roleOf(email), "editor") ? this.brand() : null;
  }

  /** Deletes the workspace (not its events). Returns the members, so their lists can be updated. */
  async destroy(by: string): Promise<string[]> {
    await this.need(by, "owner");
    const members = this.sql.exec<{ email: string }>("SELECT email FROM members").toArray().map((m) => m.email);
    await this.ctx.storage.deleteAll();
    this.migrate();
    return members;
  }
}

// Errors cross the Durable Object boundary as plain Errors, so friendly messages are marked
// with a prefix and turned back into 400 replies by the routes (see workspaceRoutes.ts).
export const USER_ERROR = "user-error:";
for (const name of ["update", "invite", "cancelInvite", "accept", "setRole", "removeMember", "addEvent", "removeEvent", "destroy", "create"] as const) {
  const proto = Workspace.prototype as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const orig = proto[name];
  proto[name] = async function (this: Workspace, ...args: unknown[]) {
    try {
      return await orig.apply(this, args);
    } catch (e) {
      if (e instanceof UserError) throw new Error(USER_ERROR + e.message);
      throw e;
    }
  };
}
