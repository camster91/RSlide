import { describe, expect, it, vi } from "vitest";
import { DUPLICATE_SCORE, findSimilar, keywords, similarity, SUGGEST_SCORE, vectorScore } from "../../src/shared/similar";
import { aiAvailable, embed, packVector, unpackVector } from "../../src/worker/ai";

describe("similar questions", () => {
  it("keeps the words that matter", () => {
    expect(keywords("Will the slides be shared after the talk?")).toEqual(["slide", "shar", "after", "talk"]);
    expect(keywords("Café opening hours")).toEqual(["cafe", "open", "hour"]);
  });

  const same: [string, string][] = [
    ["When is the break?", "What time is the break"],
    ["Will the slides be shared after the talk?", "Can you share the slides afterwards?"],
    ["Is there a recording of this session?", "Will this session be recorded?"],
    ["What is the budget for next year?", "whats next years budget"],
    ["Any plans to hire more engineers?", "Are we hiring more engineers this year?"],
  ];
  const different: [string, string][] = [
    ["When is the break?", "When is the next all hands?"],
    ["Will the slides be shared after the talk?", "What tools did you use to make the slides?"],
    ["What is the budget for next year?", "What are the goals for next year?"],
    ["Any plans to hire more engineers?", "Any plans to open an office in Europe?"],
    ["Is the cafeteria open late?", "Is parking free?"],
  ];

  it.each(same)("matches %s / %s", (a, b) => {
    expect(similarity(a, b)).toBeGreaterThanOrEqual(DUPLICATE_SCORE);
  });

  it.each(different)("does not flag %s / %s", (a, b) => {
    expect(similarity(a, b)).toBeLessThan(DUPLICATE_SCORE);
  });

  it("is symmetric enough and bounded", () => {
    for (const [a, b] of [...same, ...different]) {
      const x = similarity(a, b);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(Math.abs(x - similarity(b, a))).toBeLessThan(0.15);
    }
    expect(similarity("", "anything")).toBe(0);
    expect(similarity("the and of", "a an the")).toBe(0);
  });

  it("finds the best matches, best first", () => {
    const items = [{ text: "What tools did you use?" }, { text: "Will the slides be shared?" }, { text: "Can we get the slides afterwards?" }];
    const r = findSimilar("Are the slides going to be shared", items);
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].item.text).toBe("Will the slides be shared?");
    expect(r.every((x) => x.score >= SUGGEST_SCORE)).toBe(true);
    expect(findSimilar("slides", items)).toEqual([]); // too short to judge
  });

  it("scores vectors", () => {
    expect(vectorScore([1, 0], [1, 0])).toBeCloseTo(1);
    expect(vectorScore([1, 0], [0, 1])).toBeCloseTo(0);
    expect(vectorScore([], [])).toBe(0);
  });
});

describe("AI helper", () => {
  it("knows when AI is set up", () => {
    expect(aiAvailable({})).toBe(false);
    expect(aiAvailable({ AI_ACCOUNT_ID: "a" })).toBe(false);
    expect(aiAvailable({ AI_ACCOUNT_ID: "a", AI_API_TOKEN: "t" })).toBe(true);
    expect(aiAvailable({ AI: { run: async () => ({}) } })).toBe(true);
  });

  it("uses the binding when there is one", async () => {
    const run = vi.fn(async () => ({ data: [[0.1, 0.2]] }));
    expect(await embed({ AI: { run } }, ["hi"])).toEqual([[0.1, 0.2]]);
    expect(run).toHaveBeenCalledWith("@cf/baai/bge-m3", { text: ["hi"] });
  });

  it("falls back to the REST API", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ result: { data: [[1, 2, 3]] } }));
    expect(await embed({ AI_ACCOUNT_ID: "acc", AI_API_TOKEN: "tok" }, ["x"])).toEqual([[1, 2, 3]]);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/baai/bge-m3");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    f.mockRestore();
  });

  it("throws on bad answers so the room can carry on without AI", async () => {
    await expect(embed({ AI: { run: async () => ({ data: [] }) } }, ["x"])).rejects.toThrow();
    await expect(embed({}, ["x"])).rejects.toThrow();
  });

  it("packs vectors as 32-bit floats", () => {
    const v = unpackVector(packVector([0.5, -1, 2]));
    expect([...v]).toEqual([0.5, -1, 2]);
  });
});

import { chat, POLLS_PROMPT } from "../../src/worker/ai";
import { parsePolls } from "../../src/shared/paste";
import { resultsText } from "../../src/worker/logic";

describe("AI chat and recap text", () => {
  it("sends a system and user message and returns the text", async () => {
    const run = vi.fn(async (_m: string, _i: unknown) => ({ response: "  Hello  " }));
    expect(await chat({ AI: { run } }, "sys", "hi")).toBe("Hello");
    const input = run.mock.calls[0][1] as { messages: { role: string }[] };
    expect(input.messages.map((m) => m.role)).toEqual(["system", "user"]);
    await expect(chat({ AI: { run: async () => ({ response: "" }) } }, "s", "u")).rejects.toThrow();
  });

  it("AI output in the paste format becomes polls", async () => {
    const reply = "Which tool do you use most?\n- Slack\n- Email\n\nWhat year did the web start?\n- 1989 *\n- 1999\n\nHow useful was this? (rating)";
    const out = await chat({ AI: { run: async () => ({ response: reply }) } }, POLLS_PROMPT, "notes");
    expect(parsePolls(out).polls.map((p) => p.type)).toEqual(["multiple", "quiz", "rating"]);
  });

  it("describes results in plain text", () => {
    expect(resultsText({ type: "multiple", title: "Pick", options: ["A", "B"] }, { total: 4, counts: [3, 1] })).toBe("Poll: Pick (4 answers)\n  - A: 75%\n  - B: 25%");
    expect(resultsText({ type: "quiz", title: "Q", options: ["x", "y"], correct: [1] }, { total: 2, counts: [1, 1] })).toContain("y: 50% (correct)");
    expect(resultsText({ type: "rating", title: "R", options: [] }, { total: 3, avg: 4.3 })).toContain("average 4.3");
    expect(resultsText({ type: "ranking", title: "Rank", options: ["a", "b"] }, { total: 2, scores: [0.5, 1] })).toContain("ranked: b > a");
    expect(resultsText({ type: "wordcloud", title: "W", options: [] }, { total: 2, words: [["fun", 2]] })).toContain("fun (2)");
    expect(resultsText({ type: "open", title: "O", options: [] }, { total: 1, answers: ["More snacks"] })).toContain('"More snacks"');
    expect(resultsText({ type: "open", title: "Empty", options: [] }, { total: 0 })).toBe("Poll: Empty (0 answers)");
  });
});
