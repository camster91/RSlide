// Pure helpers used by the event room. No Cloudflare APIs here, so they're easy to unit test.
import {
  ITEM_TYPES,
  LABEL_COLORS,
  LIMITS,
  type TeamScore,
  POINTS_BUDGET,
  POLL_TYPES,
  type LabelColor,
  type Item,
  type ItemDraft,
  type ItemType,
  type Poll,
  type PollDraft,
  type PollType,
  type Range,
  type ResponseValue,
  type Results,
} from "../shared/protocol";

export class UserError extends Error {}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randomString(len: number, chars = CODE_CHARS): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}
export const newId = () => randomString(12, ID_CHARS);
export const newHostKey = () => randomString(24, ID_CHARS);
export const newCode = () => randomString(6);
export const isMediaId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9]{12}$/.test(id);

export const clean = (s: unknown, max: number): string =>
  String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export const normCode = (c: unknown): string => String(c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function cleanEmail(e: unknown): string {
  const v = clean(e, LIMITS.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) throw new UserError("Enter a valid email address");
  return v;
}

export const normPasscode = (p: unknown) => clean(p, LIMITS.passcode).toLowerCase();

// ---------- poll definitions ----------

export type CleanPoll = Omit<Poll, "id" | "ord" | "status" | "showResults" | "revealed" | "startedAt"> & { correct: number[] };

const DEFAULT_RANGE: Range = { min: 1, max: 10, minLabel: "", maxLabel: "" };

function cleanRange(r: Partial<Range> | null | undefined): Range {
  let min = Math.round(Number(r?.min ?? DEFAULT_RANGE.min));
  let max = Math.round(Number(r?.max ?? DEFAULT_RANGE.max));
  if (!Number.isFinite(min)) min = DEFAULT_RANGE.min;
  if (!Number.isFinite(max)) max = DEFAULT_RANGE.max;
  min = Math.max(0, Math.min(min, 10));
  max = Math.max(min + 1, Math.min(max, 10));
  return { min, max, minLabel: clean(r?.minLabel, 30), maxLabel: clean(r?.maxLabel, 30) };
}

/** Cleans one question (a poll, or a question inside a survey). */
export function validateItem(d: ItemDraft | PollDraft, allowed: readonly (ItemType | "quiz")[]): Item {
  const type = (allowed as string[]).includes(d?.type) ? (d.type as Item["type"]) : "multiple";
  const title = clean(d?.title, LIMITS.question);
  if (!title) throw new UserError("Each question needs a title");
  const needsOptions = type === "multiple" || type === "quiz" || type === "ranking" || type === "points" || type === "grid";
  let options: string[] = [];
  let images: (string | null)[] = [];
  if (needsOptions) {
    const rawOpts = Array.isArray(d.options) ? d.options : [];
    const rawImgs = Array.isArray(d.images) ? d.images : [];
    // Keep each image with its option while dropping empty options.
    const pairs = rawOpts
      .map((o, i) => ({ o: clean(o, LIMITS.option), img: isMediaId(rawImgs[i]) ? rawImgs[i] : null }))
      .filter((x) => x.o || x.img)
      .slice(0, LIMITS.options);
    options = pairs.map((x, i) => x.o || `Option ${i + 1}`);
    images = pairs.map((x) => x.img);
    if (options.length < 2) throw new UserError(`"${title.slice(0, 40)}" needs at least 2 options`);
  }
  let axes: [string, string] | null = null;
  if (type === "grid") {
    const a = Array.isArray(d.axes) ? d.axes : [];
    axes = [clean(a[0], 30) || "Impact", clean(a[1], 30) || "Effort"];
  }
  let image: string | null = null;
  if (type === "pin") {
    if (!isMediaId(d.image)) throw new UserError(`"${title.slice(0, 40)}" needs a picture to pin on`);
    image = d.image;
  }
  return {
    type,
    title,
    options,
    images: images.some(Boolean) ? images : [],
    multi: type === "multiple" && !!d.multi,
    scale: type === "rating" ? 5 : 0,
    range: type === "scale" ? cleanRange(d.range) : type === "grid" ? cleanRange({ min: 1, max: 10, ...d.range, minLabel: "", maxLabel: "" }) : null,
    axes,
    image,
  };
}

/** Validates a poll definition from the host. Throws UserError with a friendly message. */
export function validatePoll(draft: PollDraft): CleanPoll {
  const type: PollType = POLL_TYPES.includes(draft?.type) ? draft.type : "multiple";
  if (!clean(draft?.title, LIMITS.question)) throw new UserError("Poll needs a question");

  if (type === "survey") {
    const raw = Array.isArray(draft.items) ? draft.items : [];
    if (!raw.length) throw new UserError("Add at least one question to the survey");
    if (raw.length > LIMITS.surveyItems) throw new UserError(`Surveys can have up to ${LIMITS.surveyItems} questions`);
    const items = raw.map((it) => validateItem(it, ITEM_TYPES));
    return { type, title: clean(draft.title, LIMITS.question), options: [], images: [], multi: false, scale: 0, range: null, axes: null, image: null, correct: [], timeLimit: 0, items };
  }

  const base = validateItem({ ...draft, type: type as ItemType }, [...ITEM_TYPES, "quiz"]);
  let correct: number[] = [];
  let timeLimit = 0;
  if (type === "quiz") {
    correct = [...new Set((Array.isArray(draft.correct) ? draft.correct : []).map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n < base.options.length);
    if (!correct.length) throw new UserError("Mark the correct answer");
    const t = Math.round(Number(draft.timeLimit ?? 20));
    timeLimit = Number.isFinite(t) ? Math.max(0, Math.min(t, 300)) : 20;
  }
  // A quiz with several right answers lets people pick several.
  return { ...base, type, correct, timeLimit, multi: type === "quiz" ? correct.length > 1 : base.multi, items: [] };
}

// ---------- answers ----------

/** Validates an answer to one question. */
export function validateItemResponse(p: Pick<Item, "type" | "options" | "multi" | "scale" | "range">, value: unknown): ResponseValue {
  switch (p.type) {
    case "points": {
      const arr = Array.isArray(value) ? value.map(Number) : [];
      if (arr.length !== p.options.length || arr.some((n) => !Number.isInteger(n) || n < 0)) throw new UserError("Share out your points");
      const sum = arr.reduce((a, b) => a + b, 0);
      if (sum === 0) throw new UserError("Give at least one point");
      if (sum > POINTS_BUDGET) throw new UserError(`You only have ${POINTS_BUDGET} points`);
      return arr;
    }
    case "grid": {
      const r = p.range ?? { min: 1, max: 10 };
      const arr = Array.isArray(value) ? value : [];
      const ok = (n: unknown) => Number.isInteger(n) && (n as number) >= r.min && (n as number) <= r.max;
      const pairs = arr.map((xy) => (Array.isArray(xy) ? [Number(xy[0]), Number(xy[1])] : []) as number[]);
      if (pairs.length !== p.options.length || pairs.some((xy) => xy.length !== 2 || !ok(xy[0]) || !ok(xy[1]))) throw new UserError("Place every option on the grid");
      return pairs as [number, number][];
    }
    case "pin": {
      const xy = Array.isArray(value) ? value.map(Number) : [];
      if (xy.length !== 2 || xy.some((n) => !Number.isFinite(n) || n < 0 || n > 1)) throw new UserError("Tap the picture to drop your pin");
      return [Math.round(xy[0] * 1000) / 1000, Math.round(xy[1] * 1000) / 1000];
    }
    case "multiple":
    case "quiz": {
      const arr = (Array.isArray(value) ? value : [value]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < p.options.length);
      const uniq = [...new Set(arr)];
      if (!uniq.length) throw new UserError("Pick an option");
      if (!p.multi && uniq.length > 1) throw new UserError("Pick one option");
      return uniq;
    }
    case "rating": {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > (p.scale || 5)) throw new UserError("Pick a rating");
      return n;
    }
    case "scale": {
      const r = p.range ?? DEFAULT_RANGE;
      const n = Number(value);
      if (!Number.isInteger(n) || n < r.min || n > r.max) throw new UserError("Pick a number on the scale");
      return n;
    }
    case "ranking": {
      const arr = (Array.isArray(value) ? value : []).map(Number);
      const n = p.options.length;
      const valid = arr.length === n && new Set(arr).size === n && arr.every((i) => Number.isInteger(i) && i >= 0 && i < n);
      if (!valid) throw new UserError("Put every option in order");
      return arr;
    }
    case "wordcloud": {
      const words = (Array.isArray(value) ? value : [value]).map((w) => clean(w, LIMITS.word).toLowerCase()).filter(Boolean).slice(0, LIMITS.words);
      if (!words.length) throw new UserError("Type a word");
      return words;
    }
    case "open": {
      const t = clean(value, LIMITS.answer);
      if (!t) throw new UserError("Type an answer");
      return t;
    }
  }
}

/** Validates an answer to a poll. Surveys take one answer per question; skipped questions are null. */
export function validateResponse(p: Pick<Poll, "type" | "options" | "multi" | "scale" | "range" | "items">, value: unknown): ResponseValue {
  if (p.type === "survey") {
    const arr = Array.isArray(value) ? value : [];
    if (arr.length !== p.items.length) throw new UserError("Answer the survey questions");
    const out = p.items.map((it, i) => (arr[i] === null || arr[i] === undefined || arr[i] === "" ? null : validateItemResponse(it, arr[i])));
    if (out.every((x) => x === null)) throw new UserError("Answer at least one question");
    return out as ResponseValue;
  }
  return validateItemResponse(p as unknown as Item, value);
}

// ---------- results ----------

/** Tallies all responses for one question. */
export function tallyItem(p: Pick<Item, "type" | "options" | "scale" | "range">, responses: ResponseValue[]): Results {
  const total = responses.length;
  const avg2 = (sum: number) => (total ? Math.round((sum / total) * 10) / 10 : 0);
  switch (p.type) {
    case "points": {
      const sums = p.options.map(() => 0);
      for (const r of responses) (r as number[]).forEach((n, i) => i < sums.length && (sums[i] += n));
      return { total, scores: sums.map(avg2) };
    }
    case "grid": {
      const sums = p.options.map(() => [0, 0]);
      for (const r of responses) (r as [number, number][]).forEach((xy, i) => i < sums.length && ((sums[i][0] += xy[0]), (sums[i][1] += xy[1])));
      return { total, pairs: sums.map(([x, y]) => [avg2(x), avg2(y)] as [number, number]) };
    }
    case "pin":
      return { total, pins: (responses as unknown as [number, number][]).slice(-500).reverse() };
    case "multiple":
    case "quiz": {
      const counts = p.options.map(() => 0);
      for (const r of responses) for (const i of r as number[]) if (i >= 0 && i < counts.length) counts[i]++;
      return { total, counts };
    }
    case "rating":
    case "scale": {
      const min = p.type === "rating" ? 1 : (p.range ?? DEFAULT_RANGE).min;
      const max = p.type === "rating" ? p.scale || 5 : (p.range ?? DEFAULT_RANGE).max;
      const counts = Array.from({ length: max - min + 1 }, () => 0);
      let sum = 0;
      for (const r of responses) {
        const n = r as number;
        if (n >= min && n <= max) counts[n - min]++;
        sum += n;
      }
      return { total, counts, avg: total ? Math.round((sum / total) * 10) / 10 : 0 };
    }
    case "ranking": {
      // Borda count: first place gets n-1 points, last gets 0. Report the average.
      const n = p.options.length;
      const sums = p.options.map(() => 0);
      for (const r of responses) (r as number[]).forEach((opt, pos) => opt >= 0 && opt < n && (sums[opt] += n - 1 - pos));
      return { total, scores: sums.map((s) => (total ? Math.round((s / total) * 100) / 100 : 0)) };
    }
    case "wordcloud": {
      const m = new Map<string, number>();
      for (const r of responses) for (const w of r as string[]) m.set(w, (m.get(w) ?? 0) + 1);
      const words = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 60);
      return { total, words };
    }
    case "open":
      return { total, answers: (responses as string[]).slice(-100).reverse() };
  }
}

