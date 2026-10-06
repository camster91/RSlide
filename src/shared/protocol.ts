// Shared types for the RSlide real-time protocol.
// Used by the Worker (server), the web app (client) and the tests.

export type Role = "attendee" | "host" | "present";
export type QuestionStatus = "pending" | "live" | "answered" | "archived";
export type PollType = "multiple" | "quiz" | "rating" | "wordcloud" | "open";
export type PollStatus = "draft" | "active" | "closed";
export type PresentMode = "auto" | "qa" | "poll" | "code";

export const POLL_TYPES: PollType[] = ["multiple", "quiz", "rating", "wordcloud", "open"];
export const PRESENT_MODES: PresentMode[] = ["auto", "qa", "poll", "code"];

export const LIMITS = {
  title: 120,
  question: 300,
  name: 40,
  option: 120,
  options: 10,
  answer: 200,
  word: 30,
  words: 3,
} as const;

export interface Settings {
  qaOpen: boolean;
  moderation: boolean;
  allowAnonymous: boolean;
  requireName: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  qaOpen: true,
  moderation: false,
  allowAnonymous: true,
  requireName: false,
};

export interface Meta {
  code: string;
  title: string;
  settings: Settings;
  presentMode: PresentMode;
  activePollId: string | null;
}

export interface Question {
  id: string;
  text: string;
  name: string;
  ts: number;
  votes: number;
  status: QuestionStatus;
  highlighted: boolean;
}

export interface Poll {
  id: string;
  ord: number;
  type: PollType;
  title: string;
  options: string[];
  multi: boolean;
  scale: number;
  status: PollStatus;
  showResults: boolean;
  revealed: boolean;
  /** Only sent to hosts, or to everyone after the host reveals the answer. */
  correct?: number[];
}

export interface Results {
  total: number;
  /** True when the host hid results from the audience. */
  hidden?: boolean;
  counts?: number[];
  avg?: number;
  words?: [string, number][];
  answers?: string[];
}

export type ResponseValue = number[] | number | string[] | string;

/** Things that belong to the person on this device. */
export interface Me {
  pid: string;
  votes: string[];
  questions: string[];
  responses: Record<string, ResponseValue>;
}

export interface Snapshot {
  meta: Meta;
  questions: Question[];
  polls: Poll[];
  results: Record<string, Results>;
  online: number;
}

// ---------- server → client ----------

export type Op =
  | { k: "meta"; d: Meta }
  | { k: "q"; d: Question }
  | { k: "q-"; id: string }
  | { k: "p"; d: Poll }
  | { k: "p-"; id: string }
  | { k: "r"; id: string; d: Results };

export type ServerMsg =
  | { type: "hello"; role: Role; snapshot: Snapshot; me: Me; hostKey?: string }
  | { type: "patch"; ops: Op[] }
  | { type: "me"; me: Me }
  | { type: "online"; n: number }
  | { type: "error"; message: string }
  | { type: "pong" };

// ---------- client → server ----------

export interface PollDraft {
  id?: string;
  type: PollType;
  title: string;
  options: string[];
  correct: number[];
  multi: boolean;
}

export type ClientMsg =
  // anyone
  | { type: "ask"; text: string; name?: string }
  | { type: "vote"; id: string }
  | { type: "respond"; pollId: string; value: ResponseValue }
  // host only
  | { type: "setTitle"; title: string }
  | { type: "setSettings"; settings: Partial<Settings> }
  | { type: "setPresentMode"; mode: PresentMode }
  | { type: "approve" | "answer" | "archive" | "highlight" | "deleteQuestion"; id: string }
  | { type: "clearQuestions" }
  | { type: "savePoll"; poll: PollDraft }
  | { type: "activatePoll"; pollId: string | null }
  | { type: "closePoll" | "toggleResults" | "revealAnswer" | "resetPoll" | "deletePoll"; pollId: string }
  | { type: "movePoll"; pollId: string; dir: "up" | "down" };

/** WebSocket close codes the client understands. */
export const CLOSE = {
  NOT_FOUND: 4004,
  FULL: 4003,
  FORBIDDEN: 4001,
} as const;

export const PING = '{"type":"ping"}';
export const PONG = '{"type":"pong"}';
