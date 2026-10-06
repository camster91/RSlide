// End-to-end tests: a host, attendees and a big screen talking to a running server.
// Start the app first (`npm run preview`), then run `npm run test:e2e`.
import { BASE, Client, createEvent, sleep } from "./client";

let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) fails++;
};

const ev = await createEvent("Test <script>alert(1)</script>");
ok(ev.code?.length === 6 && ev.hostKey, `create event ${ev.code}`);

const host = await Client.connect(ev.code, "host", "h1", ev.hostKey);
const a = await Client.connect(ev.code, "attendee", "a1");
const b = await Client.connect(ev.code, "attendee", "a2");
const pres = await Client.connect(ev.code, "present", "p1", ev.hostKey);
ok(host.state.role === "host" && host.state.hostKey === ev.hostKey, "host gets host role and key");
ok(a.state.role === "attendee" && !a.state.hostKey, "attendee never sees host key");

const bad = await Client.connect(ev.code, "host", "x", "nope");
ok(bad.closeCode === 4001, "wrong host key rejected");
const missing = await Client.connect("ZZZZZZ", "attendee", "x");
ok(missing.closeCode === 4004, "unknown event closes with not-found");
const sneaky = await Client.connect(ev.code, "present", "x");
ok(sneaky.state.role === "attendee", "big screen without key is treated as attendee");
sneaky.close();

// ----- Q&A -----
a.send({ type: "ask", text: "What is the exam format?", name: "Sam" });
b.send({ type: "ask", text: "Will slides be posted?" });
ok(await host.until(() => host.snap.questions.length === 2), "questions reach host");
ok(await b.until(() => b.snap.questions.length === 2), "questions reach attendees");
ok(await a.until(() => a.state.me!.questions.length === 1), "author knows which question is theirs");

const q1 = a.snap.questions.find((q) => q.text.startsWith("What"))!;
b.send({ type: "vote", id: q1.id });
host.send({ type: "vote", id: q1.id });
ok(await a.until(() => a.snap.questions.find((q) => q.id === q1.id)?.votes === 2), "upvotes counted");
ok(await b.until(() => b.state.me!.votes.includes(q1.id)), "voter's own vote is remembered");
b.send({ type: "vote", id: q1.id });
ok(await a.until(() => a.snap.questions.find((q) => q.id === q1.id)?.votes === 1), "un-vote works");

// moderation
host.send({ type: "setSettings", settings: { moderation: true } });
ok(await a.until(() => a.snap.meta.settings.moderation), "settings broadcast");
a.send({ type: "ask", text: "Hidden until approved" });
ok(await host.until(() => host.snap.questions.some((q) => q.status === "pending")), "host sees pending question");
await sleep(200);
ok(!b.snap.questions.some((q) => q.text === "Hidden until approved"), "pending hidden from others");
ok(a.snap.questions.some((q) => q.text === "Hidden until approved" && q.status === "pending"), "author sees own pending question");
const pend = host.snap.questions.find((q) => q.status === "pending")!;
host.send({ type: "approve", id: pend.id });
ok(await b.until(() => b.snap.questions.some((q) => q.id === pend.id && q.status === "live")), "approve publishes");

host.send({ type: "highlight", id: q1.id });
ok(await pres.until(() => !!pres.snap.questions.find((q) => q.id === q1.id)?.highlighted), "highlight reaches big screen");
host.send({ type: "highlight", id: pend.id });
ok(await pres.until(() => pres.snap.questions.filter((q) => q.highlighted).length === 1 && !!pres.snap.questions.find((q) => q.id === pend.id)?.highlighted), "only one highlight at a time");
host.send({ type: "archive", id: pend.id });
ok(await b.until(() => !b.snap.questions.some((q) => q.id === pend.id)), "archived question leaves attendee view");
ok(await host.until(() => host.snap.questions.find((q) => q.id === pend.id)?.status === "archived"), "host still sees archived question");

a.send({ type: "deleteQuestion", id: q1.id } as never);
await sleep(250);
ok(host.snap.questions.some((q) => q.id === q1.id), "attendee cannot use host actions");
host.send({ type: "deleteQuestion", id: q1.id });
ok(await a.until(() => !a.snap.questions.some((q) => q.id === q1.id)), "host delete removes question everywhere");

// ----- polls -----
host.send({ type: "savePoll", poll: { type: "multiple", title: "Best case?", options: ["A", "B", "C"], correct: [], multi: false } });
host.send({ type: "savePoll", poll: { type: "quiz", title: "2+2?", options: ["3", "4"], correct: [1], multi: false } });
host.send({ type: "savePoll", poll: { type: "wordcloud", title: "One word", options: [], correct: [], multi: false } });
host.send({ type: "savePoll", poll: { type: "rating", title: "Rate today", options: [], correct: [], multi: false } });
host.send({ type: "savePoll", poll: { type: "multiple", title: "", options: ["x", "y"], correct: [], multi: false } });
ok(await host.until(() => host.snap.polls.length === 4), "polls saved in order");
ok(host.errors.includes("Poll needs a question"), "invalid poll rejected with friendly message");
ok(a.snap.polls.length === 0, "draft polls hidden from audience");
const [mc, quiz, wc, rt] = host.snap.polls;
ok(mc.title === "Best case?" && rt.title === "Rate today", "poll order kept");

