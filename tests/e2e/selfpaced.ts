// End-to-end tests for v1.0: self-paced mode and pictures on questions.
// Start the app first (`npm run preview`), then run `npm run test:e2e`.
import { Client, createEvent, sleep } from "./client";

let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) fails++;
};

const ev = await createEvent("Self-paced");
const host = await Client.connect(ev.code, "host", "h1", ev.hostKey);
const a = await Client.connect(ev.code, "attendee", "sp-a");
const b = await Client.connect(ev.code, "attendee", "sp-b");

for (const poll of [
  { type: "multiple", title: "Favourite colour?", options: ["Red", "Blue"], correct: [], multi: false },
  { type: "quiz", title: "Capital of France?", options: ["Paris", "Rome"], correct: [0], multi: false, timeLimit: 5 },
  { type: "rating", title: "Rate the course", options: [], correct: [], multi: false },
] as const)
  host.send({ type: "savePoll", poll: { ...poll, options: [...poll.options], correct: [...poll.correct] } });
await host.until(() => host.snap.polls.length === 3);
const [p1, q1, p3] = host.snap.polls;

// Live mode: launching one closes the other.
host.send({ type: "activatePoll", pollId: p1.id });
await host.until(() => host.snap.polls[0].status === "active");
host.send({ type: "activatePoll", pollId: p3.id });
await host.until(() => host.snap.polls[2].status === "active");
ok(host.snap.polls[0].status === "closed", "live mode: one poll at a time");

// Switch to self-paced.
host.send({ type: "setSettings", settings: { selfPaced: true } });
ok(await a.until(() => a.snap.meta.settings.selfPaced), "attendees see self-paced mode");
ok(await host.until(() => host.snap.meta.settings.selfPaced && host.snap.meta.activePollId === null && host.snap.polls[2].status === "active"), "the live poll stays open, with no 'current' poll");
for (const p of [p1, q1]) host.send({ type: "activatePoll", pollId: p.id });
ok(await a.until(() => a.snap.polls.filter((p) => p.status === "active").length === 3), "several polls open at once");

a.send({ type: "respond", pollId: p1.id, value: [1] });
a.send({ type: "respond", pollId: p3.id, value: 4 });
ok(await a.until(() => Object.keys(a.state.me!.responses).length === 2), "answer polls in any order");

// Quizzes: no timer, each person sees their result right away.
await sleep(5500);
a.send({ type: "respond", pollId: q1.id, value: [0] });
ok(await a.until(() => a.state.me!.checked?.[q1.id]?.[0] === 0), "after answering, the person learns the right answer (even after the timer)");
ok(!a.snap.polls.find((p) => p.id === q1.id)!.correct, "the right answer isn't sent to everyone");
ok(!b.state.me!.checked?.[q1.id], "people who haven't answered don't get it");
ok(await a.until(() => a.state.me!.quiz?.points === 1000), "points count right away");
b.send({ type: "respond", pollId: q1.id, value: [1] });
ok(await b.until(() => b.state.me!.checked?.[q1.id] !== undefined && b.state.me!.quiz?.points === 0), "a wrong answer scores 0");
ok(await host.until(() => host.snap.leaderboard.players === 2 && host.snap.leaderboard.rounds === 1), "leaderboard counts self-paced quizzes");
a.send({ type: "respond", pollId: q1.id, value: [1] });
ok(await a.until(() => a.errors.includes("You've already answered this one")), "quiz answers can't be changed");

// Close one; back to live closes everything.
host.send({ type: "closePoll", pollId: p1.id });
ok(await a.until(() => !a.snap.polls.some((p) => p.id === p1.id)), "closing a poll hides it from attendees");
host.send({ type: "setSettings", settings: { selfPaced: false } });
ok(await a.until(() => !a.snap.meta.settings.selfPaced && a.snap.polls.length === 0), "back to live closes all open polls");

// Pictures: a non-pin poll can carry an optional picture; bad IDs are dropped.
host.send({ type: "savePoll", poll: { type: "multiple", title: "With picture", options: ["x", "y"], correct: [], multi: false, image: "abcdefabcdef" } });
host.send({ type: "savePoll", poll: { type: "multiple", title: "Bad picture", options: ["x", "y"], correct: [], multi: false, image: "../../x" } });
ok(await host.until(() => host.snap.polls.length === 5), "polls with pictures saved");
ok(host.snap.polls.find((p) => p.title === "With picture")?.image === "abcdefabcdef", "picture kept on a multiple-choice poll");
ok(host.snap.polls.find((p) => p.title === "Bad picture")?.image === null, "bad picture ID dropped");

for (const c of [host, a, b]) c.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
