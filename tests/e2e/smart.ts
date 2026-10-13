// End-to-end tests for v0.4: repeat-question hints and merging, presenter remote controls,
// stream overlay and embed script.
// Start the app first (`npm run preview`), then run `npm run test:e2e`.
import { BASE, Client, createEvent, sleep } from "./client";

let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) fails++;
};

const ev = await createEvent("Smart Q&A test");
const host = await Client.connect(ev.code, "host", "h1", ev.hostKey);
const a = await Client.connect(ev.code, "attendee", "a1");
const b = await Client.connect(ev.code, "attendee", "a2");
const c = await Client.connect(ev.code, "attendee", "a3");
const mod = await Client.connect(ev.code, "mod", "m1", host.snap.meta.modKey!);

// ----- settings -----
ok(host.snap.meta.settings.aiAssist === false, "AI help is off by default");
ok(host.snap.meta.ai === false, "host is told AI isn't set up on this server");
ok(a.snap.meta.ai === undefined, "attendees aren't told about AI setup");
host.send({ type: "setSettings", settings: { aiAssist: true } });
ok(await host.until(() => host.snap.meta.settings.aiAssist), "host can turn AI help on (it just does nothing without AI set up)");

// ----- repeat hints -----
a.send({ type: "ask", text: "Will the slides be shared after the talk?", name: "Ann" });
ok(await host.until(() => host.snap.questions.length === 1), "first question arrives");
const first = host.snap.questions[0];
ok(!first.dupOf, "first question is not a repeat");
b.send({ type: "vote", id: first.id });
b.send({ type: "ask", text: "Can you share the slides afterwards?", name: "Bo" });
c.send({ type: "ask", text: "What tools did you use to make the slides?" });
ok(await host.until(() => host.snap.questions.length === 3), "more questions arrive");
const repeat = host.snap.questions.find((q) => q.text.startsWith("Can you share"))!;
const other = host.snap.questions.find((q) => q.text.startsWith("What tools"))!;
ok(repeat.dupOf === first.id, "a reworded question is flagged as a repeat of the first");
ok(!other.dupOf, "a different question about the same topic is not flagged");
ok(await mod.until(() => mod.snap.questions.find((q) => q.id === repeat.id)?.dupOf === first.id), "moderators see repeat hints too");
ok(await a.until(() => a.snap.questions.length === 3) && a.snap.questions.every((q) => q.dupOf === undefined), "attendees never see repeat hints");

// Not a repeat
host.send({ type: "notDuplicate", id: repeat.id });
ok(await host.until(() => !host.snap.questions.find((q) => q.id === repeat.id)?.dupOf), "host can say 'not a repeat'");

// ----- merging -----
c.send({ type: "vote", id: repeat.id });
a.send({ type: "vote", id: repeat.id }); // Ann asked the first one and also upvoted the repeat
ok(await host.until(() => host.snap.questions.find((q) => q.id === repeat.id)?.votes === 2), "repeat collects its own votes");
b.send({ type: "reply", id: repeat.id, text: "+1" });
host.send({ type: "setSettings", settings: { audienceReplies: true } });
await b.until(() => b.snap.meta.settings.audienceReplies);
b.send({ type: "reply", id: repeat.id, text: "Same question here" });
ok(await host.until(() => host.snap.questions.find((q) => q.id === repeat.id)?.replies.length === 1), "repeat has a reply");

host.send({ type: "mergeQuestion", id: repeat.id, into: first.id });
ok(await a.until(() => !a.snap.questions.some((q) => q.id === repeat.id)), "merged question disappears for everyone");
// Wait for the host's copy too (each screen gets its update separately).
await host.until(() => !host.snap.questions.some((q) => q.id === repeat.id) && host.snap.questions.find((q) => q.id === first.id)?.votes === 3);
const merged = host.snap.questions.find((q) => q.id === first.id)!;
// first had: b. repeat had: c, a. Bo (who asked the repeat) also counts. Ann's own question: she now has a vote on it too.
ok(merged.votes === 3, `votes move over without double counting (got ${merged.votes}, want 3: Bo, Cy and Ann)`);
ok(merged.replies.some((r) => r.text === "Same question here"), "replies move over");
ok(await b.until(() => b.state.me!.questions.length === 0 && b.state.me!.votes.includes(first.id)), "the asker of the repeat now supports the kept question");
ok(await c.until(() => c.state.me!.votes.includes(first.id) && !c.state.me!.votes.includes(repeat.id)), "voters' own vote lists update");

