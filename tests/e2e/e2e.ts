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


// ===================== v0.2 features =====================
console.log("\n— v0.2 —");
host.send({ type: "setSettings", settings: { qaOpen: true, moderation: false } });
await a2.until(() => a2.snap.meta.settings.qaOpen && !a2.snap.meta.settings.moderation);

// downvotes
b.send({ type: "ask", text: "Downvote me" });
await host.until(() => host.snap.questions.some((q) => q.text === "Downvote me"));
const dq = host.snap.questions.find((q) => q.text === "Downvote me")!;
a2.send({ type: "vote", id: dq.id, dir: -1 });
ok(await a2.until(() => a2.errors.includes("Downvotes are turned off")), "downvotes blocked until host allows them");
host.send({ type: "setSettings", settings: { allowDownvotes: true } });
await a2.until(() => a2.snap.meta.settings.allowDownvotes);
a2.send({ type: "vote", id: dq.id, dir: -1 });
ok(await host.until(() => host.snap.questions.find((q) => q.id === dq.id)?.downs === 1), "downvote counted");
ok(await a2.until(() => a2.state.me!.downs.includes(dq.id)), "own downvote remembered");
a2.send({ type: "vote", id: dq.id, dir: 1 });
ok(await host.until(() => { const q = host.snap.questions.find((x) => x.id === dq.id); return q?.downs === 0 && q?.votes === 1; }), "switching a downvote to an upvote");

// edit / withdraw own question
b.send({ type: "editQuestion", id: dq.id, text: "Edited question" });
ok(await host.until(() => host.snap.questions.find((q) => q.id === dq.id)?.text === "Edited question" && !!host.snap.questions.find((q) => q.id === dq.id)?.edited), "author can edit their question");
a2.send({ type: "editQuestion", id: dq.id, text: "hijack" });
ok(await a2.until(() => a2.errors.includes("You can only change your own questions")), "others can't edit it");
b.send({ type: "withdraw", id: dq.id });
ok(await a2.until(() => !a2.snap.questions.some((q) => q.id === dq.id)), "author can withdraw their question");

// reactions
a2.send({ type: "react", emoji: "🔥" });
a2.send({ type: "react", emoji: "🔥" });
b.send({ type: "react", emoji: "👏" });
ok(await pres.until(() => pres.reactions["🔥"] === 2 && pres.reactions["👏"] === 1), "reactions reach the big screen");
for (let i = 0; i < 30; i++) a2.send({ type: "react", emoji: "😂" });
await sleep(400);
ok((pres.reactions["😂"] ?? 0) <= 12, `reaction spam is limited (${pres.reactions["😂"]})`);
host.send({ type: "setSettings", settings: { reactions: false } });
await a2.until(() => !a2.snap.meta.settings.reactions);
const before = pres.reactions["👍"] ?? 0;
a2.send({ type: "react", emoji: "👍" });
await sleep(300);
ok((pres.reactions["👍"] ?? 0) === before, "reactions can be turned off");

// new poll types
host.send({ type: "savePoll", poll: { type: "ranking", title: "Rank these", options: ["Red", "Green", "Blue"], correct: [], multi: false } });
host.send({ type: "savePoll", poll: { type: "scale", title: "How likely?", options: [], correct: [], multi: false, range: { min: 0, max: 10, minLabel: "No way", maxLabel: "For sure" } } });
host.send({ type: "savePoll", poll: { type: "survey", title: "Feedback", options: [], correct: [], multi: false, items: [{ type: "rating", title: "Rate it", options: [] }, { type: "multiple", title: "Best part?", options: ["Talk", "Q&A"] }, { type: "open", title: "Anything else?", options: [] }] } });
ok(await host.until(() => host.snap.polls.length === 7), "ranking, scale and survey polls saved");
const rk = host.snap.polls.find((p) => p.type === "ranking")!;
const sc = host.snap.polls.find((p) => p.type === "scale")!;
const sv = host.snap.polls.find((p) => p.type === "survey")!;
ok(sc.range?.minLabel === "No way" && sc.range.max === 10, "scale keeps its range and labels");

host.send({ type: "activatePoll", pollId: rk.id });
await a2.until(() => a2.snap.meta.activePollId === rk.id);
a2.send({ type: "respond", pollId: rk.id, value: [2, 0, 1] });
b.send({ type: "respond", pollId: rk.id, value: [2, 1, 0] });
b.send({ type: "respond", pollId: rk.id, value: [2, 2, 0] });
ok(await host.until(() => host.snap.results[rk.id]?.scores?.join() === "0.5,0.5,2"), `ranking scores (${host.snap.results[rk.id]?.scores})`);
ok(await b.until(() => b.errors.includes("Put every option in order")), "ranking needs a full order");

host.send({ type: "activatePoll", pollId: sc.id });
await a2.until(() => a2.snap.meta.activePollId === sc.id);
a2.send({ type: "respond", pollId: sc.id, value: 10 });
b.send({ type: "respond", pollId: sc.id, value: 7 });
ok(await host.until(() => host.snap.results[sc.id]?.avg === 8.5 && host.snap.results[sc.id]?.counts?.length === 11), "scale average and spread");

