// Load test: many attendees join one event, answer a poll and upvote questions at the same time.
// Usage: start the app (`npm run preview`), then `npm run test:load -- 2000`
// Point BASE_URL at a deployed copy to test real Cloudflare performance.
import { Client, createEvent } from "./client";

const N = Number(process.argv[2] || process.env.LOAD_N || 2000);
if (!Number.isInteger(N) || N < 50) throw new Error("Attendee count must be an integer of at least 50");
const BATCH = 100;
const pct = (arr: number[], p: number) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};
const ms = (n: number) => `${Math.round(n)} ms`;

const ev = await createEvent(`Load test ${N}`);
const host = await Client.connect(ev.code, "host", "host", ev.hostKey);
console.log(`Event ${ev.code}: connecting ${N} attendees…`);

const t0 = performance.now();
const people: Client[] = [];
for (let i = 0; i < N; i += BATCH) {
  const batch = await Promise.all(Array.from({ length: Math.min(BATCH, N - i) }, (_, j) => Client.connect(ev.code, "attendee", `load${i + j}`)));
  people.push(...batch);
}
const joinMs = performance.now() - t0;
console.log(`✓ ${people.length} connected in ${ms(joinMs)}`);
const onlineOk = await host.until(() => host.snap.online === N, 6000);
console.log(`${onlineOk ? "✓" : "✗"} host sees ${host.snap.online}/${N} online`);

// ----- everyone answers a poll at once -----
host.send({ type: "savePoll", poll: { type: "multiple", title: "Load poll", options: ["A", "B", "C", "D"], correct: [], multi: false } });
await host.until(() => host.snap.polls.length === 1);
const pollId = host.snap.polls[0].id;
const launchAt = performance.now();
host.send({ type: "activatePoll", pollId });
const seen = await Promise.all(people.map(async (p) => ((await p.until(() => p.snap.meta.activePollId === pollId, 15000)) ? performance.now() - launchAt : Infinity)));
const reached = seen.filter(Number.isFinite);
console.log(`${reached.length === N ? "✓" : "✗"} poll reached ${reached.length}/${N} attendees — p50 ${ms(pct(reached, 50))}, p95 ${ms(pct(reached, 95))}, max ${ms(Math.max(...reached))}`);

const voteStart = performance.now();
people.forEach((p, i) => p.send({ type: "respond", pollId, value: [i % 4] }));
const allIn = await host.until(() => host.snap.results[pollId]?.total === N, 30000);
const voteMs = performance.now() - voteStart;
console.log(`${allIn ? "✓" : "✗"} host saw ${host.snap.results[pollId]?.total}/${N} votes in ${ms(voteMs)}`);
const expected = [0, 1, 2, 3].map((k) => Math.floor(N / 4) + (k < N % 4 ? 1 : 0)).join();
const countsOk = host.snap.results[pollId]?.counts?.join() === expected;
console.log(`${countsOk ? "✓" : "✗"} counts correct (${host.snap.results[pollId]?.counts?.join()})`);
const finalTotals = await Promise.all(people.map((p) => p.until(() => p.snap.results[pollId]?.total === N, 15000)));
const attendeeSynced = finalTotals.filter(Boolean).length;
console.log(`${attendeeSynced === N ? "✓" : "✗"} ${attendeeSynced}/${N} attendees see the final total`);

// ----- Q&A burst: 50 questions, then everyone upvotes one -----
for (let i = 0; i < 50; i++) people[i].send({ type: "ask", text: `Load question ${i}` });
const questionsIn = await host.until(() => host.snap.questions.length === 50, 10000);
console.log(`${questionsIn ? "✓" : "✗"} host received ${host.snap.questions.length}/50 questions`);
const qs = host.snap.questions;
const upStart = performance.now();
people.forEach((p, i) => p.send({ type: "vote", id: qs[i % qs.length].id }));
const votesIn = await host.until(() => host.snap.questions.reduce((s, q) => s + q.votes, 0) === N, 30000);
const upMs = performance.now() - upStart;
console.log(`${votesIn ? "✓" : "✗"} ${host.snap.questions.reduce((s, q) => s + q.votes, 0)}/${N} upvotes reached host in ${ms(upMs)}`);

// ----- quiz: everyone answers, then the reveal updates every score at once -----
host.send({ type: "savePoll", poll: { type: "quiz", title: "Load quiz", options: ["A", "B"], correct: [0], multi: false, timeLimit: 60 } });
await host.until(() => host.snap.polls.some((p) => p.title === "Load quiz"));
const quizId = host.snap.polls.find((p) => p.title === "Load quiz")!.id;
host.send({ type: "activatePoll", pollId: quizId });
const quizActivated = await Promise.all(people.map((p) => p.until(() => p.snap.meta.activePollId === quizId, 15000)));
people.forEach((p, i) => p.send({ type: "respond", pollId: quizId, value: [i % 2] }));
const quizResponsesIn = await host.until(() => host.snap.results[quizId]?.total === N, 30000);
console.log(`${quizActivated.every(Boolean) && quizResponsesIn ? "✓" : "✗"} quiz reached every attendee and received ${host.snap.results[quizId]?.total}/${N} answers`);
const revealAt = performance.now();
host.send({ type: "revealAnswer", pollId: quizId });
const scored = await Promise.all(people.map(async (p) => ((await p.until(() => p.state.me?.quiz != null, 30000)) ? performance.now() - revealAt : Infinity)));
const gotScore = scored.filter(Number.isFinite);
const quizOk = gotScore.length === N && host.snap.leaderboard.players === N;
console.log(`${quizOk ? "✓" : "✗"} reveal: ${gotScore.length}/${N} got their score — p50 ${ms(pct(gotScore, 50))}, p95 ${ms(pct(gotScore, 95))}`);
const scoresOk = people.every((p, i) => {
  const points = p.state.me?.quiz?.last;
  return i % 2 === 0 ? points != null && points >= 500 && points <= 1000 : points === 0;
});
console.log(`${scoresOk ? "✓" : "✗"} correct answers receive points and incorrect answers receive zero`);

// ----- bandwidth -----
const bytes = people.reduce((s, p) => s + p.bytes, 0);
const msgs = people.reduce((s, p) => s + p.messages, 0);
console.log(`ℹ average per attendee: ${Math.round(msgs / N)} messages, ${(bytes / N / 1024).toFixed(1)} KB for the whole test`);

const healthy = [host, ...people].every((p) => p.closeCode === null && p.errors.length === 0);
console.log(`${healthy ? "✓" : "✗"} no participant errors or unexpected socket closures`);
const pass = people.length === N && onlineOk && reached.length === N && allIn && countsOk &&
  attendeeSynced === N && questionsIn && votesIn && quizActivated.every(Boolean) &&
  quizResponsesIn && quizOk && scoresOk && healthy;
for (const p of people) p.close();
host.close();
console.log(pass ? "\nLOAD TEST PASSED" : "\nLOAD TEST FAILED");
process.exit(pass ? 0 : 1);
