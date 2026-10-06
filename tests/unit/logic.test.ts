import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  clean,
  cleanEmail,
  describeAnswer,
  normCode,
  normPasscode,
  quizPoints,
  RateLimiter,
  tally,
  toCsv,
  UserError,
  validatePoll,
  validateResponse,
} from "../../src/worker/logic";
import { buildXlsx } from "../../src/worker/xlsx";

const draft = (over: Record<string, unknown> = {}) => ({ type: "multiple" as const, title: "Q", options: ["a", "b"], correct: [], multi: false, ...over });

describe("validatePoll", () => {
  it("cleans and keeps valid options", () => {
    const p = validatePoll(draft({ title: "  Best   option? ", options: ["A", " ", "B "], multi: true }));
    expect(p).toMatchObject({ type: "multiple", title: "Best option?", options: ["A", "B"], multi: true });
  });
  it("needs a title and two options", () => {
    expect(() => validatePoll(draft({ title: "" }))).toThrow(UserError);
    expect(() => validatePoll(draft({ options: ["a"] }))).toThrow("at least 2");
  });
  it("needs a correct answer for quizzes, inside the option range", () => {
    expect(() => validatePoll(draft({ type: "quiz", correct: [5] }))).toThrow("correct");
    expect(validatePoll(draft({ type: "quiz", correct: [1, 1] })).correct).toEqual([1]);
    expect(validatePoll(draft({ type: "quiz", correct: [1, 1] })).multi).toBe(false);
    expect(validatePoll(draft({ type: "quiz", correct: [0, 1] })).multi).toBe(true);
  });
  it("gives quizzes a 20 second timer by default, capped at 5 minutes", () => {
    expect(validatePoll(draft({ type: "quiz", correct: [0] })).timeLimit).toBe(20);
    expect(validatePoll(draft({ type: "quiz", correct: [0], timeLimit: 9999 })).timeLimit).toBe(300);
    expect(validatePoll(draft({ type: "quiz", correct: [0], timeLimit: 0 })).timeLimit).toBe(0);
  });
  it("falls back to multiple choice for unknown types", () => {
    expect(validatePoll(draft({ type: "nope" })).type).toBe("multiple");
  });
  it("caps options at 10", () => {
    const options = Array.from({ length: 15 }, (_, i) => `o${i}`);
    expect(validatePoll(draft({ options })).options).toHaveLength(10);
  });
  it("keeps images lined up with their options and drops bad image IDs", () => {
    const p = validatePoll(draft({ options: ["a", "", "c"], images: ["aaaaaaaaaaaa", null, "../../etc"] }));
    expect(p.options).toEqual(["a", "c"]);
    expect(p.images).toEqual(["aaaaaaaaaaaa", null]);
  });
  it("allows image-only options", () => {
    const p = validatePoll(draft({ options: ["", ""], images: ["aaaaaaaaaaaa", "bbbbbbbbbbbb"] }));
    expect(p.options).toEqual(["Option 1", "Option 2"]);
  });
  it("cleans scale ranges", () => {
    expect(validatePoll(draft({ type: "scale", range: { min: 5, max: 2, maxLabel: "  Great " } })).range).toEqual({ min: 5, max: 6, minLabel: "", maxLabel: "Great" });
    expect(validatePoll(draft({ type: "scale" })).range).toEqual({ min: 1, max: 10, minLabel: "", maxLabel: "" });
  });
  it("validates every survey question", () => {
    const s = validatePoll(draft({ type: "survey", items: [{ type: "rating", title: "How was it?" }, { type: "open", title: "Why?" }] }));
    expect(s.items.map((i) => i.type)).toEqual(["rating", "open"]);
    expect(() => validatePoll(draft({ type: "survey", items: [] }))).toThrow("at least one");
    expect(() => validatePoll(draft({ type: "survey", items: [{ type: "multiple", title: "x", options: ["only"] }] }))).toThrow("at least 2");
  });
});

