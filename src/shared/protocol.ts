// Shared types for the RSlide real-time protocol.
// Used by the Worker (server), the web app (client) and the tests.

export type Role = "attendee" | "host" | "present";
export type QuestionStatus = "pending" | "live" | "answered" | "archived";
export type ItemType = "multiple" | "rating" | "scale" | "ranking" | "wordcloud" | "open";
export type PollType = ItemType | "quiz" | "survey";
export type PollStatus = "draft" | "active" | "closed";
export type PresentMode = "auto" | "qa" | "poll" | "leaderboard" | "code";
export type Identity = "none" | "name" | "email";
export type ThemeName = "indigo" | "ocean" | "forest" | "berry" | "mono" | "contrast";
export type ScreenLook = "light" | "dark";

export const POLL_TYPES: PollType[] = ["multiple", "quiz", "rating", "scale", "ranking", "wordcloud", "open", "survey"];
export const ITEM_TYPES: ItemType[] = ["multiple", "rating", "scale", "ranking", "wordcloud", "open"];
export const PRESENT_MODES: PresentMode[] = ["auto", "qa", "poll", "leaderboard", "code"];
export const THEMES: ThemeName[] = ["indigo", "ocean", "forest", "berry", "mono", "contrast"];
export const REACTIONS = ["👏", "❤️", "😂", "🔥", "🤯", "👍"] as const;
export type Reaction = (typeof REACTIONS)[number];

export const LIMITS = {
  title: 120,
  question: 300,
  name: 40,
  email: 120,
  option: 120,
  options: 10,
  answer: 200,
  word: 30,
  words: 3,
  surveyItems: 15,
  passcode: 20,
  imageBytes: 2 * 1024 * 1024,
} as const;

export interface Settings {
  qaOpen: boolean;
  moderation: boolean;
  allowAnonymous: boolean;
  allowDownvotes: boolean;
  reactions: boolean;
  /** What attendees must enter before taking part. */
  identity: Identity;
  theme: ThemeName;
  /** Light or dark big screen. */
  screen: ScreenLook;
}

export const DEFAULT_SETTINGS: Settings = {
  qaOpen: true,
  moderation: false,
  allowAnonymous: true,
  allowDownvotes: false,
  reactions: true,
  identity: "none",
  theme: "indigo",
  screen: "light",
};

export interface Meta {
  code: string;
  title: string;
  settings: Settings;
  presentMode: PresentMode;
  activePollId: string | null;
  /** Only sent to hosts. Empty string = no passcode. */
  passcode?: string;
}

export interface Question {
  id: string;
  text: string;
  name: string;
  ts: number;
  votes: number;
  downs: number;
  status: QuestionStatus;
  highlighted: boolean;
  edited: boolean;
}

export interface Range {
  min: number;
  max: number;
  minLabel: string;
  maxLabel: string;
}

/** One question inside a poll or survey. */
export interface Item {
  type: ItemType | "quiz";
  title: string;
  options: string[];
  /** Image IDs, one per option (null = no image). */
  images: (string | null)[];
  multi: boolean;
  /** Stars for rating questions. */
  scale: number;
  /** Ends for scale questions. */
  range: Range | null;
}

export interface Poll extends Omit<Item, "type"> {
  id: string;
  ord: number;
  type: PollType;
  status: PollStatus;
  showResults: boolean;
  revealed: boolean;
  /** Only sent to hosts, or to everyone after the host reveals the answer. */
  correct?: number[];
  /** Quiz countdown in seconds (0 = no timer). */
  timeLimit: number;
  /** When the poll was last launched (ms). Used for quiz countdowns. */
  startedAt: number | null;
  /** Survey questions. */
  items: Item[];
}

export interface Results {
  total: number;
  /** True when the host hid results from the audience. */
  hidden?: boolean;
  counts?: number[];
  avg?: number;
  /** Ranking: average points per option (higher = ranked higher). */
  scores?: number[];
  words?: [string, number][];
  answers?: string[];
  /** Survey: results for each question. */
  items?: Results[];
}

