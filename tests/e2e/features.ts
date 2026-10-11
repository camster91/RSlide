// End-to-end tests for v0.3 features: replies, labels, rooms, moderators, word filter,
// schedules, hidden names, logo, templates, event copies, new poll types and analytics.
// Start the app first (`npm run preview`), then run `npm run test:e2e`.
import { BASE, Client, createEvent, sleep } from "./client";

let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) fails++;
};
const post = async (path: string, body: unknown) => {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: (await r.json()) as any };
};

const ev = await createEvent("Feature test");
const host = await Client.connect(ev.code, "host", "h1", ev.hostKey);
const a = await Client.connect(ev.code, "attendee", "a1");
const b = await Client.connect(ev.code, "attendee", "a2");
// A third attendee, because each person can only ask 5 questions a minute.
const c = await Client.connect(ev.code, "attendee", "a3");
const pres = await Client.connect(ev.code, "present", "p1", ev.hostKey);

// ----- moderator link -----
const modKey = host.snap.meta.modKey!;
ok(/^[a-z0-9]{24}$/.test(modKey) && modKey !== ev.hostKey, "host gets a separate moderator key");
ok(a.snap.meta.modKey === undefined && pres.snap.meta.modKey === undefined, "nobody else sees the moderator key");
const mod = await Client.connect(ev.code, "mod", "m1", modKey);
ok(mod.state.role === "mod" && !mod.state.hostKey, "moderator joins with their link (and never gets the host key)");
const badMod = await Client.connect(ev.code, "mod", "m2", "wrong");
ok(badMod.closeCode === 4001, "wrong moderator link refused");

host.send({ type: "setSettings", settings: { moderation: true } });
await a.until(() => a.snap.meta.settings.moderation);
a.send({ type: "ask", text: "Pending for the moderator" });
ok(await mod.until(() => mod.snap.questions.some((q) => q.status === "pending")), "moderator sees questions waiting for review");
const pq = mod.snap.questions.find((q) => q.status === "pending")!;
mod.send({ type: "approve", id: pq.id });
ok(await b.until(() => b.snap.questions.some((q) => q.id === pq.id)), "moderator can approve");
mod.send({ type: "savePoll", poll: { type: "multiple", title: "Mod poll", options: ["a", "b"], correct: [], multi: false } });
mod.send({ type: "setTitle", title: "Hijacked" });
await sleep(300);
ok(!host.snap.polls.some((p) => p.title === "Mod poll") && host.snap.meta.title === "Feature test", "moderator can't make polls or change settings");
host.send({ type: "setSettings", settings: { moderation: false } });

// ----- replies -----
host.send({ type: "reply", id: pq.id, text: "Great question, answering now" });
ok(await a.until(() => a.snap.questions.find((q) => q.id === pq.id)?.replies[0]?.official === true), "host reply reaches attendees, marked official");
ok(a.snap.questions.find((q) => q.id === pq.id)!.replies[0].name === "Host", "host reply is signed 'Host'");
b.send({ type: "reply", id: pq.id, text: "Me too" });
ok(await b.until(() => b.errors.includes("Replies are turned off")), "audience replies are off by default");
host.send({ type: "setSettings", settings: { audienceReplies: true } });
await b.until(() => b.snap.meta.settings.audienceReplies);
b.send({ type: "reply", id: pq.id, text: "Me too", name: "Bo" });
ok(await a.until(() => a.snap.questions.find((q) => q.id === pq.id)?.replies.length === 2), "attendees can reply when allowed");
ok(await b.until(() => b.state.me!.replies.length === 1), "replier knows which reply is theirs");
const bReply = b.state.me!.replies[0];
a.send({ type: "deleteReply", id: pq.id, replyId: bReply });
ok(await a.until(() => a.errors.includes("You can only delete your own replies")), "others can't delete your reply");
b.send({ type: "deleteReply", id: pq.id, replyId: bReply });
ok(await a.until(() => a.snap.questions.find((q) => q.id === pq.id)?.replies.length === 1), "you can delete your own reply");

// ----- labels -----
host.send({ type: "setLabels", labels: [{ name: "Finance", color: "green" }, { name: "Follow up", color: "amber" }, { name: "finance", color: "red" }] });
ok(await mod.until(() => mod.snap.meta.labels.length === 2), "host makes labels (duplicates dropped)");
const fin = mod.snap.meta.labels.find((l) => l.name === "Finance")!;
mod.send({ type: "tagQuestion", id: pq.id, label: fin.id });
ok(await a.until(() => !!a.snap.questions.find((q) => q.id === pq.id)?.labels.includes(fin.id)), "moderator tags a question; attendees see the label");
host.send({ type: "setLabels", labels: mod.snap.meta.labels.filter((l) => l.id !== fin.id) });
ok(await a.until(() => a.snap.questions.find((q) => q.id === pq.id)?.labels.length === 0), "deleting a label removes it from questions");

