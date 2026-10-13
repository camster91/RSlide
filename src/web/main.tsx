import "./styles.css";
import { pickLang, setDict, type Dict } from "./lib/i18n";

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