host.send({ type: "activatePoll", pollId: sv.id });
await a2.until(() => a2.snap.meta.activePollId === sv.id);
a2.send({ type: "respond", pollId: sv.id, value: [5, [1], "Loved it"] });
b.send({ type: "respond", pollId: sv.id, value: [3, null, null] });
ok(await host.until(() => { const r = host.snap.results[sv.id]; return r?.total === 2 && r.items?.[0].avg === 4 && r.items?.[1].total === 1 && r.items?.[2].answers?.[0] === "Loved it"; }), "survey results per question, skips allowed");

host.send({ type: "duplicatePoll", pollId: sv.id });
ok(await host.until(() => host.snap.polls.some((p) => p.title === "Feedback (copy)" && p.status === "draft" && p.items.length === 3)), "duplicate a poll");

// quiz with timer, points and leaderboard
host.send({ type: "join", name: "Host" } as never);
a2.send({ type: "join", name: "Ana" });
b.send({ type: "join", name: "Ben" });
host.send({ type: "savePoll", poll: { type: "quiz", title: "Capital of Canada?", options: ["Toronto", "Ottawa"], correct: [1], multi: false, timeLimit: 3 } });
await host.until(() => host.snap.polls.some((p) => p.title === "Capital of Canada?"));
const qz = host.snap.polls.find((p) => p.title === "Capital of Canada?")!;
ok(qz.timeLimit === 3, "quiz keeps its timer");
host.send({ type: "activatePoll", pollId: qz.id });
await a2.until(() => a2.snap.meta.activePollId === qz.id);
ok(!!a2.snap.polls[0].startedAt, "quiz start time sent for the countdown");
a2.send({ type: "respond", pollId: qz.id, value: [1] });
await sleep(1200);
b.send({ type: "respond", pollId: qz.id, value: [1] });
await host.until(() => host.snap.results[qz.id]?.total === 2);
ok(await pres.until(() => !!pres.snap.results[qz.id]?.hidden), "quiz results hidden on big screen until reveal");
a2.send({ type: "respond", pollId: qz.id, value: [0] });
ok(await a2.until(() => a2.errors.includes("You've already answered this one")), "quiz answers are locked in");
await sleep(3500);
const late = await Client.connect(ev.code, "attendee", "late1");
late.send({ type: "respond", pollId: qz.id, value: [1] });
ok(await late.until(() => late.errors.includes("Time's up!")), "late answers rejected after the timer");
late.close();
const roundsBefore = host.snap.leaderboard.rounds;
ok(roundsBefore === 1, "only the earlier revealed quiz counts so far");
host.send({ type: "revealAnswer", pollId: qz.id });
ok(await a2.until(() => a2.snap.leaderboard.rounds === roundsBefore + 1 && a2.snap.leaderboard.top.some((e) => e.name === "Ben")), "leaderboard updates after reveal");
ok(await a2.until(() => a2.state.me!.quiz?.last != null) && await b.until(() => b.state.me!.quiz?.last != null), "both players get points for this question");
const anaPts = a2.state.me!.quiz!.last!, benPts = b.state.me!.quiz!.last!;
ok(anaPts > benPts && benPts >= 500 && anaPts <= 1000, `faster answer scores more (${anaPts} vs ${benPts})`);
ok(a2.snap.leaderboard.top[0].name === "Ana" && a2.state.me!.quiz!.rank === 1, "attendee sees own rank (first)");
ok(await b.until(() => b.state.me!.quiz?.rank === 2), "second place knows their rank");
ok(await pres.until(() => pres.snap.polls[0]?.correct?.join() === "1" && !pres.snap.results[qz.id]?.hidden), "big screen shows answer and results after reveal");
host.send({ type: "setPresentMode", mode: "leaderboard" });
ok(await pres.until(() => pres.snap.meta.presentMode === "leaderboard"), "leaderboard mode on the big screen");

// excel export
const xr = await fetch(`${BASE}/api/events/${ev.code}/export?format=xlsx&key=${ev.hostKey}`);
const xbuf = new Uint8Array(await xr.arrayBuffer());
const { unzipSync, strFromU8 } = await import("fflate");
const xfiles = unzipSync(xbuf);
const wb = strFromU8(xfiles["xl/workbook.xml"]);
ok(xr.headers.get("content-type")?.includes("spreadsheetml") && wb.includes("Quiz leaderboard") && wb.includes("All answers"), "Excel export with all sheets");
const answersSheet = Object.entries(xfiles).filter(([n]) => n.startsWith("xl/worksheets/")).map(([, f]) => strFromU8(f)).join("");
ok(answersSheet.includes("Loved it") && answersSheet.includes("Ana"), "Excel export includes answers and names");
ok((await fetch(`${BASE}/api/events/${ev.code}/export?format=xlsx&key=nope`)).status === 403, "Excel export needs host key");

