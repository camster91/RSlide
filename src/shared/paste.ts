// Turns pasted text (from notes, a doc or slides) into poll drafts. No AI needed.
//
//   Which launch excites you most?
//   - New dashboard
//   - Mobile app *            ← a star or "(correct)" marks the answer and makes it a quiz
//
//   How clear is our roadmap? (rating)   ← optional type hint in brackets
//   One word for this quarter
//
// Questions are split by blank lines, or by a new line ending in "?" after a list of options.
import { LIMITS, type PollDraft, type PollType } from "./protocol";

// English, French and Spanish hints, so translated examples work too.
const HINTS: [RegExp, PollType | "multi"][] = [
  [/^(rating|stars?|note|étoiles?|etoiles?|valoraci[oó]n|estrellas?)$/i, "rating"],
  [/^(scale|slider|1\s*-\s*10|1\s*(to|à|a)\s*10|[ée]chelle|escala)$/i, "scale"],
  [/^(word ?cloud|words?|one word|nuage de mots|mots?|nube de palabras|palabras?)$/i, "wordcloud"],
  [/^(open|open text|text|free text|comment|ouverte|texte libre|texte|abierta|texto libre|texto)$/i, "open"],
  [/^(rank|ranking|order|classement|ordre|clasificaci[oó]n|orden)$/i, "ranking"],
  [/^(quiz|cuestionario)$/i, "quiz"],
  [/^(100 points|points|100 puntos|puntos)$/i, "points"],
  [/^(multiple|multi|pick several|choose several|select all|several|plusieurs|choix multiples?|varias|varios|selecci[oó]n m[uú]ltiple)$/i, "multi"],
  [/^(poll|choice|multiple choice|pick one|single|sondage|choix|un choix|encuesta|opci[oó]n|una opci[oó]n)$/i, "multiple"],
];

const NUMBERED = /^\s*(?:q(?:uestion)?\s*\d*\s*[:.)-]|\d{1,2}\s*[.)]|\d{1,2}\s*-\s)\s*/i;
const BULLET = /^\s*(?:[-*•–·]|\[\s?[xX✓]?\s?\]|[a-jA-J]\s*[.)]|\d{1,2}\s*[.)])\s+/;
const CHECKED = /^\s*\[\s?[xX✓]\s?\]/;
const CORRECT_END = /\s*(?:\*|✓|✔|\((?:correct|answer|right|bonne réponse|correcte?|correcta|respuesta)\)|\[(?:correct|answer)\])\s*$/i;

export interface PasteResult {
  polls: PollDraft[];
  /** Short notes about things that were changed or skipped. */
  notes: string[];
}

const isBullet = (line: string) => BULLET.test(line) && !/^\s*q/i.test(line);

/** Splits text into blocks: one question plus its options. */
function blocks(text: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  const push = () => {
    if (cur.length) out.push(cur);
    cur = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\t/g, " ").trimEnd();
    if (!line.trim()) {
      push();
      continue;
    }
    // A new question right after a list of options, without a blank line between.
    const looksLikeQuestion = /\?\s*([([][^)\]]*[)\]])?\s*$/.test(line) || (NUMBERED.test(line) && !isBullet(line));
    if (cur.length > 1 && looksLikeQuestion) push();
    cur.push(line);
  }
  push();
  return out;
}

function parseBlock(lines: string[], notes: string[]): PollDraft | null {
  let title = lines[0].replace(NUMBERED, "").replace(BULLET, "").trim();
  let hint: PollType | "multi" | null = null;
  const m = title.match(/\s*[([]([^)\]]{1,24})[)\]]\s*$/);
  if (m) {
    const found = HINTS.find(([re]) => re.test(m[1].trim()));
    if (found) {
      hint = found[1];
      title = title.slice(0, m.index).trim();
    }
  }
  if (!title) return null;
  const correct: number[] = [];
  const options: string[] = [];
  for (const line of lines.slice(1)) {
    let opt = line.trim();
    let right = CHECKED.test(opt);
    opt = opt.replace(BULLET, "");
    if (CORRECT_END.test(opt)) {
      right = true;
      opt = opt.replace(CORRECT_END, "");
    }
    opt = opt.trim().slice(0, LIMITS.option);
    if (!opt) continue;
    if (options.length >= LIMITS.options) {
      notes.push(`"${title.slice(0, 40)}": kept the first ${LIMITS.options} options`);
      break;
    }
    if (right) correct.push(options.length);
    options.push(opt);
  }
  if (title.length > LIMITS.question) {
    title = title.slice(0, LIMITS.question);
    notes.push(`Shortened a long question`);
  }

  const base = { title, options, correct: [] as number[], multi: false };
  if (options.length >= 2) {
    if (correct.length || hint === "quiz") {
      if (!correct.length) notes.push(`"${title.slice(0, 40)}": mark the right answer before you launch it`);
      return { ...base, type: "quiz", correct: correct.length ? correct : [0], multi: correct.length > 1, timeLimit: 30 };
    }
    if (hint === "ranking" || hint === "points") return { ...base, type: hint };
    return { ...base, type: "multiple", multi: hint === "multi" };
  }
  if (options.length === 1) notes.push(`"${title.slice(0, 40)}": only one option, so it became an open question`);
  const lower = title.toLowerCase();
  let type: PollType = "open";
  if (hint === "rating" || hint === "scale" || hint === "wordcloud" || hint === "open") type = hint;
  else if (/\b(one|single|few|three|3) words?\b|\bin a word\b|\b(un|en un|quelques) mots?\b|\b(una|en una|pocas) palabras?\b/.test(lower)) type = "wordcloud";
  else if (/\bon a scale\b|\bscale of\b|\b1\s*(?:-|to)\s*10\b/.test(lower)) type = "scale";
  else if (/^(how would you )?rate\b|\brate (this|the|our|your)\b|\bhow (satisfied|happy|likely|useful|clear)\b/.test(lower)) type = "rating";
  const draft: PollDraft = { ...base, options: [], type };
  if (type === "scale") draft.range = { min: 1, max: 10, minLabel: "", maxLabel: "" };
  return draft;
}

export function parsePolls(text: string): PasteResult {
  const notes: string[] = [];
  const polls: PollDraft[] = [];
  for (const b of blocks(text)) {
    const p = parseBlock(b, notes);
    if (!p) continue;
    if (polls.length >= LIMITS.importPolls) {
      notes.push(`Kept the first ${LIMITS.importPolls} questions`);
      break;
    }
    polls.push(p);
  }
  return { polls, notes };
}
