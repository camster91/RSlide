// Applies server messages to a client-side copy of the event.
// Pure functions so they are easy to unit test.
import type { Me, Op, Poll, Question, Results, Role, ServerMsg, Snapshot } from "./protocol";

export interface RoomState {
  role: Role | null;
  snapshot: Snapshot | null;
  me: Me | null;
  hostKey?: string;
  /** Server time minus local time, for accurate quiz countdowns. */
  clockOffset: number;
}

export const emptyRoom = (): RoomState => ({ role: null, snapshot: null, me: null, clockOffset: 0 });

/** Seconds left on a quiz timer (null when there is no timer). */
export function secondsLeft(p: Poll, clockOffset: number, now = Date.now()): number | null {
  if (!p.timeLimit || !p.startedAt || p.status !== "active") return null;
  return Math.max(0, Math.ceil((p.startedAt + p.timeLimit * 1000 - (now + clockOffset)) / 1000));
}

export function applyOps(s: Snapshot, ops: Op[]): Snapshot {
  let questions = s.questions;
  let polls = s.polls;
  let results = s.results;
  let meta = s.meta;
  let leaderboard = s.leaderboard;
  const qIndex = () => new Map(questions.map((q, i) => [q.id, i]));
  const pIndex = () => new Map(polls.map((p, i) => [p.id, i]));
  let qi: Map<string, number> | null = null;
  let pi: Map<string, number> | null = null;

  for (const op of ops) {
    switch (op.k) {
      case "meta":
        meta = op.d;
        break;
      case "q": {
        if (questions === s.questions) questions = [...questions];
        qi ??= qIndex();
        const i = qi.get(op.d.id);
        if (i === undefined) {
          qi.set(op.d.id, questions.length);
          questions.push(op.d);
        } else questions[i] = op.d;
        break;
      }
      case "q-": {
        questions = questions.filter((q) => q.id !== op.id);
        qi = null;
        break;
      }
      case "p": {
        if (polls === s.polls) polls = [...polls];
        pi ??= pIndex();
        const i = pi.get(op.d.id);
        if (i === undefined) {
          pi.set(op.d.id, polls.length);
          polls.push(op.d);
        } else polls[i] = op.d;
        break;
      }
      case "p-": {
        polls = polls.filter((p) => p.id !== op.id);
        pi = null;
        if (results[op.id]) {
          results = { ...results };
          delete results[op.id];
        }
        break;
      }
      case "r":
        if (results === s.results) results = { ...results };
        results[op.id] = op.d;
        break;
      case "lb":
        leaderboard = op.d;
        break;
    }
  }
  if (polls !== s.polls) polls = [...polls].sort((a, b) => a.ord - b.ord);
  return { ...s, meta, questions, polls, results, leaderboard };
}

export function reduce(state: RoomState, msg: ServerMsg): RoomState {
  switch (msg.type) {
    case "hello":
      return {
        role: msg.role,
        snapshot: { ...msg.snapshot, polls: [...msg.snapshot.polls].sort((a, b) => a.ord - b.ord) },
        me: msg.me,
        hostKey: msg.hostKey,
        clockOffset: msg.now - Date.now(),
      };
    case "patch":
      return state.snapshot ? { ...state, snapshot: applyOps(state.snapshot, msg.ops) } : state;
    case "me":
      return { ...state, me: msg.me };
    case "online":
      return state.snapshot ? { ...state, snapshot: { ...state.snapshot, online: msg.n } } : state;
    default:
      return state;
  }
}

// ---------- view helpers ----------

export const score = (q: Question) => q.votes - q.downs;

export function sortQuestions(list: Question[], mode: "popular" | "recent"): Question[] {
  const a = [...list];
  if (mode === "recent") a.sort((x, y) => y.ts - x.ts);
  else a.sort((x, y) => score(y) - score(x) || y.ts - x.ts);
  return a.sort((x, y) => Number(y.highlighted) - Number(x.highlighted));
}

export const activePoll = (s: Snapshot): Poll | undefined =>
  s.polls.find((p) => p.id === s.meta.activePollId);

export const resultsOf = (s: Snapshot, id: string): Results => s.results[id] ?? { total: 0 };
