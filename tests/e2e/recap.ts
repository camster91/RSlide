// End-to-end tests for v0.5: paste-to-polls, the public recap page and the AI endpoints
// (which must fail politely when AI isn't set up).
// Start the app first (`npm run preview`), then run `npm run test:e2e`.
import { parsePolls } from "../../src/shared/paste";
import { BASE, Client, createEvent, sleep } from "./client";

let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) fails++;
};
const get = async (path: string) => {
  const r = await fetch(`${BASE}${path}`);
  return { status: r.status, data: (await r.json()) as any };
};
const post = async (path: string, body?: unknown) => {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: (await r.json()) as any };
};

const ev = await createEvent("Recap test");
const host = await Client.connect(ev.code, "host", "h1", ev.hostKey);
const a = await Client.connect(ev.code, "attendee", "a1");
const b = await Client.connect(ev.code, "attendee", "a2");
const mod = await Client.connect(ev.code, "mod", "m1", host.snap.meta.modKey!);

// ----- paste to polls -----
const pasted = parsePolls(`Which launch excites you most?
- New dashboard
- Mobile app
- AI assistant

What is 2 + 2?
- 3
- 4 *

How clear is our roadmap? (rating)

On a scale of 1 to 10, how ready are we?

One word for this quarter

Rank these (ranking)
- Speed
- Quality
- Cost

Anything else?`);
host.send({ type: "importPolls", polls: pasted.polls });
ok(await host.until(() => host.snap.polls.length === 7), "pasted polls are accepted by the server");
ok(host.snap.polls.map((p) => p.type).join() === "multiple,quiz,rating,scale,wordcloud,ranking,open", "each pasted poll keeps its type");
const quiz = host.snap.polls[1];
ok(quiz.correct?.join() === "1" && quiz.timeLimit === 30, "pasted quiz keeps the right answer and a 30 second timer");
ok(host.snap.polls[3].range?.max === 10, "pasted scale is 1 to 10");

