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