describe("validateResponse", () => {
  const mc = { type: "multiple" as const, options: ["a", "b", "c"], multi: false, scale: 0, range: null, items: [] };
  it("accepts one option for single choice", () => expect(validateResponse(mc, [2])).toEqual([2]));
  it("rejects two options for single choice", () => expect(() => validateResponse(mc, [0, 1])).toThrow("one option"));
  it("allows several for multi choice", () => expect(validateResponse({ ...mc, multi: true }, [0, 2, 2])).toEqual([0, 2]));
  it("ignores out-of-range options", () => expect(() => validateResponse(mc, [9])).toThrow("Pick an option"));
  it("checks rating range", () => {
    const r = { ...mc, type: "rating" as const, scale: 5 };
    expect(validateResponse(r, 5)).toBe(5);
    expect(() => validateResponse(r, 6)).toThrow();
    expect(() => validateResponse(r, 2.5)).toThrow();
  });
  it("checks scale range", () => {
    const s = { ...mc, type: "scale" as const, range: { min: 0, max: 10, minLabel: "", maxLabel: "" } };
    expect(validateResponse(s, 0)).toBe(0);
    expect(() => validateResponse(s, 11)).toThrow("scale");
  });
  it("needs a full ranking with no repeats", () => {
    const r = { ...mc, type: "ranking" as const };
    expect(validateResponse(r, [2, 0, 1])).toEqual([2, 0, 1]);
    expect(() => validateResponse(r, [0, 0, 1])).toThrow("order");
    expect(() => validateResponse(r, [0, 1])).toThrow("order");
  });
  it("lowercases and limits word-cloud words", () => {
    expect(validateResponse({ ...mc, type: "wordcloud" as const }, ["Hello", "WORLD", "a", "b"])).toEqual(["hello", "world", "a"]);
  });
  it("trims open text", () => {
    const o = { ...mc, type: "open" as const };
    expect(validateResponse(o, "  hi   there ")).toBe("hi there");
    expect(() => validateResponse(o, "   ")).toThrow();
  });
  it("validates surveys question by question and allows skips", () => {
    const survey = {
      ...mc,
      type: "survey" as const,
      items: [
        { type: "rating" as const, title: "a", options: [], images: [], multi: false, scale: 5, range: null },
        { type: "open" as const, title: "b", options: [], images: [], multi: false, scale: 0, range: null },
      ],
    };
    expect(validateResponse(survey, [4, null])).toEqual([4, null]);
    expect(() => validateResponse(survey, [null, ""])).toThrow("at least one");
    expect(() => validateResponse(survey, [9, "x"])).toThrow("rating");
    expect(() => validateResponse(survey, [4])).toThrow();
  });
});

describe("tally", () => {
  const base = { options: [] as string[], scale: 0, range: null, items: [] };
  it("counts multiple choice", () => {
    expect(tally({ ...base, type: "multiple", options: ["a", "b"] }, [[0], [1], [1], [0, 1]])).toEqual({ total: 4, counts: [2, 3] });
  });
  it("averages ratings", () => {
    expect(tally({ ...base, type: "rating", scale: 5 }, [5, 4, 4])).toEqual({ total: 3, counts: [0, 0, 0, 2, 1], avg: 4.3 });
  });
  it("buckets scale answers from the range minimum", () => {
    expect(tally({ ...base, type: "scale", range: { min: 0, max: 2, minLabel: "", maxLabel: "" } }, [0, 2, 2])).toEqual({ total: 3, counts: [1, 0, 2], avg: 1.3 });
  });
  it("scores rankings with a Borda count", () => {
    // Option 2 ranked first twice; option 0 always last.
    const r = tally({ ...base, type: "ranking", options: ["a", "b", "c"] }, [[2, 1, 0], [2, 1, 0], [1, 2, 0]]);
    expect(r.scores).toEqual([0, 1.33, 1.67]);
  });
  it("ranks word cloud words", () => {
    expect(tally({ ...base, type: "wordcloud" }, [["b", "a"], ["a"]]).words).toEqual([
      ["a", 2],
      ["b", 1],
    ]);
  });
  it("shows newest open answers first", () => {
    expect(tally({ ...base, type: "open" }, ["first", "second"]).answers).toEqual(["second", "first"]);
  });
  it("tallies each survey question, ignoring skips", () => {
    const items = [
      { type: "rating" as const, title: "a", options: [], images: [], multi: false, scale: 5, range: null },
      { type: "open" as const, title: "b", options: [], images: [], multi: false, scale: 0, range: null },
    ];
    const r = tally({ ...base, type: "survey", items }, [[5, "great"], [3, null]]);
    expect(r.total).toBe(2);
    expect(r.items![0]).toMatchObject({ total: 2, avg: 4 });
    expect(r.items![1]).toMatchObject({ total: 1, answers: ["great"] });
  });
  it("handles no responses", () => {
    expect(tally({ ...base, type: "rating", scale: 5 }, [])).toMatchObject({ total: 0, avg: 0 });
  });
});