// ----- AI endpoints without AI -----
const noAi = await post(`/api/events/${ev.code}/ai/polls?key=${ev.hostKey}`, { text: "Some notes about our quarterly plan and goals" });
ok(noAi.status === 400 && /isn't set up/.test(noAi.data.error), "AI polls: polite error when AI isn't set up");
const badKey = await post(`/api/events/${ev.code}/ai/polls?key=wrong`, { text: "Some notes about our quarterly plan" });
ok(badKey.status === 403, "AI polls: wrong host key refused");
const sumNoAi = await post(`/api/events/${ev.code}/ai/summary?key=${ev.hostKey}`);
ok(sumNoAi.status === 400 && /isn't set up/.test(sumNoAi.data.error), "AI summary: polite error when AI isn't set up");
ok((await post(`/api/events/${ev.code}/ai/summary?key=nope`)).status === 403, "AI summary: wrong host key refused");

// ----- build up an event -----
const [mc, , rating, , words] = host.snap.polls;
host.send({ type: "activatePoll", pollId: mc.id });
await a.until(() => a.snap.meta.activePollId === mc.id);
a.send({ type: "respond", pollId: mc.id, value: [2] });
b.send({ type: "respond", pollId: mc.id, value: [2] });
ok(await host.until(() => host.snap.results[mc.id]?.total === 2), "answers in");
host.send({ type: "activatePoll", pollId: quiz.id });
await a.until(() => a.snap.meta.activePollId === quiz.id);
a.send({ type: "respond", pollId: quiz.id, value: [1] });
await host.until(() => host.snap.results[quiz.id]?.total === 1);
host.send({ type: "activatePoll", pollId: rating.id });
await a.until(() => a.snap.meta.activePollId === rating.id);
a.send({ type: "respond", pollId: rating.id, value: 4 });
await host.until(() => host.snap.results[rating.id]?.total === 1);
host.send({ type: "toggleResults", pollId: rating.id }); // hidden from the audience
host.send({ type: "activatePoll", pollId: words.id });
await a.until(() => a.snap.meta.activePollId === words.id);
a.send({ type: "respond", pollId: words.id, value: ["focus"] });
await host.until(() => host.snap.results[words.id]?.total === 1);

a.send({ type: "ask", text: "Will the slides be shared?", name: "Ann" });
b.send({ type: "ask", text: "Is there a team offsite this year?" });
ok(await host.until(() => host.snap.questions.length === 2), "questions in");
const slides = host.snap.questions.find((q) => q.text.startsWith("Will the slides"))!;
const offsite = host.snap.questions.find((q) => q.text.startsWith("Is there"))!;
b.send({ type: "vote", id: slides.id });
host.send({ type: "reply", id: slides.id, text: "Yes, by Friday" });
host.send({ type: "setSettings", settings: { audienceReplies: true } });
await b.until(() => b.snap.meta.settings.audienceReplies);
b.send({ type: "reply", id: slides.id, text: "Thanks!" });
host.send({ type: "answer", id: slides.id });
host.send({ type: "archive", id: offsite.id });
host.send({ type: "setSettings", settings: { moderation: true } });
await a.until(() => a.snap.meta.settings.moderation);
a.send({ type: "ask", text: "A pending question nobody approved" });
ok(await host.until(() => host.snap.questions.some((q) => q.status === "pending") && host.snap.questions.find((q) => q.id === slides.id)?.replies.length === 2), "event built up");

// ----- recap -----
ok((await get(`/api/events/${ev.code}/recap`)).status === 404, "recap is private until the host shares it");
ok(a.snap.meta.recapPublic === false && host.snap.meta.recapSummary === "", "recap starts off, with no summary");
a.send({ type: "setRecap", public: true });
mod.send({ type: "setRecap", public: true });
await sleep(300);
ok((await get(`/api/events/${ev.code}/recap`)).status === 404, "attendees and moderators can't share the recap");

host.send({ type: "setRecap", public: true, summary: "  Great session.\r\n\r\nSlides are coming Friday.  " });
ok(await a.until(() => a.snap.meta.recapPublic), "attendees are told the recap is shared");
ok(a.snap.meta.recapSummary === undefined, "attendees don't get the summary over the socket");
ok(await host.until(() => host.snap.meta.recapSummary === "Great session.\n\nSlides are coming Friday."), "summary is cleaned and saved");

const { status, data: r } = await get(`/api/events/${ev.code}/recap`);
ok(status === 200 && r.title === "Recap test" && r.summary.startsWith("Great session."), "recap is public once shared");
ok(r.questions.length === 1 && r.questions[0].text === "Will the slides be shared?", "recap leaves out pending and archived questions");
ok(r.questions[0].answered === true && r.questions[0].score === 1 && r.questions[0].name === "Ann", "recap shows answered state, score and name");
ok(r.questions[0].replies.length === 1 && r.questions[0].replies[0].text === "Yes, by Friday", "recap keeps only official replies");
const titles = r.polls.map((p: any) => p.poll.title);
ok(titles.includes(mc.title) && titles.includes(words.title), "recap shows polls with results");
ok(!titles.includes(rating.title), "recap leaves out polls whose results were hidden");
ok(!titles.includes(quiz.title), "recap leaves out quizzes whose answer wasn't revealed");
ok(!titles.includes(host.snap.polls[6].title), "recap leaves out polls nobody answered");
ok(r.polls.find((p: any) => p.poll.id === mc.id).results.counts.join() === "0,0,2", "recap has the real counts");
ok(r.stats.questions === 2 && r.stats.answers === 5 && r.stats.votes === 1, `recap stats add up (${JSON.stringify(r.stats)})`);
ok(r.leaderboard === null, "no leaderboard until a quiz is revealed");

host.send({ type: "revealAnswer", pollId: quiz.id });
await host.until(() => host.snap.polls.find((p) => p.id === quiz.id)?.revealed === true);
await sleep(150);
const r2 = (await get(`/api/events/${ev.code}/recap`)).data;
const rq = r2.polls.find((p: any) => p.poll.id === quiz.id);
ok(rq && rq.poll.correct.join() === "1", "revealed quiz appears, with its answer");
ok(r2.leaderboard?.rounds === 1 && r2.leaderboard.top[0].points > 0, "recap shows the quiz leaderboard");

host.send({ type: "setSettings", settings: { hideNames: true } });
await host.until(() => host.snap.meta.settings.hideNames);
ok((await get(`/api/events/${ev.code}/recap`)).data.questions[0].name === "", "recap hides names when the host hides them");

host.send({ type: "setRecap", summary: "x".repeat(5000) });
ok(await host.until(() => host.snap.meta.recapSummary?.length === 2000), "summary is capped at 2,000 characters");

host.send({ type: "setRecap", public: false });
ok(await a.until(() => !a.snap.meta.recapPublic), "host can unshare the recap");
ok((await get(`/api/events/${ev.code}/recap`)).status === 404, "unshared recap is private again");

const page = await fetch(`${BASE}/recap/${ev.code}`);
ok(page.status === 200 && (await page.text()).includes('id="app"'), "/recap/CODE serves the app");

for (const x of [host, a, b, mod]) x.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
