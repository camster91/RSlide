// End-to-end tests for v0.7: quiz teams.
// Start the app first (`npm run preview`), then run `npm run test:e2e`.
import { strFromU8, unzipSync } from "fflate";
import { BASE, Client, createEvent, sleep } from "./client";

let fails = 0;
const ok = (cond: unknown, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${msg}`);
  if (!cond) fails++;
};

const ev = await createEvent("Team quiz");
const host = await Client.connect(ev.code, "host", "h1", ev.hostKey);
const players = await Promise.all(["a1", "a2", "a3", "a4", "a5"].map((p) => Client.connect(ev.code, "attendee", p)));
const [a, b, c, d, e] = players;
const mod = await Client.connect(ev.code, "mod", "m1", host.snap.meta.modKey!);

ok(a.snap.meta.teams.length === 0 && a.state.me!.team === null, "no teams by default");
a.send({ type: "joinTeam", team: "auto" });
ok(await a.until(() => a.errors.includes("This event doesn't have teams")), "can't join a team when there are none");

// ----- set up teams -----
a.send({ type: "setTeams", teams: [{ name: "Hack", color: "red" }] });
mod.send({ type: "setTeams", teams: [{ name: "Hack", color: "red" }] });
await sleep(250);
ok(host.snap.meta.teams.length === 0, "only the host can set teams");
host.send({ type: "setTeams", teams: [{ name: "Owls", color: "blue" }, { name: "Foxes", color: "amber" }, { name: "owls", color: "red" }, { name: "", color: "red" }] });
ok(await a.until(() => a.snap.meta.teams.length === 2), "attendees see the teams");
const [owls, foxes] = host.snap.meta.teams;
ok(owls.name === "Owls" && foxes.name === "Foxes" && foxes.color === "amber", "teams are cleaned (no empty or duplicate names)");

// ----- joining -----
a.send({ type: "joinTeam", team: owls.id });
ok(await a.until(() => a.state.me!.team === owls.id), "pick a team");
b.send({ type: "joinTeam", team: "auto" });
ok(await b.until(() => b.state.me!.team === foxes.id), "'Pick for me' joins the smallest team");
c.send({ type: "joinTeam", team: "auto" });
await c.until(() => c.state.me!.team !== null);
d.send({ type: "joinTeam", team: "auto" });
await d.until(() => d.state.me!.team !== null);
const sizes = [owls.id, foxes.id].map((id) => [a, b, c, d].filter((p) => p.state.me!.team === id).length);
ok(sizes[0] === 2 && sizes[1] === 2, `auto-pick keeps teams balanced (${sizes.join(" vs ")})`);
e.send({ type: "joinTeam", team: "nope" });
ok(await e.until(() => e.errors.includes("That team doesn't exist any more")), "unknown team refused");
ok(await host.until(() => host.snap.leaderboard.teams?.reduce((n, x) => n + x.members, 0) === 4), "team member counts are shared");

// ----- quiz -----
host.send({ type: "savePoll", poll: { type: "quiz", title: "2 + 2?", options: ["3", "4"], correct: [1], multi: false, timeLimit: 0 } });
await host.until(() => host.snap.polls.length === 1);
const q1 = host.snap.polls[0];
host.send({ type: "activatePoll", pollId: q1.id });
await e.until(() => e.snap.meta.activePollId === q1.id);
e.send({ type: "respond", pollId: q1.id, value: [1] });
ok(await e.until(() => e.errors.includes("Pick a team first")), "people without a team must pick one before a quiz");
// Owls: a right, c?  Foxes: b right, d wrong.
for (const p of [a, b, c, d]) {
  const right = p !== d;
  p.send({ type: "respond", pollId: q1.id, value: [right ? 1 : 0] });
}
ok(await host.until(() => host.snap.results[q1.id]?.total === 4), "team players answer");
a.send({ type: "joinTeam", team: foxes.id });
ok(await a.until(() => a.errors.includes("You've already played for your team")), "team is locked after playing");

host.send({ type: "revealAnswer", pollId: q1.id });
ok(await host.until(() => (host.snap.leaderboard.teams?.[0]?.points ?? 0) > 0), "team scores after the reveal");
const board = host.snap.leaderboard.teams!;
const owlTeam = board.find((x) => x.id === owls.id)!;
const foxTeam = board.find((x) => x.id === foxes.id)!;
const team = (p: Client) => p.state.me!.team;
const expected = (id: string) => [a, b, c, d].filter((p) => team(p) === id && p !== d).length * 1000;
ok(owlTeam.points === expected(owls.id) && foxTeam.points === expected(foxes.id), `team totals add up (${owlTeam.points} / ${foxTeam.points})`);
ok(board[0].avg >= board[1].avg, "teams are ranked by average");
ok(host.snap.leaderboard.top.every((x) => x.team === owls.id || x.team === foxes.id), "players on the board show their team");
ok(await e.until(() => e.snap.leaderboard.teams?.length === 2), "attendees see the team board");

// ----- removing a team -----
host.send({ type: "setTeams", teams: [{ id: owls.id, name: "Owls", color: "blue" }] });
const foxPlayers = [a, b, c, d].filter((p) => team(p) === foxes.id);
ok(await foxPlayers[0].until(() => foxPlayers[0].state.me!.team === null), "people on a removed team go back to none");
ok(await host.until(() => host.snap.leaderboard.teams?.length === 1), "removed team leaves the board");

// ----- export and copy -----
const xlsx = await fetch(`${BASE}/api/events/${ev.code}/export?format=xlsx&key=${ev.hostKey}`);
const buf = new Uint8Array(await xlsx.arrayBuffer());
const files = unzipSync(buf);
ok(xlsx.status === 200 && strFromU8(files["xl/workbook.xml"]).includes("Team leaderboard"), "Excel export has a team leaderboard sheet");
const copy = await fetch(`${BASE}/api/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: { code: ev.code, key: ev.hostKey } }) });
const cd = (await copy.json()) as { code: string; hostKey: string };
const ch = await Client.connect(cd.code, "host", "c1", cd.hostKey);
ok(ch.snap.meta.teams.map((x) => x.name).join() === "Owls", "copying an event keeps its teams");
ch.close();

for (const x of [host, mod, ...players]) x.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