// ----- rooms -----
host.send({ type: "setRooms", rooms: [{ name: "Main stage" }, { name: "Workshop" }] });
ok(await a.until(() => a.snap.meta.rooms.length === 2 && a.snap.meta.rooms[0].id === "main"), "host adds rooms; the first keeps existing questions");
const workshop = a.snap.meta.rooms[1];
a.send({ type: "ask", text: "Workshop question", room: workshop.id });
a.send({ type: "ask", text: "Bad room question", room: "nope" });
ok(await host.until(() => host.snap.questions.find((q) => q.text === "Workshop question")?.room === workshop.id), "questions go to the room they were asked in");
ok(await host.until(() => host.snap.questions.find((q) => q.text === "Bad room question")?.room === "main"), "unknown rooms fall back to the main room");
const wq = host.snap.questions.find((q) => q.text === "Workshop question")!;
mod.send({ type: "moveQuestion", id: wq.id, room: "main" });
ok(await a.until(() => a.snap.questions.find((q) => q.id === wq.id)?.room === "main"), "moderator moves a question to another room");
mod.send({ type: "moveQuestion", id: wq.id, room: workshop.id });
await a.until(() => a.snap.questions.find((q) => q.id === wq.id)?.room === workshop.id);
host.send({ type: "setRooms", rooms: [{ id: "main", name: "Main stage" }] });
ok(await a.until(() => a.snap.questions.find((q) => q.id === wq.id)?.room === "main"), "removing a room moves its questions to the main room");

// ----- hide names -----
host.send({ type: "setSettings", settings: { hideNames: true } });
a.send({ type: "ask", text: "Secret asker", name: "Alice" });
ok(await b.until(() => b.snap.questions.some((q) => q.text === "Secret asker" && q.name === "")), "hidden names: other attendees don't see who asked");
ok(await pres.until(() => pres.snap.questions.some((q) => q.text === "Secret asker" && q.name === "")), "hidden names: big screen doesn't either");
ok(await host.until(() => host.snap.questions.some((q) => q.text === "Secret asker" && q.name === "Alice")), "hidden names: host still sees the name");
host.send({ type: "setSettings", settings: { hideNames: false } });
ok(await b.until(() => b.snap.questions.some((q) => q.text === "Secret asker" && q.name === "Alice")), "turning it off shows names again");

// ----- word filter -----
host.send({ type: "setSettings", settings: { profanity: "mask", blockedWords: ["acme"] } });
ok(await host.until(() => host.snap.meta.settings.profanity === "mask" && host.snap.meta.settings.blockedWords.join() === "acme"), "host sets filter and own words");
ok(await a.until(() => a.snap.meta.settings.profanity === "mask") && a.snap.meta.settings.blockedWords.length === 0, "attendees don't see the host's word list");
a.send({ type: "ask", text: "Why is this shit so slow vs ACME?" });
ok(await b.until(() => b.snap.questions.some((q) => q.text === "Why is this s*** so slow vs A***?")), "mask mode hides bad words and custom words");
host.send({ type: "setSettings", settings: { profanity: "review" } });
await a.until(() => a.snap.meta.settings.profanity === "review");
await c.until(() => c.snap.meta.settings.profanity === "review");
c.send({ type: "ask", text: "This is crap" });
c.send({ type: "ask", text: "This is fine" });
ok(await host.until(() => host.snap.questions.some((q) => q.text === "This is crap" && q.status === "pending")), "review mode sends flagged questions to review (host sees original)");
ok(await b.until(() => b.snap.questions.some((q) => q.text === "This is fine" && q.status === "live")), "clean questions still go live");
await sleep(200);
ok(!b.snap.questions.some((q) => q.text.includes("crap") || q.text === "This is c***"), "flagged question hidden from others until approved");
const flagged = host.snap.questions.find((q) => q.text === "This is crap")!;
host.send({ type: "approve", id: flagged.id });
ok(await b.until(() => b.snap.questions.some((q) => q.id === flagged.id && q.text === "This is c***")), "approved flagged question shows masked to attendees");
host.send({ type: "savePoll", poll: { type: "wordcloud", title: "Words", options: [], correct: [], multi: false } });
await host.until(() => host.snap.polls.some((p) => p.title === "Words"));
const wc = host.snap.polls.find((p) => p.title === "Words")!;
host.send({ type: "activatePoll", pollId: wc.id });
await a.until(() => a.snap.meta.activePollId === wc.id);
a.send({ type: "respond", pollId: wc.id, value: ["shit"] });
ok(await a.until(() => a.errors.includes("Please choose a different word")), "filtered word-cloud words are refused");
host.send({ type: "setSettings", settings: { profanity: "off" } });

