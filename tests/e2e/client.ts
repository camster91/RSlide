// Small test client that speaks the RSlide protocol and keeps a live copy of the event,
// exactly like the browser does (it uses the same reducer).
import type { ClientMsg, Role, ServerMsg } from "../../src/shared/protocol";
import { emptyRoom, reduce, type RoomState } from "../../src/shared/store";

export const BASE = process.env.BASE_URL || "http://127.0.0.1:8787";
export const WS_BASE = BASE.replace(/^http/, "ws");
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function createEvent(title: string): Promise<{ code: string; hostKey: string }> {
  const r = await fetch(`${BASE}/api/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
  if (!r.ok) throw new Error(`create failed: ${r.status}`);
  return r.json();
}

export class Client {
  state: RoomState = emptyRoom();
  errors: string[] = [];
  closeCode: number | null = null;
  messages = 0;
  bytes = 0;
  private ws!: WebSocket;
  private waiters: { check: () => boolean; resolve: () => void }[] = [];

  reactions: Record<string, number> = {};

  static async connect(code: string, role: Role, pid: string, key?: string, pass?: string): Promise<Client> {
    const c = new Client();
    await c.open(code, role, pid, key, pass);
    return c;
  }

  private open(code: string, role: Role, pid: string, key?: string, pass?: string) {
    const qs = new URLSearchParams({ role, pid, ...(key ? { key } : {}), ...(pass ? { pass } : {}) });
    this.ws = new WebSocket(`${WS_BASE}/api/events/${code}/ws?${qs}`);
    return new Promise<void>((resolve, reject) => {
      let gotHello = false;
      this.ws.onmessage = (e) => {
        this.messages++;
        this.bytes += (e.data as string).length;
        const m = JSON.parse(e.data as string) as ServerMsg;
        if (m.type === "error") this.errors.push(m.message);
        else if (m.type === "reactions") for (const [k, n] of Object.entries(m.counts)) this.reactions[k] = (this.reactions[k] ?? 0) + (n ?? 0);
        else this.state = reduce(this.state, m);
        if (m.type === "hello" && !gotHello) {
          gotHello = true;
          resolve();
        }
        this.waiters = this.waiters.filter((w) => (w.check() ? (w.resolve(), false) : true));
      };
      this.ws.onclose = (e) => {
        this.closeCode = e.code;
        if (!gotHello) resolve();
        this.waiters.forEach((w) => w.check() && w.resolve());
      };
      this.ws.onerror = () => !gotHello && reject(new Error("socket error"));
    });
  }

  send(msg: ClientMsg) {
    this.ws.send(JSON.stringify(msg));
  }

  /** Waits until `check` is true (re-checked after every message). */
  until(check: () => boolean, timeoutMs = 3000): Promise<boolean> {
    if (check()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        resolve(false);
      }, timeoutMs);
      const waiter = { check, resolve: () => (clearTimeout(t), resolve(true)) };
      this.waiters.push(waiter);
    });
  }

  get snap() {
    return this.state.snapshot!;
  }

  close() {
    this.ws.close();
  }
}
