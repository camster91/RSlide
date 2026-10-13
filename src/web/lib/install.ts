import { useEffect, useState } from "preact/hooks";
import { isNative } from "./native";

// Chrome, Edge and Android fire this when the app can be installed. We keep it for our own "Install" button.
interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
let deferred: InstallEvent | null = null;
const subs = new Set<() => void>();
if (typeof window !== "undefined") {
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    subs.forEach((f) => f());
  });
  addEventListener("appinstalled", () => {
    deferred = null;
    subs.forEach((f) => f());
  });
}

const standalone = () => typeof matchMedia !== "undefined" && (matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);

/** "prompt": we can show the install dialog. "ios": tell people to use Share → Add to Home Screen. null: nothing to offer. */
export function useInstall(): { kind: "prompt" | "ios" | null; install: () => Promise<void> } {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  const kind = standalone() || isNative() ? null : deferred ? "prompt" : isIos() ? "ios" : null;
  return {
    kind,
    install: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice.catch(() => null);
      deferred = null;
      subs.forEach((f) => f());
    },
  };
}
