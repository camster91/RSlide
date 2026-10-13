// End-to-end tests for v0.8: the read-only API and webhooks.
// Start the app first (`npm run preview`), then run `npm run test:e2e`.
// Webhook delivery tests need WEBHOOK_ALLOW_PRIVATE="1" in .dev.vars (CI sets it), because
// the test receiver runs on this machine. Without it they're skipped (and fail in CI).
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { BASE, Client, createEvent, sleep } from "./client";

let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) fails++;
};
const api = async (path: string, key?: string, init: RequestInit = {}) => {
  const r = await fetch(`${BASE}/api/v1/events${path}`, { ...init, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(init.headers ?? {}) } });
  return { status: r.status, headers: r.headers, data: (await r.json().catch(() => null)) as any };
};

// ----- a local webhook receiver -----
type Delivery = { headers: Record<string, string>; body: string; json: any };
const got: Delivery[] = [];
let fail = false;
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    got.push({ headers: req.headers as Record<string, string>, body, json: JSON.parse(body) });
    res.writeHead(fail ? 500 : 200).end("ok");
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const hookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
const events = () => got.flatMap((d) => d.json.events as { type: string; data: any }[]);

const ev = await createEvent("API test");
const host = await Client.connect(ev.code, "host", "h1", ev.hostKey);
const a = await Client.connect(ev.code, "attendee", "a1");
const mod = await Client.connect(ev.code, "mod", "m1", host.snap.meta.modKey!);

// ----- API keys -----
ok(host.snap.meta.api?.key === null && a.snap.meta.api === undefined && mod.snap.meta.api === undefined, "API is off by default and only the host sees its setup");
ok((await api(`/${ev.code}`)).status === 401, "no key: 401");
ok((await api(`/${ev.code}`, "rs_wrong")).status === 403, "wrong key: 403");
ok((await api(`/${ev.code}`, ev.hostKey)).status === 200, "the host key works too");
ok((await api(`/NOPE99`, "x")).status === 404, "unknown event: 404");
mod.send({ type: "setApiKey", on: true });
await sleep(200);
ok(host.snap.meta.api?.key === null, "moderators can't turn the API on");
host.send({ type: "setApiKey", on: true });
ok(await host.until(() => !!host.snap.meta.api?.key), "host turns the API on");
const key = host.snap.meta.api!.key!;
ok(/^rs_[0-9a-f]{48}$/.test(key), "API key looks right");

const info = await api(`/${ev.code}`, key);
ok(info.status === 200 && info.data.title === "API test" && info.data.counts.questions === 0, "event info");
ok(info.headers.get("access-control-allow-origin") === "*", "API allows calls from other websites (CORS)");
ok((await fetch(`${BASE}/api/v1/events/${ev.code}`, { method: "OPTIONS" })).status === 204, "CORS preflight");
ok((await api(`/${ev.code}/questions`, key, { method: "POST" })).status === 405, "API is read-only");
ok((await api(`/${ev.code}?key=${key}`)).status === 200, "?key= works for quick tests");