/** Tallies all responses for a poll (surveys get one result per question). */
export function tally(p: Pick<Poll, "type" | "options" | "scale" | "range" | "items">, responses: ResponseValue[]): Results {
  if (p.type === "survey") {
    const items = p.items.map((it, i) =>
      tallyItem(
        it,
        responses.map((r) => (r as unknown[])[i]).filter((x) => x !== null && x !== undefined) as ResponseValue[],
      ),
    );
    return { total: responses.length, items };
  }
  return tallyItem(p as unknown as Item, responses);
}

// ---------- quiz scoring ----------

/**
 * Points for one quiz answer. Correct answers earn 500–1000 points: faster answers earn more.
 * Without a timer every correct answer earns 1000.
 */
export function quizPoints(correct: number[], answer: number[], timeLimit: number, elapsedMs: number): number {
  const right = correct.length === answer.length && correct.every((c) => answer.includes(c));
  if (!right) return 0;
  if (!timeLimit) return 1000;
  const frac = Math.min(1, Math.max(0, elapsedMs / (timeLimit * 1000)));
  return Math.round(1000 - 500 * frac);
}

// ---------- misc ----------

/** Simple token bucket: `rate` actions per `perMs`. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private rate: number, private perMs: number) {}
  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.rate, at: now };
    b.tokens = Math.min(this.rate, b.tokens + ((now - b.at) / this.perMs) * this.rate);
    b.at = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 20_000) this.buckets.clear();
    return true;
  }
}

export function toCsv(rows: (string | number)[][]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

/** Human-readable answer for exports. */
export function describeAnswer(p: { type: string; options: string[] }, v: unknown): string {
  if (v === null || v === undefined) return "";
  switch (p.type) {
    case "points":
      return (v as number[]).map((n, i) => (n ? `${p.options[i] ?? "?"}: ${n}` : "")).filter(Boolean).join("; ");
    case "grid":
      return (v as [number, number][]).map((xy, i) => `${p.options[i] ?? "?"} (${xy[0]}, ${xy[1]})`).join("; ");
    case "pin":
      return `${Math.round((v as number[])[0] * 100)}% across, ${Math.round((v as number[])[1] * 100)}% down`;
    case "multiple":
    case "quiz":
      return (v as number[]).map((i) => p.options[i] ?? "?").join("; ");
    case "ranking":
      return (v as number[]).map((i, pos) => `${pos + 1}. ${p.options[i] ?? "?"}`).join("  ");
    case "wordcloud":
      return (v as string[]).join(", ");
    default:
      return String(v);
  }
}