describe("quizPoints", () => {
  it("gives 0 for wrong answers", () => expect(quizPoints([1], [0], 20, 1000)).toBe(0));
  it("gives 1000 for instant correct answers and 500 at the buzzer", () => {
    expect(quizPoints([1], [1], 20, 0)).toBe(1000);
    expect(quizPoints([1], [1], 20, 10_000)).toBe(750);
    expect(quizPoints([1], [1], 20, 20_000)).toBe(500);
    expect(quizPoints([1], [1], 20, 25_000)).toBe(500);
  });
  it("gives 1000 for any correct answer when there's no timer", () => expect(quizPoints([0, 2], [2, 0], 0, 99_999)).toBe(1000));
  it("needs every correct option and nothing else", () => {
    expect(quizPoints([0, 2], [0], 0, 0)).toBe(0);
    expect(quizPoints([0], [0, 1], 0, 0)).toBe(0);
  });
});

describe("helpers", () => {
  it("clean collapses whitespace and cuts length", () => expect(clean("  a \n\n b  ", 3)).toBe("a b"));
  it("normCode uppercases and strips junk", () => expect(normCode(" ab-c 12 ")).toBe("ABC12"));
  it("passcodes ignore case and spaces at the ends", () => expect(normPasscode("  Tiger ")).toBe("tiger"));
  it("checks email addresses", () => {
    expect(cleanEmail(" Sam@Example.com ")).toBe("sam@example.com");
    expect(() => cleanEmail("sam@")).toThrow("valid email");
  });
  it("describes answers in plain words", () => {
    expect(describeAnswer({ type: "ranking", options: ["a", "b"] }, [1, 0])).toBe("1. b  2. a");
    expect(describeAnswer({ type: "multiple", options: ["a", "b"] }, [0, 1])).toBe("a; b");
  });
  it("toCsv escapes quotes and adds BOM", () => expect(toCsv([["a", 'say "hi"']])).toBe('﻿"a","say ""hi"""'));
  it("rate limiter blocks bursts and refills", () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.take("x", 0)).toBe(true);
    expect(rl.take("x", 0)).toBe(true);
    expect(rl.take("x", 0)).toBe(false);
    expect(rl.take("x", 600)).toBe(true);
  });
});

describe("buildXlsx", () => {
  it("makes a valid workbook with escaped text and unique sheet names", () => {
    const file = buildXlsx([
      { name: "Questions", rows: [["Text", "Votes"], ["Is 5 < 6 & \"true\"?", 3]] },
      { name: "Questions", rows: [["x"]] },
    ]);
    const files = unzipSync(file);
    expect(Object.keys(files)).toContain("xl/worksheets/sheet2.xml");
    const wb = strFromU8(files["xl/workbook.xml"]);
    expect(wb).toContain('name="Questions"');
    expect(wb).toContain('name="Questions 2"');
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("Is 5 &lt; 6 &amp; &quot;true&quot;?");
    expect(sheet).toContain("<v>3</v>");
  });
});
