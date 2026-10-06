import { describe, expect, it } from "vitest";
import { clean, normCode, RateLimiter, tally, toCsv, UserError, validatePoll, validateResponse } from "../../src/worker/logic";

describe("validatePoll", () => {
  it("cleans and keeps valid options", () => {
    const p = validatePoll({ type: "multiple", title: "  Best   option? ", options: ["A", " ", "B "], correct: [], multi: true });
    expect(p).toMatchObject({ type: "multiple", title: "Best option?", options: ["A", "B"], multi: true });
  });
  it("needs a title and two options", () => {
    expect(() => validatePoll({ type: "multiple", title: "", options: ["a", "b"], correct: [], multi: false })).toThrow(UserError);
    expect(() => validatePoll({ type: "multiple", title: "x", options: ["a"], correct: [], multi: false })).toThrow("at least 2");
  });
  it("needs a correct answer for quizzes, inside the option range", () => {
    expect(() => validatePoll({ type: "quiz", title: "x", options: ["a", "b"], correct: [5], multi: false })).toThrow("correct");
    expect(validatePoll({ type: "quiz", title: "x", options: ["a", "b"], correct: [1, 1], multi: false }).correct).toEqual([1]);
  });
  it("falls back to multiple choice for unknown types", () => {
    expect(validatePoll({ type: "nope" as never, title: "x", options: ["a", "b"], correct: [], multi: false }).type).toBe("multiple");
  });
  it("caps options at 10", () => {
    const options = Array.from({ length: 15 }, (_, i) => `o${i}`);
    expect(validatePoll({ type: "multiple", title: "x", options, correct: [], multi: false }).options).toHaveLength(10);
  });
});

describe("validateResponse", () => {
  const mc = { type: "multiple" as const, options: ["a", "b", "c"], multi: false, scale: 0 };
  it("accepts one option for single choice", () => expect(validateResponse(mc, [2])).toEqual([2]));
  it("rejects two options for single choice", () => expect(() => validateResponse(mc, [0, 1])).toThrow("one option"));
  it("allows several for multi choice", () => expect(validateResponse({ ...mc, multi: true }, [0, 2, 2])).toEqual([0, 2]));
  it("ignores out-of-range options", () => expect(() => validateResponse(mc, [9])).toThrow("Pick an option"));
  it("checks rating range", () => {
    const r = { type: "rating" as const, options: [], multi: false, scale: 5 };
    expect(validateResponse(r, 5)).toBe(5);
    expect(() => validateResponse(r, 6)).toThrow();
    expect(() => validateResponse(r, 2.5)).toThrow();
  });
  it("lowercases and limits word-cloud words", () => {
    const w = { type: "wordcloud" as const, options: [], multi: false, scale: 0 };
    expect(validateResponse(w, ["Hello", "WORLD", "a", "b"])).toEqual(["hello", "world", "a"]);
  });
  it("trims open text", () => {
    const o = { type: "open" as const, options: [], multi: false, scale: 0 };
    expect(validateResponse(o, "  hi   there ")).toBe("hi there");
    expect(() => validateResponse(o, "   ")).toThrow();
  });
});

describe("tally", () => {
  it("counts multiple choice", () => {
    expect(tally({ type: "multiple", options: ["a", "b"], scale: 0 }, [[0], [1], [1], [0, 1]])).toEqual({ total: 4, counts: [2, 3] });
  });
  it("averages ratings", () => {
    expect(tally({ type: "rating", options: [], scale: 5 }, [5, 4, 4])).toEqual({ total: 3, counts: [0, 0, 0, 2, 1], avg: 4.3 });
  });
  it("ranks word cloud words", () => {
    const r = tally({ type: "wordcloud", options: [], scale: 0 }, [["b", "a"], ["a"]]);
    expect(r.words).toEqual([
      ["a", 2],
      ["b", 1],
    ]);
  });
  it("shows newest open answers first", () => {
    expect(tally({ type: "open", options: [], scale: 0 }, ["first", "second"]).answers).toEqual(["second", "first"]);
  });
  it("handles no responses", () => {
    expect(tally({ type: "rating", options: [], scale: 5 }, [])).toMatchObject({ total: 0, avg: 0 });
  });
});

describe("helpers", () => {
  it("clean collapses whitespace and cuts length", () => expect(clean("  a \n\n b  ", 3)).toBe("a b"));
  it("normCode uppercases and strips junk", () => expect(normCode(" ab-c 12 ")).toBe("ABC12"));
  it("toCsv escapes quotes and adds BOM", () => expect(toCsv([["a", 'say "hi"']])).toBe('﻿"a","say ""hi"""'));
  it("rate limiter blocks bursts and refills", () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.take("x", 0)).toBe(true);
    expect(rl.take("x", 0)).toBe(true);
    expect(rl.take("x", 0)).toBe(false);
    expect(rl.take("x", 600)).toBe(true);
  });
});
