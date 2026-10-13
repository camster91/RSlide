// Optional host accounts: who's signed in, and the events saved to their account.
import { useEffect, useState } from "preact/hooks";
import type { WorkspaceSummary } from "../../shared/protocol";
import { store, type HostedEvent } from "./util";

export interface AccountEvent {
  code: string;
  title: string;
  hostKey: string;
  addedAt: number;
}
export interface AccountState {
  /** Host accounts are set up on this server. */
  on: boolean;
  email: string | null;
  events: AccountEvent[];
  workspaces: WorkspaceSummary[];
  /** Email sign-in links are available. */
  emailSignIn: boolean;
  /** Single sign-on button label (e.g. "Microsoft"), or null when SSO is off. */
  sso: string | null;
  loading: boolean;
}
const OFF: AccountState = { on: false, email: null, events: [], workspaces: [], emailSignIn: false, sso: null, loading: false };

let cache: AccountState | null = null;
const listeners = new Set<(s: AccountState) => void>();
const set = (s: AccountState) => {
  cache = s;
  listeners.forEach((l) => l(s));
};

export const postJson = (url: string, body: unknown = {}, method = "POST") =>
  fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function loadAccount(): Promise<AccountState> {
  try {
    const cfg = (await (await fetch("/api/auth/config")).json()) as { accounts: boolean; email?: boolean; sso?: string | null };
    if (!cfg.accounts) return (set(OFF), cache!);
    const base = { ...OFF, on: true, emailSignIn: cfg.email !== false, sso: cfg.sso ?? null };
    const r = await fetch("/api/me");
    if (!r.ok) return (set(base), cache!);
    const me = (await r.json()) as { email: string; events: AccountEvent[]; workspaces?: WorkspaceSummary[] };
    set({ ...base, email: me.email, events: me.events, workspaces: me.workspaces ?? [] });
  } catch {
    set(OFF);
  }
  return cache!;
}

export function useAccount(): AccountState & { refresh: () => Promise<AccountState> } {
  const [s, setS] = useState<AccountState>(cache ?? { ...OFF, loading: true });
  useEffect(() => {
    listeners.add(setS);
    if (!cache) void loadAccount();
    return () => void listeners.delete(setS);
  }, []);
  return { ...s, refresh: loadAccount };
}

/** Saves an event to the signed-in host's account (does nothing when not signed in). */
export async function saveToAccount(e: { code: string; key: string }) {
  const s = cache ?? (await loadAccount());
  if (!s.email || s.events.some((x) => x.code === e.code)) return;
  const r = await postJson("/api/me/events", { code: e.code, key: e.key });
  if (r.ok) await loadAccount();
}

/** After signing in, events hosted on this device are added to the account. */
export async function claimDeviceEvents() {
  const local = store.get<HostedEvent[]>("rs.hosted", []);
  await Promise.all(local.map((e) => postJson("/api/me/events", { code: e.code, key: e.key }).catch(() => null)));
  return loadAccount();
}