// ----- webhooks -----
host.send({ type: "setWebhook", url: "https://localhost/x", events: [] });
const refused = await host.until(() => host.errors.some((e) => e.includes("private")), 1500);
host.send({ type: "setWebhook", url: hookUrl, events: ["question.created", "question.updated", "question.deleted", "reply.created", "poll.launched", "poll.closed", "poll.revealed", "response.created"] });
const localAllowed = await host.until(() => host.snap.meta.api?.webhook?.url === hookUrl, 1500);
if (!localAllowed) {
  console.log("SKIP webhook delivery tests: add WEBHOOK_ALLOW_PRIVATE=\"1\" to .dev.vars to run them");
  ok(refused, "local addresses are refused unless allowed");
  if (process.env.CI) ok(false, "CI must run webhook delivery tests");
} else {
  const secret = host.snap.meta.api!.webhook!.secret;
  ok(/^[0-9a-f]{48}$/.test(secret), "webhook gets a signing secret");

  host.send({ type: "testWebhook" });
  ok(await until(() => events().some((e) => e.type === "ping")), "test delivery arrives");
  const first = got[0];
  const sig = "sha256=" + createHmac("sha256", secret).update(`${first.headers["x-rslide-timestamp"]}.${first.body}`).digest("hex");
  ok(first.headers["x-rslide-signature"] === sig, "delivery is signed with the secret");
  ok(first.headers["x-rslide-event"] === ev.code && first.json.event === ev.code, "delivery names the event");
  ok(await host.until(() => host.snap.meta.api?.webhook?.last?.ok === true), "host sees the last delivery worked");

  // Questions
  a.send({ type: "ask", text: "What's the roadmap?", name: "Ann" });
  ok(await until(() => events().some((e) => e.type === "question.created" && e.data.question.text === "What's the roadmap?")), "question.created");
  const qid = events().find((e) => e.type === "question.created")!.data.question.id;
  host.send({ type: "answer", id: qid });
  ok(await until(() => events().some((e) => e.type === "question.updated" && e.data.question.status === "answered")), "question.updated when answered");
  host.send({ type: "reply", id: qid, text: "Coming soon" });
  ok(await until(() => events().some((e) => e.type === "reply.created" && e.data.reply.official && e.data.questionId === qid)), "reply.created");

  // Polls
  host.send({ type: "savePoll", poll: { type: "quiz", title: "Pick B", options: ["A", "B"], correct: [1], multi: false, timeLimit: 0 } });
  host.send({ type: "savePoll", poll: { type: "multiple", title: "Lunch?", options: ["Pizza", "Sushi"], correct: [], multi: false } });
  await host.until(() => host.snap.polls.length === 2);
  const [quiz, lunch] = host.snap.polls;
  host.send({ type: "activatePoll", pollId: quiz.id });
  ok(await until(() => events().some((e) => e.type === "poll.launched" && e.data.poll.id === quiz.id)), "poll.launched");
  await a.until(() => a.snap.meta.activePollId === quiz.id);
  a.send({ type: "respond", pollId: quiz.id, value: [1] });
  ok(await until(() => events().some((e) => e.type === "response.created" && e.data.pollId === quiz.id && e.data.name === "Ann")), "response.created");
  host.send({ type: "revealAnswer", pollId: quiz.id });
  ok(await until(() => events().some((e) => e.type === "poll.revealed" && e.data.results.counts.join() === "0,1")), "poll.revealed with results");
  host.send({ type: "activatePoll", pollId: lunch.id });
  ok(await until(() => events().some((e) => e.type === "poll.closed" && e.data.poll.id === quiz.id)), "poll.closed for the previous poll");

  // Batching: a burst arrives in few deliveries
  const before = got.length;
  for (let i = 0; i < 4; i++) host.send({ type: "highlight", id: qid });
  await sleep(1800);
  const burst = got.slice(before).flatMap((d) => d.json.events).filter((e: any) => e.type === "question.updated").length;
  ok(burst === 4 && got.length - before <= 2, `events are grouped (${burst} events in ${got.length - before} deliveries)`);

  host.send({ type: "deleteQuestion", id: qid });
  ok(await until(() => events().some((e) => e.type === "question.deleted" && e.data.id === qid)), "question.deleted");

  // Failures are shown to the host and retried once
  fail = true;
  const n = got.length;
  host.send({ type: "testWebhook" });
  ok(await host.until(() => host.snap.meta.api?.webhook?.last?.ok === false && host.snap.meta.api.webhook.last.status === 500, 4000), "host sees a failed delivery");
  ok(await until(() => got.length >= n + 2, 9000), "failed delivery is retried");
  fail = false;

  // Only chosen events are sent
  host.send({ type: "setWebhook", url: hookUrl, events: ["poll.launched"] });
  await host.until(() => host.snap.meta.api?.webhook?.events.length === 1);
  const m = got.length;
  a.send({ type: "ask", text: "Not sent", name: "Ann" });
  await sleep(1500);
  ok(!got.slice(m).some((d) => d.json.events.some((e: any) => e.type === "question.created")), "events that aren't picked aren't sent");

  host.send({ type: "removeWebhook" });
  ok(await host.until(() => host.snap.meta.api?.webhook === null), "host can remove the webhook");
}

// ----- reading data -----
const qs = await api(`/${ev.code}/questions`, key);
ok(qs.status === 200 && Array.isArray(qs.data.questions), "list questions");
ok((await api(`/${ev.code}/questions?status=answered`, key)).data.questions.every((q: any) => q.status === "answered"), "filter questions by status");
const polls = await api(`/${ev.code}/polls`, key);
ok(polls.data.polls.length === (localAllowed ? 2 : 0) && polls.data.polls.every((p: any) => "results" in p), "list polls with results");
if (localAllowed) {
  const one = await api(`/${ev.code}/polls/${polls.data.polls[0].id}?responses=1`, key);
  ok(one.data.poll.correct.join() === "1" && one.data.responses[0].name === "Ann", "one poll with every answer");
  ok((await api(`/${ev.code}/polls/nope`, key)).status === 404, "unknown poll: 404");
  const lb = await api(`/${ev.code}/leaderboard`, key);
  ok(lb.data.rounds === 1 && lb.data.players[0].name === "Ann" && lb.data.players[0].points > 0, "leaderboard");
}
const ppl = await api(`/${ev.code}/participants`, key);
ok(ppl.status === 200 && Array.isArray(ppl.data.participants), "participants");

// ----- turning the API off -----
host.send({ type: "setApiKey", on: true });
ok(await host.until(() => host.snap.meta.api?.key !== key), "make a new key");
ok((await api(`/${ev.code}`, key)).status === 403, "old key stops working");
host.send({ type: "setApiKey", on: false });
ok(await host.until(() => host.snap.meta.api?.key === null), "turn the API off");

for (const x of [host, a, mod]) x.close();
server.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

async function until(check: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(50);
  }
  return check();
}
