// End-to-end tests for v1.0: slides and apps (PowerPoint add-in, Teams app, big-screen links, your own slides),
// trust pages and the health check.
import { strFromU8, unzipSync } from "fflate";
import { BASE, Client, createEvent, sleep } from "./client";

let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) fails++;
};

const ev = await createEvent("Apps");
const host = await Client.connect(ev.code, "host", "ap-h", ev.hostKey);
host.send({ type: "savePoll", poll: { type: "multiple", title: "Slide poll", options: ["A", "B"], correct: [], multi: false } });
await host.until(() => host.snap.polls.length === 1);
const poll = host.snap.polls[0];

// Poll list for the add-in
ok((await fetch(`${BASE}/api/events/${ev.code}/polls?key=nope`)).status === 403, "poll list needs the host key");
const list = await (await fetch(`${BASE}/api/events/${ev.code}/polls?key=${encodeURIComponent(ev.hostKey)}`)).json();
ok(list.title === "Apps" && list.polls[0].id === poll.id && list.polls[0].status === "draft", "poll list for the slide add-in");

// The big screen (host link) can start a poll, but nothing else
const screen = await Client.connect(ev.code, "present", "ap-s", ev.hostKey);
ok(screen.snap.polls.some((p) => p.id === poll.id), "big screen knows about draft polls (so a slide can start one)");
ok(!screen.snap.polls[0].correct, "big screen doesn't get quiz answers early");
screen.send({ type: "setTitle", title: "Hacked" });
screen.send({ type: "activatePoll", pollId: poll.id });
ok(await host.until(() => host.snap.meta.activePollId === poll.id), "big screen launched the slide's poll");
await sleep(200);
ok(host.snap.meta.title === "Apps", "big screen can't change anything else");
const att = await Client.connect(ev.code, "present", "ap-a"); // no key = attendee
att.send({ type: "activatePoll", pollId: null });
await sleep(300);
ok(host.snap.meta.activePollId === poll.id && !att.snap.polls.some((p) => p.status === "draft"), "without the host link the big screen can't launch polls or see drafts");

// Your own slides
host.send({ type: "setSettings", settings: { deckUrl: "https://docs.google.com/presentation/d/AbC123/edit" } });
ok(await host.until(() => host.snap.meta.settings.deckUrl === "https://docs.google.com/presentation/d/AbC123/embed?start=false&loop=false&rm=minimal"), "Google Slides link saved as an embed link");
host.send({ type: "setSettings", settings: { deckUrl: "http://example.com" } });
ok(await host.until(() => host.errors.includes("Paste a link that starts with https://")), "non-https slide links refused");
host.send({ type: "setSettings", settings: { deckUrl: null } });
ok(await host.until(() => host.snap.meta.settings.deckUrl === null), "slides removed");

// Install packages
const ppt = await fetch(`${BASE}/api/apps/powerpoint.xml`);
const xml = await ppt.text();
ok(ppt.status === 200 && xml.includes('xsi:type="ContentApp"') && xml.includes(`<SourceLocation DefaultValue="${BASE}/apps/powerpoint.html" />`) && /<Id>[0-9a-f-]{36}<\/Id>/.test(xml), "PowerPoint manifest points at this site");
ok((await (await fetch(`${BASE}/api/apps/powerpoint.xml`)).text()) === xml, "manifest ID is stable");
const zip = unzipSync(new Uint8Array(await (await fetch(`${BASE}/api/apps/teams.zip`)).arrayBuffer()));
const man = JSON.parse(strFromU8(zip["manifest.json"]));
ok(man.configurableTabs[0].configurationUrl === `${BASE}/apps/teams.html?setup=1` && man.validDomains[0] === new URL(BASE).host && zip["color.png"].length > 500 && zip["outline.png"].length > 100, "Teams package has manifest and both icons");
ok(man.configurableTabs[0].context.includes("meetingStage") && man.developer.privacyUrl === `${BASE}/privacy`, "Teams app works in meetings and links the privacy page");
for (const p of ["/apps/powerpoint.html", "/apps/teams.html", "/manifest.webmanifest", "/sw.js"]) ok((await fetch(`${BASE}${p}`)).status === 200, `${p} is served`);

// Trust pages and health
const health = await (await fetch(`${BASE}/api/health`)).json();
ok(health.ok === true && typeof health.version === "string", "health check");
for (const p of ["/privacy", "/terms", "/security", "/accessibility", "/status", "/help"]) ok((await fetch(`${BASE}${p}`)).status === 200, `${p} page loads`);

for (const c of [host, screen, att]) c.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