host.send({ type: "mergeQuestion", id: first.id, into: first.id });
ok(await host.until(() => host.errors.includes("Pick a different question to merge into")), "can't merge a question into itself");
a.send({ type: "mergeQuestion", id: other.id, into: first.id });
await sleep(250);
ok(host.snap.questions.some((q) => q.id === other.id), "attendees can't merge");
mod.send({ type: "mergeQuestion", id: other.id, into: first.id });
ok(await host.until(() => !host.snap.questions.some((q) => q.id === other.id)), "moderators can merge");

// Merging into a pending question approves it; repeats of the removed one move to the kept one.
host.send({ type: "setSettings", settings: { moderation: true } });
await a.until(() => a.snap.meta.settings.moderation);
// Asked one after another, so the first one is the "original".
for (const [who, text] of [[a, "Is there a recording of this session?"], [b, "Will this session be recorded?"], [c, "Will the session be recorded and posted?"]] as const) {
  const n = host.snap.questions.length;
  who.send({ type: "ask", text });
  await host.until(() => host.snap.questions.length === n + 1);
}
ok(host.snap.questions.filter((q) => q.status === "pending").length === 3, "three pending questions");
const [p1, p2, p3] = ["Is there", "Will this", "Will the session"].map((t) => host.snap.questions.find((q) => q.text.startsWith(t))!);
ok(p2.dupOf === p1.id && p3.dupOf === p1.id, "pending questions are checked for repeats too");
host.send({ type: "mergeQuestion", id: p1.id, into: p2.id });
ok(await host.until(() => host.snap.questions.find((q) => q.id === p2.id)?.status === "live"), "merging approves the kept question");
ok(await host.until(() => host.snap.questions.find((q) => q.id === p3.id)?.dupOf === p2.id), "other repeats now point at the kept question");
host.send({ type: "setSettings", settings: { moderation: false } });

// Editing a question re-checks it
a.send({ type: "ask", text: "Where is the coffee?" });
ok(await a.until(() => a.snap.questions.some((q) => q.text === "Where is the coffee?")), "new question");
const coffee = a.snap.questions.find((q) => q.text === "Where is the coffee?")!;
a.send({ type: "editQuestion", id: coffee.id, text: "Will this session be recorded?" });
ok(await host.until(() => host.snap.questions.find((q) => q.id === coffee.id)?.dupOf === p2.id), "editing a question re-checks it for repeats");

// Deleting the original clears hints that point at it
host.send({ type: "deleteQuestion", id: p2.id });
ok(await host.until(() => host.snap.questions.every((q) => q.dupOf !== p2.id)), "deleting a question clears hints that pointed at it");

// ----- presenter remote (uses normal host messages) -----
host.send({ type: "savePoll", poll: { type: "multiple", title: "One", options: ["x", "y"], correct: [], multi: false } });
host.send({ type: "savePoll", poll: { type: "multiple", title: "Two", options: ["x", "y"], correct: [], multi: false } });
ok(await host.until(() => host.snap.polls.length === 2), "two polls");
const remote = await Client.connect(ev.code, "host", "r1", ev.hostKey);
const [one, two] = host.snap.polls;
remote.send({ type: "activatePoll", pollId: one.id });
ok(await a.until(() => a.snap.meta.activePollId === one.id), "remote starts the first poll");
remote.send({ type: "activatePoll", pollId: two.id });
ok(await host.until(() => host.snap.meta.activePollId === two.id && host.snap.polls.find((p) => p.id === one.id)?.status === "closed"), "remote 'Next' moves on and closes the last poll");
remote.send({ type: "setPresentMode", mode: "qa" });
ok(await host.until(() => host.snap.meta.presentMode === "qa"), "remote switches the big screen");
remote.send({ type: "activatePoll", pollId: null });
ok(await a.until(() => a.snap.meta.activePollId === null), "remote stops the poll");
remote.close();

// ----- pages -----
for (const path of [`/remote/${ev.code}`, `/present/${ev.code}?overlay=1`]) {
  const r = await fetch(`${BASE}${path}`);
  ok(r.status === 200 && (await r.text()).includes('id="app"'), `${path} serves the app`);
}
const js = await fetch(`${BASE}/embed.js`);
const body = await js.text();
ok(js.status === 200 && /javascript/.test(js.headers.get("content-type") ?? "") && body.includes("data-rslide"), "embed.js is served as JavaScript");
const frameHeaders = await fetch(`${BASE}/e/${ev.code}?embed=1`);
const xfo = frameHeaders.headers.get("x-frame-options");
ok(!xfo || !/deny|sameorigin/i.test(xfo), "attendee page can be framed by other sites");

for (const x of [host, a, b, c, mod]) x.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
