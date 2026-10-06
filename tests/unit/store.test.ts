import { describe, expect, it } from "vitest";
import type { Meta, Poll, Question, Snapshot } from "../../src/shared/protocol";
import { DEFAULT_SETTINGS } from "../../src/shared/protocol";
import { applyOps, emptyRoom, reduce, sortQuestions } from "../../src/shared/store";

const meta: Meta = { code: "ABC123", title: "T", settings: DEFAULT_SETTINGS, presentMode: "auto", activePollId: null };
const q = (id: string, votes = 0, ts = 0, extra: Partial<Question> = {}): Question => ({ id, text: id, name: "", ts, votes, status: "live", highlighted: false, ...extra });
const poll = (id: string, ord: number): Poll => ({ id, ord, type: "rating", title: id, options: [], multi: false, scale: 5, status: "draft", showResults: true, revealed: false });
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({ meta, questions: [], polls: [], results: {}, online: 0, ...over });

describe("applyOps", () => {
  it("adds, updates and removes questions", () => {
    let s = applyOps(snap(), [{ k: "q", d: q("a") }, { k: "q", d: q("b") }]);
    s = applyOps(s, [{ k: "q", d: q("a", 3) }, { k: "q-", id: "b" }]);
    expect(s.questions).toEqual([q("a", 3)]);
  });
  it("does not mutate the previous snapshot", () => {
    const before = snap({ questions: [q("a")] });
    applyOps(before, [{ k: "q", d: q("a", 9) }]);
    expect(before.questions[0].votes).toBe(0);
  });
  it("keeps polls sorted by order", () => {
    const s = applyOps(snap(), [{ k: "p", d: poll("second", 1) }, { k: "p", d: poll("first", 0) }]);
    expect(s.polls.map((p) => p.id)).toEqual(["first", "second"]);
  });
  it("removes a poll's results with the poll", () => {
    let s = applyOps(snap(), [{ k: "p", d: poll("x", 0) }, { k: "r", id: "x", d: { total: 2 } }]);
    expect(s.results.x.total).toBe(2);
    s = applyOps(s, [{ k: "p-", id: "x" }]);
    expect(s.results.x).toBeUndefined();
  });
  it("handles delete then re-add in one patch", () => {
    const s = applyOps(snap({ questions: [q("a")] }), [{ k: "q-", id: "a" }, { k: "q", d: q("a", 1, 0, { status: "pending" }) }]);
    expect(s.questions).toHaveLength(1);
    expect(s.questions[0].status).toBe("pending");
  });
});

describe("reduce", () => {
  it("ignores patches before hello", () => {
    expect(reduce(emptyRoom(), { type: "patch", ops: [{ k: "q", d: q("a") }] }).snapshot).toBeNull();
  });
  it("hello sets everything, online updates count", () => {
    let s = reduce(emptyRoom(), { type: "hello", role: "attendee", snapshot: snap(), me: { pid: "p", votes: [], questions: [], responses: {} } });
    s = reduce(s, { type: "online", n: 42 });
    expect(s.role).toBe("attendee");
    expect(s.snapshot!.online).toBe(42);
  });
});

describe("sortQuestions", () => {
  it("puts the highlighted question first, then by votes", () => {
    const list = [q("low", 1, 3), q("top", 5, 1), q("hl", 0, 2, { highlighted: true })];
    expect(sortQuestions(list, "popular").map((x) => x.id)).toEqual(["hl", "top", "low"]);
    expect(sortQuestions(list, "recent").map((x) => x.id)).toEqual(["hl", "low", "top"]);
  });
});
