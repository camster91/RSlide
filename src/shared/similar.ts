// Finds questions that mean nearly the same thing, without any AI service.
// Used on attendees' phones ("already asked?") and by the server (duplicate hints for hosts).

const STOP = new Set(
  (
    "a an the and or but if of to in on at by for with about from as into is are was were be been being am do does did done " +
    "i me my we our you your he she it its they them their this that these those there here what which who whom whose " +
    "how why when where can could would should will shall may might must have has had having not no so than too very " +
    "just also any some all more most such only own same s t don please thanks thank question ask asking time going go get got " +
    "really think know like want wanted tell us"
  ).split(" "),
);

/** Common words that say little about what a question is about. They count less. */
const WEAK = new Set(
  "year next last new old company team people person thing way plan work day week month today now still lot many much good best make made use used see talk say".split(" "),
);

/** Light stemming so "breaks", "breaking" and "break" match. */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ied")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("es") && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

export function keywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !STOP.has(w));
  return [...new Set(words.map(stem))];
}

function trigrams(words: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of words) {
    const s = ` ${w} `;
    for (let i = 0; i < s.length - 2; i++) {
      const g = s.slice(i, i + 3);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
  }
  return m;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of a) {
    na += v * v;
    const o = b.get(k);
    if (o) dot += v * o;
  }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Pre-computed form of a question, so comparing many is quick. */
export interface Fingerprint {
  words: string[];
  grams: Map<string, number>;
}

export function fingerprint(text: string): Fingerprint {
  const words = keywords(text);
  return { words, grams: trigrams(words) };
}

const weight = (w: string) => (WEAK.has(w) ? 0.35 : 1);

/** Same word, or one is a short form of the other ("record" / "recording", "hir" / "hire"). */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.length >= 3 && l.startsWith(s) && l.length - s.length <= 4;
}

/** 0 (nothing alike) to 1 (same meaning words). */
export function similarity(a: Fingerprint | string, b: Fingerprint | string): number {
  const fa = typeof a === "string" ? fingerprint(a) : a;
  const fb = typeof b === "string" ? fingerprint(b) : b;
  if (!fa.words.length || !fb.words.length) return 0;
  // Weighted share of key words both questions have (fuzzy Dice score).
  let shared = 0;
  for (const w of fa.words) {
    const m = fb.words.find((x) => wordsMatch(w, x));
    if (m) shared += (weight(w) + weight(m)) / 2;
  }
  // No key word in common: not the same question (and skips the slower letter check).
  if (!shared) return 0;
  const total = fa.words.reduce((n, w) => n + weight(w), 0) + fb.words.reduce((n, w) => n + weight(w), 0);
  const dice = Math.min(1, (2 * shared) / total);
  // Letter patterns catch typos the word match misses.
  const grams = cosine(fa.grams, fb.grams);
  // Two one-word questions sharing a word is weak evidence.
  const tooShort = Math.max(fa.words.length, fb.words.length) < 2 ? 0.75 : 1;
  return Math.min(1, (0.8 * dice + 0.2 * grams) * tooShort);
}

/** Score at which we call two questions "probably the same". */
export const DUPLICATE_SCORE = 0.66;
/** Lower score for "you might mean this one" hints while typing. */
export const SUGGEST_SCORE = 0.5;

/** Best matches for `text` among `items`, best first. */
export function findSimilar<T extends { text: string }>(text: string, items: T[], min = SUGGEST_SCORE, limit = 3): { item: T; score: number }[] {
  const f = fingerprint(text);
  if (f.words.length < 2) return [];
  return items
    .map((item) => ({ item, score: similarity(f, item.text) }))
    .filter((x) => x.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Cosine similarity of two AI embeddings. */
export function vectorScore(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
