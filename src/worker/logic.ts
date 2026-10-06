// Pure helpers used by the event room. No Cloudflare APIs here, so they're easy to unit test.
import { LIMITS, POLL_TYPES, type Poll, type PollDraft, type PollType, type ResponseValue, type Results } from "../shared/protocol";

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

export const clean = (s: unknown, max: number): string =>
  String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export const normCode = (c: unknown): string => String(c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Validates a poll definition from the host. Throws UserError with a friendly message. */
export function validatePoll(draft: PollDraft): Omit<Poll, "id" | "ord" | "status" | "showResults" | "revealed"> & { correct: number[] } {
  const type: PollType = POLL_TYPES.includes(draft?.type) ? draft.type : "multiple";
  const title = clean(draft?.title, LIMITS.question);
  if (!title) throw new UserError("Poll needs a question");
  let options: string[] = [];
  let correct: number[] = [];
  if (type === "multiple" || type === "quiz") {
    options = (Array.isArray(draft.options) ? draft.options : []).map((o) => clean(o, LIMITS.option)).filter(Boolean).slice(0, LIMITS.options);
    if (options.length < 2) throw new UserError("Add at least 2 options");
  }
  if (type === "quiz") {
    correct = [...new Set((Array.isArray(draft.correct) ? draft.correct : []).map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n < options.length);
    if (!correct.length) throw new UserError("Mark the correct answer");
  }
  return { type, title, options, correct, multi: type === "multiple" && !!draft.multi, scale: type === "rating" ? 5 : 0 };
}

/** Validates an attendee's answer for a poll. */
export function validateResponse(p: Pick<Poll, "type" | "options" | "multi" | "scale">, value: unknown): ResponseValue {
  switch (p.type) {
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

/** Tallies all responses for a poll. */
export function tally(p: Pick<Poll, "type" | "options" | "scale">, responses: ResponseValue[]): Results {
  const total = responses.length;
  switch (p.type) {
    case "multiple":
    case "quiz": {
      const counts = p.options.map(() => 0);
      for (const r of responses) for (const i of r as number[]) if (i >= 0 && i < counts.length) counts[i]++;
      return { total, counts };
    }
    case "rating": {
      const counts = Array.from({ length: p.scale || 5 }, () => 0);
      let sum = 0;
      for (const r of responses) {
        const n = r as number;
        if (n >= 1 && n <= counts.length) counts[n - 1]++;
        sum += n;
      }
      return { total, counts, avg: total ? Math.round((sum / total) * 10) / 10 : 0 };
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