// ----- schedule -----
host.send({ type: "setSettings", settings: { qaOpen: false, qaOpensAt: Date.now() + 1500 } });
ok(await a.until(() => !a.snap.meta.settings.qaOpen && !!a.snap.meta.settings.qaOpensAt), "Q&A closed with an opening time set");
ok(await a.until(() => a.snap.meta.settings.qaOpen && a.snap.meta.settings.qaOpensAt === null, 6000), "Q&A opens by itself at the set time");
host.send({ type: "setSettings", settings: { qaClosesAt: Date.now() + 1500 } });
ok(await a.until(() => !a.snap.meta.settings.qaOpen && a.snap.meta.settings.qaClosesAt === null, 6000), "Q&A closes by itself at the set time");
host.send({ type: "setSettings", settings: { qaOpen: true, qaOpensAt: Date.now() + 9000, qaClosesAt: Date.now() + 5000 } });
ok(await host.until(() => host.errors.includes("Closing time must be after opening time")), "closing before opening is refused");
await sleep(200);
ok(host.snap.meta.settings.qaOpensAt === null && host.snap.meta.settings.qaClosesAt === null, "a refused change leaves settings untouched");

// ----- logo -----
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const up = await fetch(`${BASE}/api/events/${ev.code}/media?key=${ev.hostKey}`, { method: "POST", headers: { "content-type": "image/png" }, body: png });
const logoId = ((await up.json()) as { id: string }).id;
host.send({ type: "setSettings", settings: { logo: logoId } });
ok(await a.until(() => a.snap.meta.settings.logo === logoId), "event logo reaches attendees");
ok((await (await fetch(`${BASE}/api/events/${ev.code}`)).json()).logo === logoId, "event info includes the logo");
host.send({ type: "setSettings", settings: { logo: "../../hack" as never } });
ok(await host.until(() => host.snap.meta.settings.logo === null), "invalid logo IDs are dropped");
host.send({ type: "setSettings", settings: { logo: logoId } });

// ----- new poll types -----
host.send({ type: "savePoll", poll: { type: "points", title: "Budget", options: ["Ads", "Events", "Content"], correct: [], multi: false } });
host.send({ type: "savePoll", poll: { type: "grid", title: "Plot ideas", options: ["Idea A", "Idea B"], correct: [], multi: false, axes: ["Impact", "Effort"] } });
host.send({ type: "savePoll", poll: { type: "pin", title: "Where do you sit?", options: [], correct: [], multi: false, image: logoId } });
ok(await host.until(() => ["Budget", "Plot ideas", "Where do you sit?"].every((t) => host.snap.polls.some((p) => p.title === t))), "100 points, 2×2 grid and pin polls saved");
const [pts, grid, pin] = ["Budget", "Plot ideas", "Where do you sit?"].map((t) => host.snap.polls.find((p) => p.title === t)!);
ok(pin.image === logoId && grid.axes?.join() === "Impact,Effort", "pin keeps its picture and grid keeps its axes");

host.send({ type: "activatePoll", pollId: pts.id });
await a.until(() => a.snap.meta.activePollId === pts.id);
a.send({ type: "respond", pollId: pts.id, value: [60, 40, 0] });
b.send({ type: "respond", pollId: pts.id, value: [0, 20, 80] });
b.send({ type: "respond", pollId: pts.id, value: [90, 20, 0] });
ok(await host.until(() => host.snap.results[pts.id]?.scores?.join() === "30,30,40"), "100 points averages");
ok(await b.until(() => b.errors.includes("You only have 100 points")), "can't give more than 100 points");

host.send({ type: "activatePoll", pollId: grid.id });
await a.until(() => a.snap.meta.activePollId === grid.id);
a.send({ type: "respond", pollId: grid.id, value: [[8, 2], [3, 9]] });
b.send({ type: "respond", pollId: grid.id, value: [[6, 4], [5, 7]] });
ok(await host.until(() => JSON.stringify(host.snap.results[grid.id]?.pairs) === "[[7,3],[4,8]]"), "2×2 grid averages each option");

host.send({ type: "activatePoll", pollId: pin.id });
await a.until(() => a.snap.meta.activePollId === pin.id);
a.send({ type: "respond", pollId: pin.id, value: [0.25, 0.75] });
b.send({ type: "respond", pollId: pin.id, value: [0.5, 0.5] });
ok(await pres.until(() => pres.snap.results[pin.id]?.pins?.length === 2), "pins reach the big screen");

// survey with new item types
host.send({ type: "savePoll", poll: { type: "survey", title: "Mixed", options: [], correct: [], multi: false, items: [{ type: "points", title: "Split", options: ["x", "y"] }, { type: "pin", title: "Tap", options: [], image: logoId }] } });
ok(await host.until(() => host.snap.polls.some((p) => p.title === "Mixed" && p.items[1].image === logoId)), "surveys can include the new question types");

