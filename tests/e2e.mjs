const B = process.env.BASE_URL || "http://127.0.0.1:8787";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };

const ev = await (await fetch(B + "/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Test <script>" }) })).json();
ok(ev.code?.length === 6 && ev.hostKey, "create event " + ev.code);

function client(role, pid, key) {
  const qs = new URLSearchParams({ role, pid, ...(key ? { key } : {}) });
  const ws = new WebSocket(`${B.replace(/^http/, "ws")}/api/events/${ev.code}/ws?${qs}`);
  const c = { ws, state: null, errors: [], send: (m) => ws.send(JSON.stringify(m)) };
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "state") c.state = m.state; if (m.type === "error") c.errors.push(m.message); };
  return new Promise((r) => (ws.onopen = () => r(c)));
}
const host = await client("host", "h1", ev.hostKey);
const a = await client("attendee", "a1");
const b = await client("attendee", "a2");
const pres = await client("present", "p1");
await sleep(300);

// wrong host key -> 403
const badOk = await new Promise((r) => { const w = new WebSocket(`${B.replace(/^http/, "ws")}/api/events/${ev.code}/ws?role=host&key=nope`); w.onopen = () => r(false); w.onerror = () => r(true); });
ok(badOk, "wrong host key rejected");

a.send({ type: "ask", text: "What is the exam format?", name: "Sam" });
b.send({ type: "ask", text: "Will slides be posted?" });
await sleep(300);
ok(host.state.questions.length === 2 && b.state.questions.length === 2, "questions broadcast live");
const q1 = a.state.questions.find((q) => q.text.startsWith("What"));
b.send({ type: "vote", id: q1.id }); host.send({ type: "vote", id: q1.id });
await sleep(300);
ok(a.state.questions.find((q) => q.id === q1.id).votes === 2, "upvotes counted");
b.send({ type: "vote", id: q1.id }); await sleep(200);
ok(a.state.questions.find((q) => q.id === q1.id).votes === 1, "un-vote works");

// moderation
host.send({ type: "setSettings", settings: { moderation: true } }); await sleep(200);
a.send({ type: "ask", text: "Hidden until approved" }); await sleep(300);
const pend = host.state.questions.find((q) => q.status === "pending");
ok(pend && !b.state.questions.some((q) => q.text === "Hidden until approved"), "moderation hides from others");
ok(a.state.questions.some((q) => q.status === "pending" && q.mine), "author sees own pending");
host.send({ type: "approve", id: pend.id }); await sleep(200);
ok(b.state.questions.some((q) => q.text === "Hidden until approved"), "approve publishes");
host.send({ type: "highlight", id: q1.id }); host.send({ type: "answer", id: pend.id }); await sleep(200);
ok(pres.state.questions.find((q) => q.id === q1.id).highlighted, "highlight reaches big screen");
// attendee can't do host actions
a.send({ type: "deleteQuestion", id: q1.id }); await sleep(200);
ok(host.state.questions.some((q) => q.id === q1.id), "attendee cannot delete");

// polls
host.send({ type: "savePoll", poll: { type: "multiple", title: "Best case?", options: ["A", "B", "C"] } });
host.send({ type: "savePoll", poll: { type: "quiz", title: "2+2?", options: ["3", "4"], correct: [1] } });
host.send({ type: "savePoll", poll: { type: "wordcloud", title: "One word" } });
host.send({ type: "savePoll", poll: { type: "rating", title: "Rate today" } });
await sleep(300);
ok(host.state.polls.length === 4 && a.state.polls.length === 0, "draft polls hidden from audience");
const [mc, quiz, wc, rt] = host.state.polls;
host.send({ type: "activatePoll", pollId: mc.id }); await sleep(200);
ok(a.state.polls[0]?.id === mc.id, "launched poll reaches audience");
a.send({ type: "respond", pollId: mc.id, value: [1] }); b.send({ type: "respond", pollId: mc.id, value: [1] });
b.send({ type: "respond", pollId: mc.id, value: [0, 2] }); await sleep(300);
ok(b.errors.includes("Pick one option"), "single-choice enforced");
ok(JSON.stringify(host.state.polls[0].results.counts) === "[0,2,0]", "mc results " + JSON.stringify(host.state.polls[0].results.counts));
host.send({ type: "toggleResults", pollId: mc.id }); await sleep(200);
ok(a.state.polls[0].results.counts === undefined && pres.state.polls[0].results.counts, "hide results from audience, still on screen");

host.send({ type: "activatePoll", pollId: quiz.id }); await sleep(200);
ok(host.state.polls[0].status === "closed", "launching another closes previous");
a.send({ type: "respond", pollId: quiz.id, value: [1] }); await sleep(200);
ok(a.state.polls[0].correct === undefined, "quiz answer hidden before reveal");
host.send({ type: "revealAnswer", pollId: quiz.id }); await sleep(200);
ok(JSON.stringify(a.state.polls[0].correct) === "[1]", "quiz reveal");

host.send({ type: "activatePoll", pollId: wc.id }); await sleep(200);
a.send({ type: "respond", pollId: wc.id, value: ["Strategy"] }); b.send({ type: "respond", pollId: wc.id, value: ["strategy"] }); await sleep(300);
ok(host.state.polls[2].results.words[0][0] === "strategy" && host.state.polls[2].results.words[0][1] === 2, "word cloud merges case");

host.send({ type: "activatePoll", pollId: rt.id }); await sleep(200);
a.send({ type: "respond", pollId: rt.id, value: 4 }); b.send({ type: "respond", pollId: rt.id, value: 5 }); await sleep(300);
ok(host.state.polls[3].results.avg === 4.5, "rating avg");

// closed Q&A
host.send({ type: "setSettings", settings: { qaOpen: false } }); await sleep(200);
a.send({ type: "ask", text: "late" }); await sleep(200);
ok(a.errors.some((e) => e.includes("closed")), "closed Q&A blocks asks");

// persistence: reconnect fresh client
const c = await client("attendee", "a1"); await sleep(300);
ok(c.state.polls[0]?.myResponse === 4, "state survives reconnect");

const csv = await (await fetch(`${B}/api/events/${ev.code}/export?key=${ev.hostKey}`)).text();
ok(csv.includes("What is the exam format?") && csv.includes("strategy"), "CSV export");
ok((await fetch(`${B}/api/events/${ev.code}/export?key=bad`)).status === 403, "CSV export needs key");
ok((await fetch(`${B}/api/events/ZZZZZZ`)).status === 404, "unknown code 404");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
console.log("HOST:", `${B}/host/${ev.code}#${ev.hostKey}`);
process.exit(fails ? 1 : 0);
