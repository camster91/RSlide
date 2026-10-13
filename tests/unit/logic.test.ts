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
  maskWords,
  cleanBlockedWords,
  cleanLabels,
  cleanRooms,
} from "../../src/worker/logic";
import { buildXlsx } from "../../src/worker/xlsx";

const draft = (over: Record<string, unknown> = {}) => ({ type: "multiple" as const, title: "Q", options: ["a", "b"], correct: [], multi: false, ...over });

describe("validatePoll", () => {
  it("cleans and keeps valid options", () => {
    const p = validatePoll(draft({ title: "  Best   option? ", options: ["A", " ", "B "], multi: true }));
    expect(p).toMatchObject({ type: "multiple", title: "Best option?", options: ["A", "B"], multi: true });
  });
  it("keeps an optional picture on any question, and requires one for pin questions", () => {
    expect(validatePoll(draft({ image: "abcdefabcdef" })).image).toBe("abcdefabcdef");
    expect(validatePoll(draft({ image: "../etc/passwd" })).image).toBeNull();
    expect(validatePoll(draft()).image).toBeNull();
    expect(() => validatePoll(draft({ type: "pin", options: [] }))).toThrow("picture");
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
        { type: "rating" as const, title: "a", options: [], images: [], multi: false, scale: 5, range: null, axes: null, image: null },
        { type: "open" as const, title: "b", options: [], images: [], multi: false, scale: 0, range: null, axes: null, image: null },
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
      { type: "rating" as const, title: "a", options: [], images: [], multi: false, scale: 5, range: null, axes: null, image: null },
      { type: "open" as const, title: "b", options: [], images: [], multi: false, scale: 0, range: null, axes: null, image: null },
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

describe("phase 2 poll types", () => {
  const base = { multi: false, scale: 0, range: null, items: [] };
  it("100 points: shares must add up to 100 or less", () => {
    const p = { ...base, type: "points" as const, options: ["a", "b", "c"] };
    expect(validateResponse(p, [50, 30, 20])).toEqual([50, 30, 20]);
    expect(validateResponse(p, [10, 0, 0])).toEqual([10, 0, 0]);
    expect(() => validateResponse(p, [60, 50, 0])).toThrow("only have 100");
    expect(() => validateResponse(p, [0, 0, 0])).toThrow("at least one");
    expect(() => validateResponse(p, [-5, 50, 0])).toThrow();
    expect(tally(p, [[50, 50, 0], [100, 0, 0]]).scores).toEqual([75, 25, 0]);
  });
  it("2x2 grid: every option needs an x and y inside the range", () => {
    const d = validatePoll({ type: "grid", title: "Plot", options: ["a", "b"], correct: [], multi: false, axes: ["Value", ""] });
    expect(d.axes).toEqual(["Value", "Effort"]);
    expect(d.range).toMatchObject({ min: 1, max: 10 });
    const p = { ...base, type: "grid" as const, options: ["a", "b"], range: d.range };
    expect(validateResponse(p, [[1, 10], [5, 5]])).toEqual([[1, 10], [5, 5]]);
    expect(() => validateResponse(p, [[1, 11], [5, 5]])).toThrow("grid");
    expect(() => validateResponse(p, [[1, 2]])).toThrow("grid");
    expect(tally(p, [[[2, 4], [6, 6]], [[4, 8], [6, 7]]]).pairs).toEqual([[3, 6], [6, 6.5]]);
  });
  it("pin on image: needs a picture, and taps between 0 and 1", () => {
    expect(() => validatePoll({ type: "pin", title: "Where?", options: [], correct: [], multi: false })).toThrow("picture");
    expect(validatePoll({ type: "pin", title: "Where?", options: [], correct: [], multi: false, image: "aaaaaaaaaaaa" }).image).toBe("aaaaaaaaaaaa");
    const p = { ...base, type: "pin" as const, options: [] };
    expect(validateResponse(p, [0.12345, 1])).toEqual([0.123, 1]);
    expect(() => validateResponse(p, [1.2, 0])).toThrow("pin");
    expect(tally(p, [[0.1, 0.2], [0.3, 0.4]]).pins).toEqual([[0.3, 0.4], [0.1, 0.2]]);
  });
  it("describes the new answers for exports", () => {
    expect(describeAnswer({ type: "points", options: ["a", "b"] }, [70, 0])).toBe("a: 70");
    expect(describeAnswer({ type: "pin", options: [] }, [0.5, 0.25])).toBe("50% across, 25% down");
  });
});

describe("word filter", () => {
  it("masks whole words only, keeping the first letter", () => {
    expect(maskWords("This is shit, really")).toEqual({ text: "This is s***, really", hit: true });
    expect(maskWords("A classic Scunthorpe assessment").hit).toBe(false);
  });
  it("catches plurals and capitals", () => expect(maskWords("Damns and SHITS").text).toBe("D**** and S****"));
  it("uses the host's own words", () => {
    expect(maskWords("Ask about competitorX now", ["competitorx"]).text).toBe("Ask about c********** now");
  });
  it("cleans the host's word list", () => expect(cleanBlockedWords(" Foo, bar\nfoo ,, ")).toEqual(["foo", "bar"]));
});

describe("labels and rooms", () => {
  let n = 0;
  const id = () => `id${++n}`;
  it("keeps up to 12 unique labels with valid colours", () => {
    const l = cleanLabels([{ name: "Finance", color: "green" }, { name: "finance" }, { name: "  " }, { name: "HR", color: "pink" }], id);
    expect(l.map((x) => x.name)).toEqual(["Finance", "HR"]);
    expect(l[0].color).toBe("green");
    expect(l[1].color).not.toBe("pink");
  });
  it("keeps room IDs so questions stay in their room", () => {
    const r = cleanRooms([{ id: "main", name: "Main stage" }, { name: "Workshop" }, { name: "" }], id);
    expect(r[0]).toEqual({ id: "main", name: "Main stage" });
    expect(r).toHaveLength(2);
  });
});

import { teamScores } from "../../src/worker/logic";

describe("team scores", () => {
  const teams = [
    { id: "a", name: "Alpha", color: "blue" as const },
    { id: "b", name: "Bravo", color: "red" as const },
    { id: "c", name: "Charlie", color: "green" as const },
  ];
  it("ranks by average so small teams can win", () => {
    const teamOf = new Map([["p1", "a"], ["p2", "a"], ["p3", "a"], ["p4", "b"], ["p5", "b"]]);
    const scores = new Map([["p1", { points: 500 }], ["p2", { points: 500 }], ["p3", { points: 500 }], ["p4", { points: 900 }]]);
    const r = teamScores(teams, teamOf, scores);
    expect(r.map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(r[0]).toMatchObject({ points: 900, players: 1, members: 2, avg: 900 });
    expect(r[1]).toMatchObject({ points: 1500, players: 3, members: 3, avg: 500 });
    expect(r[2]).toMatchObject({ points: 0, players: 0, members: 0, avg: 0 });
  });
  it("ignores players without a team and breaks ties on total points", () => {
    const teamOf = new Map([["p1", "a"], ["p2", "b"], ["p3", "b"]]);
    const scores = new Map([["p1", { points: 600 }], ["p2", { points: 600 }], ["p3", { points: 600 }], ["solo", { points: 5000 }]]);
    const r = teamScores(teams, teamOf, scores);
    expect(r.map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(r.reduce((n, x) => n + x.points, 0)).toBe(1800);
  });
});

import { cleanDeckUrl } from "../../src/worker/logic";
describe("cleanDeckUrl", () => {
  it("turns Google Slides links into embed links", () => {
    expect(cleanDeckUrl("https://docs.google.com/presentation/d/1AbC_d-9/edit#slide=id.p")).toBe("https://docs.google.com/presentation/d/1AbC_d-9/embed?start=false&loop=false&rm=minimal");
    expect(cleanDeckUrl("https://docs.google.com/presentation/d/e/2PACX-1vX/pub?start=false")).toBe("https://docs.google.com/presentation/d/e/2PACX-1vX/embed?start=false&loop=false");
  });
  it("takes the link out of pasted iframe code", () => {
    expect(cleanDeckUrl('<iframe src="https://onedrive.live.com/embed?resid=1&amp;em=2" width="1"></iframe>')).toBe("https://onedrive.live.com/embed?resid=1&em=2");
  });
  it("makes Canva links embeddable", () => {
    expect(cleanDeckUrl("https://www.canva.com/design/DAF1/abc/view")).toBe("https://www.canva.com/design/DAF1/abc/view?embed");
  });
  it("refuses non-https links and allows clearing", () => {
    expect(() => cleanDeckUrl("http://example.com/x")).toThrow("https");
    expect(() => cleanDeckUrl("javascript:alert(1)")).toThrow("https");
    expect(() => cleanDeckUrl("not a link")).toThrow("https");
    expect(cleanDeckUrl("")).toBeNull();
    expect(cleanDeckUrl(null)).toBeNull();
  });
});
