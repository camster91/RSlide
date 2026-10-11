// Ready-made sets of polls hosts can start an event with, or add to an event.
import type { EventTemplate } from "./protocol";

export interface BuiltInTemplate extends EventTemplate {
  id: string;
  name: string;
  description: string;
}

const scale = (min: number, max: number, minLabel: string, maxLabel: string) => ({ min, max, minLabel, maxLabel });

export const TEMPLATES: BuiltInTemplate[] = [
  {
    id: "class",
    name: "Class check-in",
    description: "Warm-up, a quick quiz and an exit ticket for a lecture or workshop.",
    settings: { moderation: false, allowAnonymous: true },
    labels: [
      { name: "Course content", color: "blue" },
      { name: "Admin", color: "grey" },
    ],
    polls: [
      { type: "wordcloud", title: "In one word, how are you feeling about this week's topic?", options: [], correct: [], multi: false },
      { type: "scale", title: "How confident are you with last week's material?", options: [], correct: [], multi: false, range: scale(1, 5, "Lost", "Got it") },
      { type: "quiz", title: "Quick check: which of these is true?", options: ["Option A", "Option B", "Option C", "Option D"], correct: [0], multi: false, timeLimit: 30 },
      { type: "open", title: "Exit ticket: what's one thing that is still unclear?", options: [], correct: [], multi: false },
    ],
  },
  {
    id: "allhands",
    name: "All-hands meeting",
    description: "Moderated Q&A plus pulse questions for company or team meetings.",
    settings: { moderation: true, allowAnonymous: true, reactions: true },
    labels: [
      { name: "Strategy", color: "blue" },
      { name: "People", color: "green" },
      { name: "Follow up", color: "amber" },
    ],
    polls: [
      { type: "rating", title: "How clear is our direction for the next quarter?", options: [], correct: [], multi: false },
      { type: "ranking", title: "Rank these priorities for next quarter", options: ["Growth", "Product quality", "Customer experience", "Team health"], correct: [], multi: false },
      { type: "open", title: "What should leadership start, stop or continue?", options: [], correct: [], multi: false },
    ],
  },
  {
    id: "retro",
    name: "Team retrospective",
    description: "What went well, what to improve, and what to try next sprint.",
    settings: { allowAnonymous: true, hideNames: true },
    polls: [
      { type: "scale", title: "How did this sprint feel overall?", options: [], correct: [], multi: false, range: scale(1, 10, "Rough", "Great") },
      { type: "wordcloud", title: "One word for this sprint", options: [], correct: [], multi: false },
      { type: "open", title: "What went well?", options: [], correct: [], multi: false },
      { type: "open", title: "What could we do better?", options: [], correct: [], multi: false },
      { type: "points", title: "Share 100 points across what we should fix first", options: ["Process", "Tools", "Communication", "Scope"], correct: [], multi: false },
    ],
  },
  {
    id: "feedback",
    name: "Session feedback",
    description: "A short survey to run at the end of any talk, class or event.",
    polls: [
      {
        type: "survey",
        title: "Session feedback",
        options: [],
        correct: [],
        multi: false,
        items: [
          { type: "rating", title: "Overall, how would you rate this session?", options: [] },
          { type: "scale", title: "How likely are you to recommend it to a friend?", options: [], range: scale(0, 10, "Not likely", "Very likely") },
          { type: "multiple", title: "What was most useful?", options: ["The talk", "The Q&A", "The examples", "Meeting people"], multi: true },
          { type: "open", title: "Anything we should change next time?", options: [] },
        ],
      },
    ],
  },
  {
    id: "icebreakers",
    name: "Icebreakers",
    description: "Light, fun questions to get a room talking.",
    settings: { reactions: true },
    polls: [
      { type: "wordcloud", title: "Where are you joining from today?", options: [], correct: [], multi: false },
      { type: "multiple", title: "Coffee or tea?", options: ["Coffee", "Tea", "Both", "Neither"], correct: [], multi: false },
      { type: "open", title: "What's one thing people here might not know about you?", options: [], correct: [], multi: false },
    ],
  },
  {
    id: "trivia",
    name: "Trivia night",
    description: "A ready-to-run quiz with timers and a leaderboard. Edit the questions to suit your crowd.",
    settings: { identity: "name", reactions: true },
    polls: [
      { type: "quiz", title: "Which planet is closest to the Sun?", options: ["Venus", "Mercury", "Mars", "Earth"], correct: [1], multi: false, timeLimit: 20 },
      { type: "quiz", title: "How many sides does a hexagon have?", options: ["5", "6", "7", "8"], correct: [1], multi: false, timeLimit: 15 },
      { type: "quiz", title: "Which ocean is the largest?", options: ["Atlantic", "Indian", "Arctic", "Pacific"], correct: [3], multi: false, timeLimit: 20 },
      { type: "quiz", title: "What is the chemical symbol for gold?", options: ["Go", "Gd", "Au", "Ag"], correct: [2], multi: false, timeLimit: 20 },
      { type: "quiz", title: "Which of these are primary colours of light?", options: ["Red", "Yellow", "Green", "Blue"], correct: [0, 2, 3], multi: true, timeLimit: 30 },
    ],
  },
  {
    id: "brainstorm",
    name: "Brainstorm and prioritise",
    description: "Collect ideas, then plot and vote on them.",
    polls: [
      { type: "open", title: "Share an idea", options: [], correct: [], multi: false },
      { type: "grid", title: "Plot these ideas", options: ["Idea 1", "Idea 2", "Idea 3", "Idea 4"], correct: [], multi: false, axes: ["Impact", "Effort"] },
      { type: "points", title: "Share 100 points across the ideas you'd back", options: ["Idea 1", "Idea 2", "Idea 3", "Idea 4"], correct: [], multi: false },
    ],
  },
];

export const templateById = (id: unknown) => TEMPLATES.find((t) => t.id === id);