// images
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const up = await fetch(`${BASE}/api/events/${ev.code}/media?key=${ev.hostKey}`, { method: "POST", headers: { "content-type": "image/png" }, body: png });
const upJson = (await up.json()) as { id?: string };
ok(up.status === 201 && /^[a-z0-9]{12}$/.test(upJson.id ?? ""), "host can upload an image");
const got = await fetch(`${BASE}/api/events/${ev.code}/media/${upJson.id}`);
ok(got.status === 200 && got.headers.get("content-type") === "image/png" && (await got.arrayBuffer()).byteLength === png.length, "image can be viewed");
ok((await fetch(`${BASE}/api/events/${ev.code}/media?key=nope`, { method: "POST", headers: { "content-type": "image/png" }, body: png })).status === 403, "only the host can upload");
ok((await fetch(`${BASE}/api/events/${ev.code}/media?key=${ev.hostKey}`, { method: "POST", headers: { "content-type": "text/html" }, body: "<script>" })).status === 415, "non-images are refused");
host.send({ type: "savePoll", poll: { type: "multiple", title: "Pick a picture", options: ["", "Cat"], images: [upJson.id!, null], correct: [], multi: false } });
ok(await host.until(() => host.snap.polls.some((p) => p.title === "Pick a picture" && p.images[0] === upJson.id && p.options[0] === "Option 1")), "poll options keep their images");

// ===================== passcode + identity (fresh event) =====================
const ev2 = await createEvent("Locked event");
const h2 = await Client.connect(ev2.code, "host", "h2", ev2.hostKey);
h2.send({ type: "setPasscode", passcode: "  Tiger " });
h2.send({ type: "setSettings", settings: { identity: "email" } });
ok(await h2.until(() => h2.snap.meta.passcode === "tiger" && h2.snap.meta.settings.identity === "email"), "host sets passcode and email requirement");
const info2 = await (await fetch(`${BASE}/api/events/${ev2.code}`)).json();
ok(info2.passcode === true && info2.identity === "email" && !("hostKey" in info2), "event info says a passcode is needed (without revealing it)");
const noPass = await Client.connect(ev2.code, "attendee", "p1");
ok(noPass.closeCode === 4005, "joining without the passcode is refused");
const wrongPass = await Client.connect(ev2.code, "attendee", "p1", undefined, "lion");
ok(wrongPass.closeCode === 4005, "wrong passcode is refused");
const c1 = await Client.connect(ev2.code, "attendee", "p1", undefined, "TIGER");
ok(c1.state.role === "attendee" && c1.snap.meta.passcode === undefined, "right passcode works (any case), attendees never see it");
ok(c1.state.me!.joined === false, "attendee must enter details first");
c1.send({ type: "ask", text: "sneaky" });
ok(await c1.until(() => c1.errors.some((e) => e.includes("name and email"))), "can't take part before joining");
c1.send({ type: "join", name: "Cara", email: "not-an-email" });
ok(await c1.until(() => c1.errors.includes("Enter a valid email address")), "email is checked");
c1.send({ type: "join", name: "Cara", email: "cara@example.com" });
ok(await c1.until(() => c1.state.me!.joined && c1.state.me!.email === "cara@example.com"), "join with name and email");
c1.send({ type: "ask", text: "Now I can ask", name: "Someone else" });
ok(await h2.until(() => h2.snap.questions.some((q) => q.text === "Now I can ask" && q.name === "Cara")), "questions use the joined name");
const pv = await Client.connect(ev2.code, "present", "pv", ev2.hostKey);
ok(pv.state.role === "present", "big screen with host key skips the passcode");
h2.send({ type: "setSettings", settings: { theme: "forest", screen: "dark" } });
ok(await pv.until(() => pv.snap.meta.settings.theme === "forest" && pv.snap.meta.settings.screen === "dark"), "theme and big-screen look update live");
const x2 = new Uint8Array(await (await fetch(`${BASE}/api/events/${ev2.code}/export?format=xlsx&key=${ev2.hostKey}`)).arrayBuffer());
ok(strFromU8(unzipSync(x2)["xl/workbook.xml"]).includes("Participants") && Object.values(unzipSync(x2)).some((f) => strFromU8(f).includes("cara@example.com")), "participants sheet has emails");
for (const c of [h2, c1, pv, noPass, wrongPass]) c.close();

// export
const csv = await (await fetch(`${BASE}/api/events/${ev.code}/export?key=${ev.hostKey}`)).text();
ok(csv.includes("Will slides be posted?") && csv.includes("strategy") && csv.includes("Average") && csv.includes("Feedback"), "CSV export has questions and poll results");
ok((await fetch(`${BASE}/api/events/${ev.code}/export?key=bad`)).status === 403, "CSV export needs host key");
ok((await fetch(`${BASE}/api/events/ZZZZZZ`)).status === 404, "unknown code gives 404");
const info = await (await fetch(`${BASE}/api/events/${ev.code.toLowerCase()}`)).json();
ok(info.title === "Renamed session" && info.passcode === false, "event info lookup (case-insensitive code)");

for (const c of [host, a2, b, pres]) c.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
