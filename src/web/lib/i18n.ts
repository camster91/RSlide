// Translations. English text is the key, so the code stays readable and a missing
// translation simply shows English. Dictionaries live in src/web/i18n/<lang>.ts and are
// loaded before the app starts (see main.tsx), so t() works anywhere, even at module level.
import type { ComponentChildren } from "preact";

export const LANGS = { en: "English", fr: "Français", es: "Español" } as const;
export type Lang = keyof typeof LANGS;

export interface Dict {
  /** English text → translated text. Use {name} for values filled in later. */
  strings: Record<string, string>;
  /** English word → [one, many] in this language, for counts like "3 questions". */
  plurals: Record<string, [string, string]>;
}

const STORE_KEY = "rs.lang";
const isLang = (l: unknown): l is Lang => typeof l === "string" && l in LANGS;

/** ?lang= in the URL, then the person's choice, then their browser or phone language. */
export function pickLang(): Lang {
  const fromUrl = new URLSearchParams(location.search).get("lang");
  if (isLang(fromUrl)) return fromUrl;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
    if (isLang(saved)) return saved;
  } catch {}
  for (const l of navigator.languages ?? [navigator.language]) {
    const base = l?.slice(0, 2).toLowerCase();
    if (isLang(base)) return base;
  }
  return "en";
}

export let lang: Lang = "en";
let dict: Dict | null = null;

export function setDict(l: Lang, d: Dict | null) {
  lang = l;
  dict = d;
  document.documentElement.lang = l;
}

/** Saves the choice and reloads, so every screen redraws in the new language. */
export function chooseLang(l: Lang) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(l));
  } catch {}
  const url = new URL(location.href);
  url.searchParams.delete("lang");
  location.replace(url.toString());
}

const fill = (s: string, vars?: Record<string, string | number>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? (typeof vars[k] === "number" ? (vars[k] as number).toLocaleString(lang) : String(vars[k])) : m)) : s;

/** English shown when there's no translation. "Answered||tab" adds a note for translators: shows "Answered". */
const english = (key: string) => {
  const i = key.indexOf("||");
  return i < 0 ? key : key.slice(0, i);
};

/** Translates a piece of English text. */
export function t(en: string, vars?: Record<string, string | number>): string {
  return fill(dict?.strings[en] ?? english(en), vars);
}

/** Like t(), but the {values} can be elements, such as a bold code or a link. */
export function tj(en: string, vars: Record<string, ComponentChildren>): ComponentChildren[] {
  const s = dict?.strings[en] ?? english(en);
  return s.split(/(\{\w+\})/).map((part) => {
    const m = part.match(/^\{(\w+)\}$/);
    return m && m[1] in vars ? vars[m[1]] : part;
  });
}

const EN_IRREGULAR: Record<string, string> = { person: "people", reply: "replies" };
const rules = () => new Intl.PluralRules(lang);

/** "3 questions", "1 vote", "0 question" (French) — in the current language. */
export function plural(n: number, word: string): string {
  const forms = dict?.plurals[word] ?? [word, EN_IRREGULAR[word] ?? `${word}s`];
  return `${n.toLocaleString(lang)} ${rules().select(n) === "one" ? forms[0] : forms[1]}`;
}

/** Just the word, without the number. */
export function pluralWord(n: number, word: string): string {
  const forms = dict?.plurals[word] ?? [word, EN_IRREGULAR[word] ?? `${word}s`];
  return rules().select(n) === "one" ? forms[0] : forms[1];
}
