import { describe, expect, it } from "vitest";
import { parsePolls } from "../../src/shared/paste";

describe("paste to polls", () => {
  it("reads questions with options, split by blank lines", () => {
    const { polls } = parsePolls(`Which launch excites you most?
- New dashboard
- Mobile app
- AI assistant

Where should the offsite be?
a) Toronto
b) Montreal`);
    expect(polls).toHaveLength(2);
    expect(polls[0]).toMatchObject({ type: "multiple", title: "Which launch excites you most?", options: ["New dashboard", "Mobile app", "AI assistant"], multi: false });
    expect(polls[1].options).toEqual(["Toronto", "Montreal"]);
  });

  it("splits on a new question even without a blank line", () => {
    const { polls } = parsePolls(`1. What is 2 + 2?
* 3
* 4 *
2. What colour is the sky?
- Green
- Blue (correct)`);
    expect(polls.map((p) => p.title)).toEqual(["What is 2 + 2?", "What colour is the sky?"]);
    expect(polls[0]).toMatchObject({ type: "quiz", options: ["3", "4"], correct: [1] });
    expect(polls[1]).toMatchObject({ type: "quiz", options: ["Green", "Blue"], correct: [1] });
  });

  it("supports checkbox answers and several right answers", () => {
    const { polls } = parsePolls(`Which are prime?
[x] 2
[ ] 4
[x] 7`);
    expect(polls[0]).toMatchObject({ type: "quiz", options: ["2", "4", "7"], correct: [0, 2], multi: true });
  });

  it("uses type hints in brackets", () => {
    const { polls } = parsePolls(`How clear is our roadmap? (rating)

Sprint mood (word cloud)

Rank these (ranking)
- Speed
- Quality

Pick all that apply (pick several)
- A
- B

Anything else? (open)`);
    expect(polls.map((p) => p.type)).toEqual(["rating", "wordcloud", "ranking", "multiple", "open"]);
    expect(polls[0].title).toBe("How clear is our roadmap?");
    expect(polls[3].multi).toBe(true);
  });

  it("guesses the type of questions without options", () => {
    const { polls } = parsePolls(`In one word, how do you feel?

How would you rate today's session?

On a scale of 1 to 10, how ready are we?

What should we do next?`);
    expect(polls.map((p) => p.type)).toEqual(["wordcloud", "rating", "scale", "open"]);
    expect(polls[2].range).toMatchObject({ min: 1, max: 10 });
  });

  it("explains what it changed", () => {
    const { polls, notes } = parsePolls(`Only one?
- Lonely option

Quiz without an answer (quiz)
- A
- B`);
    expect(polls[0].type).toBe("open");
    expect(polls[1]).toMatchObject({ type: "quiz", correct: [0] });
    expect(notes.length).toBe(2);
  });

  it("keeps within limits", () => {
    const many = Array.from({ length: 14 }, (_, i) => `- Option ${i}`).join("\n");
    const { polls, notes } = parsePolls(`Lots?\n${many}`);
    expect(polls[0].options).toHaveLength(10);
    expect(notes[0]).toMatch(/first 10/);
    const qs = Array.from({ length: 40 }, (_, i) => `Question ${i}?`).join("\n\n");
    expect(parsePolls(qs).polls).toHaveLength(30);
  });

  it("ignores empty input and Windows line endings", () => {
    expect(parsePolls("   \n\n ").polls).toEqual([]);
    expect(parsePolls("Yes or no?\r\n- Yes\r\n- No").polls[0].options).toEqual(["Yes", "No"]);
  });
});

describe("paste to polls in French and Spanish", () => {
  it("understands translated type hints and answer marks", () => {
    const fr = parsePolls(`Notre feuille de route est-elle claire ? (note)\n\nUn mot pour ce trimestre (nuage de mots)\n\nClassez ces priorités (classement)\n- Vitesse\n- Qualité\n\nCombien font 2 + 2 ?\n- 3\n- 4 (bonne réponse)`);
    expect(fr.polls.map((p) => p.type)).toEqual(["rating", "wordcloud", "ranking", "quiz"]);
    expect(fr.polls[3].correct).toEqual([1]);
    const es = parsePolls(`¿Qué tan clara es la hoja de ruta? (valoración)\n\nDel 1 al 10 (escala)\n\nElige varias (varias)\n- A\n- B`);
    expect(es.polls.map((p) => p.type)).toEqual(["rating", "scale", "multiple"]);
    expect(es.polls[2].multi).toBe(true);
  });
});