// ---------- word filter ----------

/** Common English swear words. Hosts can add their own in settings. */
const BAD_WORDS = [
  "arse", "arsehole", "ass", "asshole", "bastard", "bitch", "bollocks", "bullshit", "cock", "crap", "cunt", "damn",
  "dick", "dickhead", "douche", "fuck", "fucker", "fucking", "goddamn", "jackass", "motherfucker", "piss", "prick",
  "pussy", "shit", "shitty", "slut", "twat", "wanker", "whore",
];
const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const filterCache = new Map<string, RegExp>();

function wordRegex(extra: readonly string[]): RegExp {
  const key = extra.join("\u0000");
  let re = filterCache.get(key);
  if (!re) {
    const words = [...new Set([...BAD_WORDS, ...extra.map((w) => w.toLowerCase())])].filter(Boolean).sort((a, b) => b.length - a.length);
    // Whole words only, so "class" or "Scunthorpe" are left alone. Plural/-s endings are caught too.
    re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(esc).join("|")})(?:s|es)?(?![\\p{L}\\p{N}])`, "giu");
    if (filterCache.size > 50) filterCache.clear();
    filterCache.set(key, re);
  }
  re.lastIndex = 0;
  return re;
}

/** Replaces filtered words with asterisks (keeping the first letter). Returns whether anything matched. */
export function maskWords(text: string, extra: readonly string[] = []): { text: string; hit: boolean } {
  let hit = false;
  const out = text.replace(wordRegex(extra), (m) => {
    hit = true;
    return m[0] + "*".repeat(Math.max(2, m.length - 1));
  });
  return { text: out, hit };
}

export function cleanBlockedWords(words: unknown): string[] {
  const list = (Array.isArray(words) ? words : String(words ?? "").split(/[\n,]/)).map((w) => clean(w, 30).toLowerCase()).filter(Boolean);
  return [...new Set(list)].slice(0, LIMITS.blockedWords);
}

// ---------- labels and rooms ----------

export function cleanLabels(list: unknown, newId: () => string): { id: string; name: string; color: LabelColor }[] {
  const arr = Array.isArray(list) ? list : [];
  const seen = new Set<string>();
  const out: { id: string; name: string; color: LabelColor }[] = [];
  for (const l of arr) {
    const name = clean(l?.name, LIMITS.label);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const id = typeof l?.id === "string" && /^[a-z0-9]{1,12}$/.test(l.id) ? l.id : newId();
    out.push({ id, name, color: (LABEL_COLORS as readonly string[]).includes(l?.color) ? l.color : LABEL_COLORS[out.length % LABEL_COLORS.length] });
    if (out.length >= LIMITS.labels) break;
  }
  return out;
}

export function cleanRooms(list: unknown, newId: () => string): { id: string; name: string }[] {
  const arr = Array.isArray(list) ? list : [];
  const out: { id: string; name: string }[] = [];
  for (const r of arr) {
    const name = clean(r?.name, LIMITS.room);
    if (!name) continue;
    const id = typeof r?.id === "string" && /^[a-z0-9]{1,12}$/.test(r.id) ? r.id : newId();
    if (out.some((x) => x.id === id)) continue;
    out.push({ id, name });
    if (out.length >= LIMITS.rooms) break;
  }
  return out;
}

/** Plain-text description of one poll's results, for the AI recap. Short on purpose. */
export function resultsText(p: { type: string; title: string; options: string[]; correct?: number[] }, r: Results, depth = 0): string {
  const pad = depth ? "  " : "";
  const head = `${pad}${p.type === "quiz" ? "Quiz" : "Poll"}: ${p.title} (${r.total} ${r.total === 1 ? "answer" : "answers"})`;
  if (!r.total) return head;
  const pct = (n: number) => `${Math.round((n / r.total) * 100)}%`;
  const lines: string[] = [];
  switch (p.type) {
    case "multiple":
    case "quiz":
      p.options.forEach((o, i) => lines.push(`${o}: ${pct(r.counts?.[i] ?? 0)}${p.type === "quiz" && p.correct?.includes(i) ? " (correct)" : ""}`));
      break;
    case "rating":
    case "scale":
      lines.push(`average ${r.avg}`);
      break;
    case "ranking":
    case "points": {
      const order = p.options.map((o, i) => [o, r.scores?.[i] ?? 0] as const).sort((a, b) => b[1] - a[1]);
      lines.push(p.type === "ranking" ? `ranked: ${order.map(([o]) => o).join(" > ")}` : order.map(([o, s]) => `${o}: ${s} points`).join(", "));
      break;
    }
    case "grid":
      p.options.forEach((o, i) => lines.push(`${o}: ${r.pairs?.[i]?.join(", ")}`));
      break;
    case "wordcloud":
      lines.push(`top words: ${(r.words ?? []).slice(0, 12).map(([w, n]) => `${w} (${n})`).join(", ")}`);
      break;
    case "open":
      for (const a of (r.answers ?? []).slice(0, 12)) lines.push(`"${a.slice(0, 160)}"`);
      break;
    case "pin":
      lines.push(`${r.total} pins on an image`);
      break;
  }
  return [head, ...lines.map((l) => `${pad}  - ${l}`)].join("\n");
}

/**
 * Team standings. Teams are ranked by average points per player who played,
 * so a team of 3 can beat a team of 12. Ties go to the team with more total points.
 */
export function teamScores(
  teams: { id: string; name: string; color: LabelColor }[],
  teamOf: Map<string, string>,
  scores: Map<string, { points: number }>,
): TeamScore[] {
  const members = new Map<string, number>();
  for (const t of teamOf.values()) members.set(t, (members.get(t) ?? 0) + 1);
  const totals = new Map<string, { points: number; players: number }>();
  for (const [pid, s] of scores) {
    const team = teamOf.get(pid);
    if (!team) continue;
    const cur = totals.get(team) ?? { points: 0, players: 0 };
    cur.points += s.points;
    cur.players++;
    totals.set(team, cur);
  }
  return teams
    .map((t) => {
      const x = totals.get(t.id) ?? { points: 0, players: 0 };
      return { id: t.id, name: t.name, color: t.color, points: x.points, players: x.players, members: members.get(t.id) ?? 0, avg: x.players ? Math.round(x.points / x.players) : 0 };
    })
    .sort((a, b) => b.avg - a.avg || b.points - a.points || a.name.localeCompare(b.name));
}
