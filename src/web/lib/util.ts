import { useEffect, useState } from "preact/hooks";
import type { EventInfo, ScreenLook, ThemeName } from "../../shared/protocol";

// ---------- branding ----------
export interface BrandConfig {
  name: string;
  logoUrl: string;
  heroKicker: string;
  heroTitle: string;
  heroText: string;
  titlePlaceholder: string;
}
declare global {
  interface Window {
    RSLIDE_CONFIG?: Partial<BrandConfig>;
  }
}
export const CFG: BrandConfig = {
  name: "RSlide",
  logoUrl: "",
  heroKicker: "",
  heroTitle: "Ask. Vote. Be heard.",
  heroText: "",
  titlePlaceholder: "",
  ...(typeof window !== "undefined" ? window.RSLIDE_CONFIG : {}),
};

// ---------- local storage ----------
export const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

/** A random ID for this browser, used for one vote per question. */
export const pid: string = (() => {
  const existing = store.get<string | null>("rs.pid", null);
  if (existing) return existing;
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  store.set("rs.pid", id);
  return id;
})();

export interface HostedEvent {
  code: string;
  key: string;
  title: string;
  ts: number;
}
export function rememberHosted(e: HostedEvent) {
  const list = store.get<HostedEvent[]>("rs.hosted", []);
  if (list.some((x) => x.code === e.code)) return;
  store.set("rs.hosted", [e, ...list].slice(0, 30));
}

// ---------- formatting ----------
export function ago(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
export const joinUrl = (code: string) => `${location.origin}/e/${code}`;
export const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

// ---------- toast ----------
const TOAST = "rs-toast";
export function toast(message: string) {
  window.dispatchEvent(new CustomEvent(TOAST, { detail: message }));
}
export function useToast(): string | null {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      setMsg((e as CustomEvent<string>).detail);
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 2800);
    };
    window.addEventListener(TOAST, on);
    return () => window.removeEventListener(TOAST, on);
  }, []);
  return msg;
}

// ---------- routing ----------
const NAV = "rs-nav";
export function navigate(path: string) {
  history.pushState({}, "", path);
  window.dispatchEvent(new Event(NAV));
}
export function useLocation(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener(NAV, on);
    window.addEventListener("popstate", on);
    return () => {
      window.removeEventListener(NAV, on);
      window.removeEventListener("popstate", on);
    };
  }, []);
  return path;
}

export async function fetchEvent(code: string): Promise<EventInfo | null> {
  try {
    const r = await fetch(`/api/events/${encodeURIComponent(code)}`);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// ---------- theme ----------
/** Applies an event's colour theme and light/dark look to the whole page. */
export function useTheme(theme: ThemeName | undefined, look: "auto" | ScreenLook = "auto") {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme ?? "indigo";
    root.dataset.look = look;
    const meta = document.querySelector('meta[name="theme-color"]');
    const brand = getComputedStyle(root).getPropertyValue("--brand").trim();
    if (meta && brand) meta.setAttribute("content", brand);
  }, [theme, look]);
}

// ---------- passcodes (remembered per event on this device) ----------
export const passcodeFor = (code: string) => store.get<string>(`rs.pass.${code}`, "");
export const savePasscode = (code: string, pass: string) => store.set(`rs.pass.${code}`, pass);

// ---------- images ----------
export const mediaUrl = (code: string, id: string) => `/api/events/${code}/media/${id}`;

/** Shrinks big photos before upload so they load fast on phones. */
async function shrink(file: File, maxSide = 1200): Promise<Blob> {
  if (file.type === "image/gif" || !("createImageBitmap" in window)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 400_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((res) => canvas.toBlob((b) => res(b ?? file), "image/webp", 0.85));
  } catch {
    return file;
  }
}

export async function uploadImage(code: string, key: string, file: File): Promise<string> {
  const body = await shrink(file);
  const r = await fetch(`/api/events/${code}/media?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": body.type || file.type }, body });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Upload failed");
  return d.id as string;
}

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