export type ResponseValue = number[] | number | string[] | string | (number[] | number | string[] | string | null)[];

export interface LeaderEntry {
  name: string;
  points: number;
  correct: number;
}

export interface Leaderboard {
  top: LeaderEntry[];
  players: number;
  /** How many quiz questions have been revealed (and so count). */
  rounds: number;
}

/** Things that belong to the person on this device. */
export interface Me {
  pid: string;
  name: string;
  email: string;
  /** True once they've entered what the event requires. */
  joined: boolean;
  votes: string[];
  downs: string[];
  questions: string[];
  responses: Record<string, ResponseValue>;
  quiz: { points: number; rank: number; players: number; last: number | null } | null;
}

export interface Snapshot {
  meta: Meta;
  questions: Question[];
  polls: Poll[];
  results: Record<string, Results>;
  leaderboard: Leaderboard;
  online: number;
}

// ---------- server → client ----------

export type Op =
  | { k: "meta"; d: Meta }
  | { k: "q"; d: Question }
  | { k: "q-"; id: string }
  | { k: "p"; d: Poll }
  | { k: "p-"; id: string }
  | { k: "r"; id: string; d: Results }
  | { k: "lb"; d: Leaderboard };

export type ServerMsg =
  | { type: "hello"; role: Role; snapshot: Snapshot; me: Me; hostKey?: string; now: number }
  | { type: "patch"; ops: Op[] }
  | { type: "me"; me: Me }
  | { type: "online"; n: number }
  /** Reaction counts since the last batch (big screen and host only). */
  | { type: "reactions"; counts: Partial<Record<Reaction, number>> }
  | { type: "error"; message: string }
  | { type: "pong" };

// ---------- client → server ----------

export interface ItemDraft {
  type: ItemType;
  title: string;
  options: string[];
  images?: (string | null)[];
  multi?: boolean;
  range?: Partial<Range> | null;
}

export interface PollDraft {
  id?: string;
  type: PollType;
  title: string;
  options: string[];
  images?: (string | null)[];
  correct: number[];
  multi: boolean;
  range?: Partial<Range> | null;
  timeLimit?: number;
  items?: ItemDraft[];
}

export type ClientMsg =
  // anyone
  | { type: "join"; name: string; email?: string }
  | { type: "ask"; text: string; name?: string }
  | { type: "vote"; id: string; dir?: 1 | -1 }
  | { type: "editQuestion"; id: string; text: string }
  | { type: "withdraw"; id: string }
  | { type: "respond"; pollId: string; value: ResponseValue }
  | { type: "react"; emoji: Reaction }
  // host only
  | { type: "setTitle"; title: string }
  | { type: "setSettings"; settings: Partial<Settings> }
  | { type: "setPasscode"; passcode: string }
  | { type: "setPresentMode"; mode: PresentMode }
  | { type: "approve" | "answer" | "archive" | "highlight" | "deleteQuestion"; id: string }
  | { type: "clearQuestions" }
  | { type: "savePoll"; poll: PollDraft }
  | { type: "duplicatePoll"; pollId: string }
  | { type: "activatePoll"; pollId: string | null }
  | { type: "closePoll" | "toggleResults" | "revealAnswer" | "resetPoll" | "deletePoll"; pollId: string }
  | { type: "movePoll"; pollId: string; dir: "up" | "down" };

/** WebSocket close codes the client understands. */
export const CLOSE = {
  FORBIDDEN: 4001,
  FULL: 4003,
  NOT_FOUND: 4004,
  PASSCODE: 4005,
} as const;

export const PING = '{"type":"ping"}';
export const PONG = '{"type":"pong"}';

/** Public info about an event, from GET /api/events/:code */
export interface EventInfo {
  code: string;
  title: string;
  passcode: boolean;
  identity: Identity;
  theme: ThemeName;
}
