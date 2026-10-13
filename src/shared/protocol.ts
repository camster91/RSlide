// Shared types for the RSlide real-time protocol.
// Used by the Worker (server), the web app (client) and the tests.

/** "mod" = moderator: can manage questions but not polls or settings. */
export type Role = "attendee" | "host" | "mod" | "present";
export type QuestionStatus = "pending" | "live" | "answered" | "archived";
export type ItemType = "multiple" | "rating" | "scale" | "ranking" | "wordcloud" | "open" | "points" | "grid" | "pin";
export type PollType = ItemType | "quiz" | "survey";
export type PollStatus = "draft" | "active" | "closed";
export type PresentMode = "auto" | "qa" | "poll" | "leaderboard" | "code";
export type Identity = "none" | "name" | "email";
export type ThemeName = "indigo" | "ocean" | "forest" | "berry" | "mono" | "contrast";
export type ScreenLook = "light" | "dark";

export const POLL_TYPES: PollType[] = ["multiple", "quiz", "rating", "scale", "ranking", "wordcloud", "open", "points", "grid", "pin", "survey"];
export const ITEM_TYPES: ItemType[] = ["multiple", "rating", "scale", "ranking", "wordcloud", "open", "points", "grid", "pin"];
export type Profanity = "off" | "mask" | "review";
/** Points each person shares out in a "100 points" poll. */
export const POINTS_BUDGET = 100;
export const LABEL_COLORS = ["blue", "green", "amber", "red", "purple", "grey"] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];
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
  reply: 300,
  replies: 20,
  labels: 12,
  label: 24,
  rooms: 8,
  room: 40,
  blockedWords: 100,
  importPolls: 30,
  summary: 2000,
  pasteText: 8000,
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
  /** Let attendees reply to questions (hosts and moderators always can). */
  audienceReplies: boolean;
  /** Hide who asked from other attendees and the big screen. */
  hideNames: boolean;
  /** Bad-word filter: hide the words, or send the question to review. */
  profanity: Profanity;
  /** Extra words the host wants filtered. */
  blockedWords: string[];
  /** Event logo (image ID). */
  logo: string | null;
  /** Q&A opens / closes automatically at these times (ms). */
  qaOpensAt: number | null;
  qaClosesAt: number | null;
  /** Delete the whole event at this time (ms). */
  deleteAt: number | null;
  /** Use AI to spot questions that mean the same thing (needs Workers AI set up). */
  aiAssist: boolean;
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
  audienceReplies: false,
  hideNames: false,
  profanity: "off",
  blockedWords: [],
  logo: null,
  qaOpensAt: null,
  qaClosesAt: null,
  deleteAt: null,
  aiAssist: false,
};

export interface Label {
  id: string;
  name: string;
  color: LabelColor;
}

/** A separate Q&A channel inside one event (e.g. one per session or track). */
export interface Room {
  id: string;
  name: string;
}

export const MAIN_ROOM = "main";

export interface Meta {
  code: string;
  title: string;
  settings: Settings;
  presentMode: PresentMode;
  activePollId: string | null;
  labels: Label[];
  rooms: Room[];
  /** Only sent to hosts. Empty string = no passcode. */
  passcode?: string;
  /** Only sent to hosts: the key for the moderator link. */
  modKey?: string;
  /** Only sent to hosts: true if this server has Workers AI set up. */
  ai?: boolean;
  /** Anyone with the link can see the recap page. */
  recapPublic: boolean;
  /** Only sent to hosts: the summary shown at the top of the recap. */
  recapSummary?: string;
}

export interface Reply {
  id: string;
  text: string;
  name: string;
  ts: number;
  /** Written by the host or a moderator. */
  official: boolean;
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
  room: string;
  labels: string[];
  replies: Reply[];
  /** Only sent to hosts and moderators: an earlier question this one probably repeats. */
  dupOf?: string;
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
  /** Ends for scale questions, and the 1..max range for 2×2 grids. */
  range: Range | null;
  /** 2×2 grid: names of the two axes. */
  axes: [string, string] | null;
  /** Pin on image: the picture people tap on. */
  image: string | null;
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
  /** Ranking: average points per option (higher = ranked higher). 100 points: average points given. */
  scores?: number[];
  /** 2×2 grid: average [x, y] for each option. */
  pairs?: [number, number][];
  /** Pin on image: where people tapped (0–1), newest first, at most 500. */
  pins?: [number, number][];
  words?: [string, number][];
  answers?: string[];
  /** Survey: results for each question. */
  items?: Results[];
}

type Single = number[] | number | string[] | string | [number, number][];
export type ResponseValue = Single | (Single | null)[];

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
  /** IDs of replies this person wrote. */
  replies: string[];
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
  axes?: [string, string] | null;
  image?: string | null;
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
  axes?: [string, string] | null;
  image?: string | null;
}

export type ClientMsg =
  // anyone
  | { type: "join"; name: string; email?: string }
  | { type: "ask"; text: string; name?: string; room?: string }
  | { type: "reply"; id: string; text: string; name?: string }
  | { type: "deleteReply"; id: string; replyId: string }
  | { type: "vote"; id: string; dir?: 1 | -1 }
  | { type: "editQuestion"; id: string; text: string }
  | { type: "withdraw"; id: string }
  | { type: "respond"; pollId: string; value: ResponseValue }
  | { type: "react"; emoji: Reaction }
  // host and moderators
  | { type: "approve" | "answer" | "archive" | "highlight" | "deleteQuestion"; id: string }
  | { type: "tagQuestion"; id: string; label: string }
  | { type: "moveQuestion"; id: string; room: string }
  /** Fold question `id` into `into`: votes and replies move over, `id` is removed. */
  | { type: "mergeQuestion"; id: string; into: string }
  | { type: "notDuplicate"; id: string }
  // host only
  | { type: "setTitle"; title: string }
  | { type: "setLabels"; labels: { id?: string; name: string; color: LabelColor }[] }
  | { type: "setRooms"; rooms: { id?: string; name: string }[] }
  | { type: "importPolls"; polls: PollDraft[] }
  | { type: "setSettings"; settings: Partial<Settings> }
  | { type: "setPasscode"; passcode: string }
  | { type: "setPresentMode"; mode: PresentMode }
  | { type: "newModKey" }
  | { type: "setRecap"; public?: boolean; summary?: string }
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
  logo: string | null;
}

/** Everything needed to copy an event's setup into a new event. */
export interface EventTemplate {
  title?: string;
  settings?: Partial<Settings>;
  labels?: { name: string; color: LabelColor }[];
  rooms?: { name: string }[];
  polls: PollDraft[];
}

export interface Analytics {
  code: string;
  title: string;
  createdAt: number;
  participants: number;
  peakOnline: number;
  peakAt: number | null;
  questions: number;
  askers: number;
  votes: number;
  replies: number;
  reactions: number;
  polls: { id: string; title: string; type: PollType; responses: number }[];
  /** Activity per minute. */
  timeline: { t: number; joins: number; questions: number; votes: number; answers: number; reactions: number }[];
  topQuestions: { text: string; score: number; status: QuestionStatus }[];
  rooms: { name: string; questions: number }[];
}

/** Public summary of an event, from GET /api/events/:code/recap (only when the host shares it). */
export interface Recap {
  code: string;
  title: string;
  createdAt: number;
  summary: string;
  logo: string | null;
  theme: ThemeName;
  stats: { participants: number; questions: number; votes: number; answers: number };
  questions: { text: string; name: string; score: number; answered: boolean; replies: Reply[] }[];
  polls: { poll: Poll; results: Results }[];
  leaderboard: Leaderboard | null;
}