host.send({ type: "activatePoll", pollId: mc.id });
ok(await a.until(() => a.snap.polls[0]?.id === mc.id && a.snap.meta.activePollId === mc.id), "launched poll reaches audience");
a.send({ type: "respond", pollId: mc.id, value: [1] });
b.send({ type: "respond", pollId: mc.id, value: [1] });
b.send({ type: "respond", pollId: mc.id, value: [0, 2] });
ok(await host.until(() => host.snap.results[mc.id]?.counts?.join() === "0,2,0"), "multiple-choice results tallied");
ok(await b.until(() => b.errors.includes("Pick one option")), "single-choice enforced");
ok(await a.until(() => JSON.stringify(a.state.me!.responses[mc.id]) === "[1]"), "attendee's own answer remembered");

host.send({ type: "toggleResults", pollId: mc.id });
ok(await a.until(() => !!a.snap.results[mc.id]?.hidden), "hidden results: attendee sees only total");
ok(await pres.until(() => pres.snap.results[mc.id]?.counts?.join() === "0,2,0"), "big screen still sees results");

host.send({ type: "activatePoll", pollId: quiz.id });
ok(await host.until(() => host.snap.polls.find((p) => p.id === mc.id)?.status === "closed"), "launching another poll closes the previous one");
ok(await a.until(() => a.snap.polls.length === 1 && a.snap.polls[0].id === quiz.id), "attendee only sees the active poll");
ok(a.snap.polls[0].correct === undefined, "quiz answer hidden before reveal");
a.send({ type: "respond", pollId: quiz.id, value: [1] });
host.send({ type: "revealAnswer", pollId: quiz.id });
ok(await a.until(() => a.snap.polls[0]?.correct?.join() === "1"), "quiz reveal");

host.send({ type: "activatePoll", pollId: wc.id });
await a.until(() => a.snap.meta.activePollId === wc.id);
a.send({ type: "respond", pollId: wc.id, value: ["Strategy"] });
b.send({ type: "respond", pollId: wc.id, value: ["strategy"] });
ok(await host.until(() => host.snap.results[wc.id]?.words?.[0]?.join() === "strategy,2"), "word cloud merges case");

host.send({ type: "activatePoll", pollId: rt.id });
await a.until(() => a.snap.meta.activePollId === rt.id);
a.send({ type: "respond", pollId: rt.id, value: 4 });
b.send({ type: "respond", pollId: rt.id, value: 5 });
ok(await host.until(() => host.snap.results[rt.id]?.avg === 4.5), "rating average");

host.send({ type: "movePoll", pollId: rt.id, dir: "up" });
ok(await host.until(() => host.snap.polls[2]?.id === rt.id), "reorder polls");
host.send({ type: "resetPoll", pollId: rt.id });
ok(await host.until(() => host.snap.results[rt.id]?.total === 0), "reset poll");
ok(await a.until(() => a.state.me!.responses[rt.id] === undefined), "reset clears attendee's answer");

// closed Q&A
host.send({ type: "setSettings", settings: { qaOpen: false } });
await a.until(() => !a.snap.meta.settings.qaOpen);
a.send({ type: "ask", text: "late" });
ok(await a.until(() => a.errors.some((e) => e.includes("closed"))), "closed Q&A blocks questions");

// title + present mode
host.send({ type: "setTitle", title: "Renamed session" });
host.send({ type: "setPresentMode", mode: "code" });
ok(await pres.until(() => pres.snap.meta.title === "Renamed session" && pres.snap.meta.presentMode === "code"), "title and big-screen mode update live");

// reconnect keeps personal state
a.close();
const a2 = await Client.connect(ev.code, "attendee", "a1");
ok(JSON.stringify(a2.state.me!.responses[quiz.id]) === "[1]" && a2.state.me!.questions.length >= 1, "personal state survives reconnect");

// online count (throttled)
ok(await host.until(() => host.snap.online === 2, 4000), `online count updates (${host.snap.online})`);

// export
const csv = await (await fetch(`${BASE}/api/events/${ev.code}/export?key=${ev.hostKey}`)).text();
ok(csv.includes("Will slides be posted?") && csv.includes("strategy") && csv.includes("Average"), "CSV export has questions and poll results");
ok((await fetch(`${BASE}/api/events/${ev.code}/export?key=bad`)).status === 403, "CSV export needs host key");
ok((await fetch(`${BASE}/api/events/ZZZZZZ`)).status === 404, "unknown code gives 404");
const info = await (await fetch(`${BASE}/api/events/${ev.code.toLowerCase()}`)).json();
ok(info.title === "Renamed session", "event info lookup (case-insensitive code)");

for (const c of [host, a2, b, pres]) c.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
