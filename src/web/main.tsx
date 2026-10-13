import "./styles.css";
import "./lib/px";
import { pickLang, setDict, type Dict } from "./lib/i18n";

// Inside another website (embed.js): a compact layout, and tell the page how tall we are.
if (new URLSearchParams(location.search).has("embed")) {
  document.documentElement.classList.add("embedded");
  if (location.pathname.startsWith("/present/") && window.parent !== window) {
    let last = 0;
    new ResizeObserver(() => {
      const h = Math.ceil(document.documentElement.scrollHeight);
      if (Math.abs(h - last) > 2) window.parent.postMessage({ rslide: "height", h }, "*");
      last = h;
    }).observe(document.documentElement);
  }
}

// Load the translation first, then the app, so every label is in the right language from the start.
const lang = pickLang();
const loaders: Record<string, () => Promise<{ default: Dict }>> = {
  fr: () => import("./i18n/fr"),
  es: () => import("./i18n/es"),
};
(loaders[lang]?.() ?? Promise.resolve(null))
  .then((m) => setDict(lang, m?.default ?? null))
  .catch(() => setDict("en", null))
  .then(() => import("./app"));
