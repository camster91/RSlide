// Extras when the site runs inside the RSlide phone app (Capacitor). In a normal browser these do nothing,
// or fall back to what the browser can do. Plugins come from the app, so nothing extra is downloaded.
import { navigate } from "./util";

interface Plugins {
  BarcodeScanner?: {
    scan(o?: { formats?: string[] }): Promise<{ barcodes: { rawValue?: string }[] }>;
    isGoogleBarcodeScannerModuleAvailable?(): Promise<{ available: boolean }>;
    installGoogleBarcodeScannerModule?(): Promise<void>;
  };
  Haptics?: { impact(o: { style: "LIGHT" | "MEDIUM" | "HEAVY" }): Promise<void> };
  Share?: { share(o: { title?: string; text?: string; url?: string }): Promise<unknown> };
  App?: { addListener(e: "appUrlOpen", f: (d: { url: string }) => void): unknown };
  StatusBar?: { setBackgroundColor(o: { color: string }): Promise<void>; setStyle(o: { style: "DARK" | "LIGHT" }): Promise<void> };
}
declare global {
  interface Window {
    Capacitor?: { isNativePlatform(): boolean; getPlatform(): string; Plugins: Plugins };
  }
}

export const isNative = () => typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();
const plugins = (): Plugins => (isNative() ? window.Capacitor!.Plugins : {});

/** A light tap you can feel, for votes and answers. */
export function haptic() {
  plugins()
    .Haptics?.impact({ style: "LIGHT" })
    .catch(() => {});
}

/** Native share sheet, then the browser's, then copy the link. Resolves to how it was shared. */
export async function shareLink(o: { title: string; url: string }): Promise<"shared" | "copied" | "none"> {
  try {
    const p = plugins().Share;
    if (p) return (await p.share({ title: o.title, url: o.url }), "shared");
    if (navigator.share) return (await navigator.share({ title: o.title, url: o.url }), "shared");
    await navigator.clipboard.writeText(o.url);
    return "copied";
  } catch {
    return "none";
  }
}

/** The event code in a scanned QR code: a join link (…/e/CODE or …/CODE) or a bare code. */
export function codeFromScan(raw: string): string | null {
  const s = raw.trim();
  try {
    const u = new URL(s);
    const m = u.pathname.match(/^\/(?:e\/)?([A-Za-z0-9]{4,10})\/?$/);
    return m ? m[1].toUpperCase() : null;
  } catch {
    return /^[A-Za-z0-9]{4,10}$/.test(s) ? s.toUpperCase() : null;
  }
}

export const canScan = () => !!plugins().BarcodeScanner;

/** Opens the camera to scan an event's QR code. Returns the code, null if it wasn't an event code, undefined if cancelled. */
export async function scanForCode(): Promise<string | null | undefined> {
  const bs = plugins().BarcodeScanner;
  if (!bs) return null;
  // Android uses Google's scanner, which may need a one-time download.
  if (window.Capacitor!.getPlatform() === "android" && bs.isGoogleBarcodeScannerModuleAvailable) {
    const { available } = await bs.isGoogleBarcodeScannerModuleAvailable();
    if (!available) await bs.installGoogleBarcodeScannerModule?.();
  }
  const r = await bs.scan({ formats: ["QR_CODE"] });
  const raw = r.barcodes[0]?.rawValue ?? "";
  return raw ? codeFromScan(raw) : undefined;
}

/** Event links opened from other apps (mail, chat, camera) come to the app instead of the browser. */
export function setupNative() {
  if (!isNative()) return;
  document.documentElement.classList.add("native-app");
  plugins().App?.addListener("appUrlOpen", ({ url }) => {
    try {
      const u = new URL(url);
      if (u.host === location.host) navigate(u.pathname + u.search + u.hash);
    } catch {}
  });
}