// ----- import a template into an existing event -----
const before = host.snap.polls.length;
host.send({ type: "importPolls", polls: [{ type: "rating", title: "T1", options: [], correct: [], multi: false }, { type: "open", title: "T2", options: [], correct: [], multi: false }] });
ok(await host.until(() => host.snap.polls.length === before + 2), "add a set of polls in one go");
host.send({ type: "importPolls", polls: [{ type: "rating", title: "Good", options: [], correct: [], multi: false }, { type: "multiple", title: "Bad", options: ["only one"], correct: [], multi: false }] });
await sleep(300);
ok(host.snap.polls.length === before + 2 && host.errors.some((e) => e.includes("at least 2 options")), "a broken set is refused as a whole");

// ----- analytics -----
await sleep(300);
const an = await (await fetch(`${BASE}/api/events/${ev.code}/analytics?key=${ev.hostKey}`)).json();
ok(an.participants === 3 && an.peakOnline >= 3, `analytics: participants and peak online (${an.participants}, ${an.peakOnline})`);
ok(an.questions >= 6 && an.askers === 2 && an.replies === 1, `analytics: questions, askers, replies (${an.questions}, ${an.askers}, ${an.replies})`);
ok(an.polls.find((p: { title: string }) => p.title === "Budget")?.responses === 2, "analytics: responses per poll");
const tl = an.timeline as { joins: number; questions: number; answers: number }[];
ok(tl.length >= 1 && tl.reduce((s, t) => s + t.joins, 0) === 3 && tl.reduce((s, t) => s + t.questions, 0) === an.questions, "analytics: activity timeline adds up");
ok(an.topQuestions.length > 0 && an.rooms[0].name === "Main stage", "analytics: top questions and rooms");
ok((await fetch(`${BASE}/api/events/${ev.code}/analytics?key=bad`)).status === 403, "analytics needs the host key");

// ----- new moderator link kicks the old one -----
host.send({ type: "newModKey" });
ok(await mod.until(() => mod.closeCode === 4001), "making a new moderator link disconnects the old one");
ok(await host.until(() => host.snap.meta.modKey !== modKey), "host gets the new moderator key");
const hostAsMod = await Client.connect(ev.code, "mod", "m3", ev.hostKey);
ok(hostAsMod.state.role === "mod", "the host link also works as a moderator link");
hostAsMod.close();

// ----- create from a built-in template -----
const tpl = await post("/api/events", { title: "Trivia night", template: "trivia" });
ok(tpl.status === 201, "create an event from a built-in template");
const th = await Client.connect(tpl.data.code, "host", "t1", tpl.data.hostKey);
ok(th.snap.polls.length === 5 && th.snap.polls.every((p) => p.type === "quiz") && th.snap.meta.settings.identity === "name", "template polls and settings applied");
th.close();
ok((await post("/api/events", { template: "nope" })).status === 400, "unknown template refused");

// ----- copy an event -----
host.send({ type: "setLabels", labels: [{ name: "Keep me", color: "blue" }] });
host.send({ type: "setRooms", rooms: [{ id: "main", name: "Main stage" }, { name: "Overflow" }] });
await host.until(() => host.snap.meta.rooms.length === 2 && host.snap.meta.labels.length === 1);
ok((await post("/api/events", { from: { code: ev.code, key: "wrong" } })).status === 403, "copying needs the host key");
const copy = await post("/api/events", { from: { code: ev.code, key: ev.hostKey } });
ok(copy.status === 201 && copy.data.code !== ev.code && copy.data.title === "Feature test (copy)", "copy an event");
const ch = await Client.connect(copy.data.code, "host", "c1", copy.data.hostKey);
const orig = host.snap.polls.map((p) => p.title).join("|");
ok(ch.snap.polls.map((p) => p.title).join("|") === orig, "copy has the same polls in the same order");
ok(ch.snap.polls.every((p) => p.status === "draft") && Object.keys(ch.snap.results).length === 0, "copy starts fresh: no answers, nothing live");
ok(ch.snap.questions.length === 0, "copy has no questions");
ok(ch.snap.meta.labels[0]?.name === "Keep me" && ch.snap.meta.rooms.map((r) => r.name).join() === "Main stage,Overflow", "copy keeps labels and rooms");
ok(ch.snap.meta.settings.logo === logoId && ch.snap.meta.modKey !== host.snap.meta.modKey, "copy keeps the logo, gets new keys");
const copiedImg = await fetch(`${BASE}/api/events/${copy.data.code}/media/${logoId}`);
ok(copiedImg.status === 200, "images are copied to the new event");
ch.close();

for (const x of [host, a, b, c, pres, mod, badMod]) x.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
