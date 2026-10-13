// Team workspaces: shared events, people and roles, and analytics across events.
import { useEffect, useMemo, useState } from "preact/hooks";
import { DEFAULT_BRAND, type Brand, type EventStats, type WorkspaceDetail, type WorkspaceRole } from "../../shared/protocol";
import { postJson, useAccount } from "../lib/account";
import { lang, t, tj } from "../lib/i18n";
import { CFG, navigate, rememberHosted, toast, useTheme, useTitle } from "../lib/util";
import { BrandEditor } from "../components/brand";
import { Empty, Message, TopBar } from "../components/ui";

const ROLE_LABEL = (): Record<WorkspaceRole, string> => ({ owner: t("Owner"), editor: t("Editor"), viewer: t("Viewer") });
const ROLE_HINT = (): Record<WorkspaceRole, string> => ({
  owner: t("Everything, including people and settings"),
  editor: t("Make and host events"),
  viewer: t("See events, recaps and analytics"),
});

async function copy(text: string, msg: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    prompt(t("Copy this:"), text);
  }
}

async function call(url: string, body: unknown = {}, method = "POST") {
  const r = await postJson(url, body, method);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(t(d.error ?? "Something went wrong. Try again."));
  return d;
}

const day = (ts: number) => new Date(ts).toLocaleDateString(lang, { dateStyle: "medium" });

// ---------- one workspace ----------

type Tab = "events" | "people" | "insights" | "settings";

export function TeamPage({ id }: { id: string }) {
  useTheme("indigo");
  const acct = useAccount();
  const [ws, setWs] = useState<WorkspaceDetail | null | "gone">(null);
  const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1) as Tab) || "events");
  useTitle(ws && ws !== "gone" ? `${ws.name} · ${CFG.name}` : CFG.name);
  const load = () =>
    fetch(`/api/workspaces/${id}`)
      .then(async (r) => (r.ok ? setWs(await r.json()) : setWs("gone")))
      .catch(() => setWs("gone"));
  useEffect(() => {
    void load();
    if (new URLSearchParams(location.search).has("upgraded")) toast(t("Thanks! Your workspace is on Pro."));
  }, [id]);
  useEffect(() => {
    history.replaceState({}, "", `${location.pathname}#${tab}`);
  }, [tab]);

  if (!acct.loading && !acct.email) {
    queueMicrotask(() => navigate(`/signin?return=${encodeURIComponent(location.pathname)}`));
    return null;
  }
  if (ws === "gone") return <Message title={t("Workspace not found")}>{t("It may have been deleted, or you're no longer in it.")}</Message>;
  if (!ws) return <TopBar title={t("Loading…")} />;
  const owner = ws.role === "owner";
  const tabs: [Tab, string][] = [
    ["events", t("Events")],
    ["people", t("People")],
    ["insights", t("Insights")],
    ...(owner ? ([["settings", t("Settings")]] as [Tab, string][]) : []),
  ];

  return (
    <>
      <TopBar title={ws.name}>
        <a class="btn sm ghost" href="/events">
          {t("My events")}
        </a>
      </TopBar>
      <main class="wrap stack" style={{ maxWidth: 920 }}>
        <div class="spread">
          <p class="muted small">{tj("Your role: {role}", { role: <b>{ROLE_LABEL()[ws.role]}</b> })}</p>
        </div>
        <div class="tabs" role="tablist" aria-label={t("Workspace sections")}>
          {tabs.map(([k, l]) => (
            <button key={k} role="tab" class="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
        {tab === "events" && <TeamEvents ws={ws} reload={load} />}
        {tab === "people" && <TeamPeople ws={ws} me={acct.email ?? ""} reload={load} />}
        {tab === "insights" && <Trends src={`/api/workspaces/${ws.id}/analytics`} team={ws.id} />}
        {tab === "settings" && owner && <TeamSettings ws={ws} reload={load} />}
      </main>
    </>
  );
}

function TeamEvents({ ws, reload }: { ws: WorkspaceDetail; reload: () => void }) {
  const acct = useAccount();
  const canHost = ws.role !== "viewer";
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const inList = new Set(ws.events.map((e) => e.code));
  const mine = acct.events.filter((e) => !inList.has(e.code));
  const [pick, setPick] = useState("");

  const create = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await call("/api/events", { title, workspace: ws.id });
      rememberHosted({ code: d.code, key: d.hostKey, title: d.title, ts: Date.now() });
      navigate(`/host/${d.code}#${d.hostKey}`);
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  };
  const add = async () => {
    const ev = mine.find((x) => x.code === pick);
    if (!ev) return;
    try {
      await call(`/api/workspaces/${ws.id}/events`, { code: ev.code, key: ev.hostKey });
      setPick("");
      toast(t("Added to the workspace"));
      reload();
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const remove = async (code: string, title: string) => {
    if (!confirm(t("Take \"{title}\" off the workspace list? The event itself isn't deleted.", { title }))) return;
    await call(`/api/workspaces/${ws.id}/events/${code}`, {}, "DELETE").catch((e) => toast(e.message));
    reload();
  };

  return (
    <div class="stack">
      {canHost && (
        <form class="panel stack" onSubmit={create}>
          <h2>{t("New event in this workspace")}</h2>
          <div class="row" style={{ flexWrap: "nowrap" }}>
            <label class="sr-only" for="ws-title">
              {t("Event name")}
            </label>
            <input id="ws-title" class="input" maxLength={120} placeholder={t("Event name")} value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
            <button class="btn accent" disabled={busy}>
              {busy ? t("Creating…") : t("Create")}
            </button>
          </div>
          <p class="muted tiny">{t("It starts with the workspace's colours, and everyone here can see it.")}</p>
          {mine.length > 0 && (
            <div class="row">
              <label class="sr-only" for="ws-add">
                {t("Add one of your events")}
              </label>
              <select id="ws-add" class="input" style={{ flex: 1, minWidth: 0 }} value={pick} onChange={(e) => setPick(e.currentTarget.value)}>
                <option value="">{t("Add one of your events…")}</option>
                {mine.map((e) => (
                  <option key={e.code} value={e.code}>
                    {e.title} ({e.code})
                  </option>
                ))}
              </select>
              <button type="button" class="btn ghost" disabled={!pick} onClick={add}>
                {t("Add")}
              </button>
            </div>
          )}
        </form>
      )}
      {ws.events.length ? (
        <ul class="my-events">
          {ws.events.map((e) => (
            <li key={e.code} class="panel">
              <div class="grow" style={{ minWidth: 0 }}>
                <b class="my-title">{e.title}</b>
                <div class="muted small">
                  <span class="chip code">{e.code}</span> {t("Added {date} by {who}", { date: day(e.addedAt), who: e.addedBy })}
                </div>
              </div>
              <div class="row">
                {e.hostKey && (
                  <>
                    <a class="btn sm" href={`/host/${e.code}#${e.hostKey}`}>
                      {t("Open")}
                    </a>
                    <a class="btn sm ghost" href={`/present/${e.code}#${e.hostKey}`} target="_blank" rel="noopener">
                      {t("Big screen")}
                    </a>
                  </>
                )}
                <a class="btn sm ghost" href={`/teams/${ws.id}/analytics/${e.code}`}>
                  {t("Analytics")}
                </a>
                {canHost && (
                  <button class="btn sm quiet" onClick={() => remove(e.code, e.title)} aria-label={t("Remove {title} from the workspace", { title: e.title })}>
                    {t("Remove")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div class="panel">
          <Empty title={t("No events yet")}>{canHost ? t("Make one above. Everyone in the workspace will see it here.") : t("Events your team makes will show up here.")}</Empty>
        </div>
      )}
    </div>
  );
}

function TeamPeople({ ws, me, reload }: { ws: WorkspaceDetail; me: string; reload: () => void }) {
  const owner = ws.role === "owner";
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("editor");
  const [link, setLink] = useState<string | null>(null);
  const roles = ROLE_LABEL();
  const hints = ROLE_HINT();

  const invite = async (e: Event) => {
    e.preventDefault();
    try {
      const d = (await call(`/api/workspaces/${ws.id}/invites`, { email, role, lang })) as { sent: boolean; link: string };
      setLink(d.sent ? null : d.link);
      toast(d.sent ? t("Invite sent to {email}", { email }) : t("Invite ready. Send them the link."));
      setEmail("");
      reload();
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const act = (p: Promise<unknown>) => p.then(reload).catch((e) => toast((e as Error).message));
  const enc = encodeURIComponent;

  return (
    <div class="stack">
      {owner && (
        <form class="panel stack" onSubmit={invite}>
          <h2>{t("Invite someone")}</h2>
          <div class="invite-row">
            <label class="sr-only" for="inv-email">
              {t("Email")}
            </label>
            <input id="inv-email" class="input" type="email" required placeholder={t("name@company.com")} value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
            <label class="sr-only" for="inv-role">
              {t("Role")}
            </label>
            <select id="inv-role" class="input" value={role} onChange={(e) => setRole(e.currentTarget.value as WorkspaceRole)}>
              {(["editor", "viewer", "owner"] as const).map((r) => (
                <option key={r} value={r}>
                  {roles[r]}
                </option>
              ))}
            </select>
            <button class="btn accent">{t("Invite")}</button>
          </div>
          <p class="muted tiny">{hints[role]}</p>
          {link && (
            <div class="notice small stack-sm">
              <span>{t("Email isn't set up on this server, so send them this link yourself. It works once, for their email address, for 7 days.")}</span>
              <div class="row" style={{ flexWrap: "nowrap" }}>
                <input class="input" readOnly value={link} aria-label={t("Invite link")} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" class="btn sm" onClick={() => copy(link, t("Invite link copied"))}>
                  {t("Copy")}
                </button>
              </div>
            </div>
          )}
        </form>
      )}
      <section class="panel stack">
        <h2>{t("People")}</h2>
        <ul class="people-list">
          {ws.members.map((m) => (
            <li key={m.email}>
              <span class="grow" style={{ minWidth: 0 }}>
                <b class="ellipsis">{m.email}</b>
                {m.email === me && <span class="muted small"> ({t("you")})</span>}
              </span>
              {owner ? (
                <select class="input sm" aria-label={t("Role for {email}", { email: m.email })} value={m.role} onChange={(e) => act(call(`/api/workspaces/${ws.id}/members/${enc(m.email)}`, { role: e.currentTarget.value }))}>
                  {(["owner", "editor", "viewer"] as const).map((r) => (
                    <option key={r} value={r}>
                      {roles[r]}
                    </option>
                  ))}
                </select>
              ) : (
                <span class="chip">{roles[m.role]}</span>
              )}
              {(owner || m.email === me) && (
                <button
                  class="btn sm quiet"
                  onClick={() => {
                    const self = m.email === me;
                    if (!confirm(self ? t("Leave this workspace?") : t("Remove {email} from the workspace?", { email: m.email }))) return;
                    call(`/api/workspaces/${ws.id}/members/${enc(m.email)}`, {}, "DELETE")
                      .then(() => (self ? navigate("/events") : reload()))
                      .catch((e) => toast((e as Error).message));
                  }}
                >
                  {m.email === me ? t("Leave") : t("Remove")}
                </button>
              )}
            </li>
          ))}
        </ul>
        {owner && ws.invites.length > 0 && (
          <>
            <h3>{t("Waiting for them to join")}</h3>
            <ul class="people-list">
              {ws.invites.map((i) => (
                <li key={i.email}>
                  <span class="grow ellipsis">{i.email}</span>
                  <span class="chip">{roles[i.role]}</span>
                  <span class="muted tiny">{t("until {date}", { date: day(i.expires) })}</span>
                  <button class="btn sm quiet" onClick={() => act(call(`/api/workspaces/${ws.id}/invites/${enc(i.email)}`, {}, "DELETE"))}>
                    {t("Cancel")}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <dl class="role-help muted tiny">
          {(["owner", "editor", "viewer"] as const).map((r) => (
            <div key={r}>
              <dt>{roles[r]}</dt>
              <dd>{hints[r]}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function TeamSettings({ ws, reload }: { ws: WorkspaceDetail; reload: () => void }) {
  const [name, setName] = useState(ws.name);
  const [brand, setBrand] = useState<Brand>(ws.brand ?? DEFAULT_BRAND);
  const save = async (patch: { name?: string; brand?: Brand }) => {
    try {
      const d = await call(`/api/workspaces/${ws.id}`, patch);
      if (d.brand) setBrand(d.brand);
      toast(t("Saved"));
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <div class="stack">
      <form
        class="panel stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save({ name });
        }}
      >
        <h2>{t("Workspace name")}</h2>
        <div class="row" style={{ flexWrap: "nowrap" }}>
          <label class="sr-only" for="ws-name">
            {t("Workspace name")}
          </label>
          <input id="ws-name" class="input" maxLength={60} value={name} onInput={(e) => setName(e.currentTarget.value)} />
          <button class="btn">{t("Save")}</button>
        </div>
      </form>
      <section class="panel stack">
        <h2>{t("Look for new events")}</h2>
        <p class="muted small">{t("Events made in this workspace start with these colours. Hosts can still change them per event.")}</p>
        <BrandEditor brand={brand} onChange={(b) => void save({ brand: { ...brand, ...b } })} />
      </section>
      {ws.billing && <PlanBox ws={ws} />}
      <section class="panel stack danger-zone">
        <h2>{t("Delete workspace")}</h2>
        <p class="muted small">{t("Removes the workspace and its member list. The events themselves keep working with their host links.")}</p>
        <button
          class="btn danger"
          onClick={() => {
            if (prompt(t("Type the workspace name to delete it: {name}", { name: ws.name }))?.trim() !== ws.name) return;
            call(`/api/workspaces/${ws.id}`, {}, "DELETE")
              .then(() => navigate("/events"))
              .catch((e) => toast((e as Error).message));
          }}
        >
          {t("Delete workspace…")}
        </button>
      </section>
    </div>
  );
}

function PlanBox({ ws }: { ws: WorkspaceDetail }) {
  const [busy, setBusy] = useState(false);
  const pro = ws.plan === "pro";
  const lim = (n: number) => (n ? t("up to {n} people at once per event", { n: n.toLocaleString(lang) }) : t("no limit on people per event"));
  const go = async (what: "checkout" | "portal") => {
    setBusy(true);
    try {
      const d = await call(`/api/workspaces/${ws.id}/billing/${what}`);
      location.assign(d.url);
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <section class="panel stack">
      <h2>{t("Plan")}</h2>
      <p>{tj("This workspace is on the {plan} plan: {limit}.", { plan: <b>{pro ? t("Pro") : t("Free")}</b>, limit: lim(pro ? ws.limits?.pro ?? 0 : ws.limits?.free ?? 0) })}</p>
      {!pro && ws.limits && <p class="muted small">{t("Pro: {limit}.", { limit: lim(ws.limits.pro) })}</p>}
      <div class="row">
        {!pro && (
          <button class="btn accent" disabled={busy} onClick={() => go("checkout")}>
            {t("Upgrade to Pro")}
          </button>
        )}
        <button class="btn ghost" disabled={busy} onClick={() => go("portal")}>
          {t("Manage billing")}
        </button>
      </div>
    </section>
  );
}

// ---------- accepting an invite ----------

export function JoinTeam() {
  useTheme("indigo");
  useTitle(t("Join a workspace · {name}", { name: CFG.name }));
  const acct = useAccount();
  const params = new URLSearchParams(location.search);
  const w = params.get("w") ?? "";
  const tok = params.get("t") ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!/^[0-9a-f]{16}$/.test(w) || !tok) return <Message title={t("This invite link isn't complete")}>{t("Ask for a new invite.")}</Message>;
  if (acct.loading) return <TopBar title={t("Loading…")} />;
  const here = `/join-team?w=${w}&t=${tok}`;
  const join = async () => {
    setBusy(true);
    setError("");
    try {
      const d = await call(`/api/workspaces/${w}/join`, { t: tok });
      await acct.refresh();
      toast(t("You joined {name}", { name: d.name }));
      navigate(`/teams/${w}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <TopBar />
      <main class="gate">
        <div class="panel stack">
          <h1>{t("Join a team workspace")}</h1>
          {acct.email ? (
            <>
              <p>{tj("You're signed in as {email}. The invite must be for this address.", { email: <b>{acct.email}</b> })}</p>
              {error && (
                <p class="notice bad small" role="alert">
                  {error}
                </p>
              )}
              <button class="btn accent lg block" disabled={busy} onClick={join}>
                {busy ? t("Joining…") : t("Join the workspace")}
              </button>
            </>
          ) : (
            <>
              <p class="muted">{t("Sign in with the email address the invite was sent to. Then you'll come back here.")}</p>
              <a class="btn accent lg block" href={`/signin?return=${encodeURIComponent(here)}`}>
                {t("Sign in")}
              </a>
            </>
          )}
        </div>
      </main>
    </>
  );
}

// ---------- analytics across events ----------

/** Your own events over time (all the events in your account). */
export function Insights() {
  useTheme("indigo");
  useTitle(t("Insights · {name}", { name: CFG.name }));
  const acct = useAccount();
  if (!acct.loading && !acct.email) {
    queueMicrotask(() => navigate(`/signin?return=/insights`));
    return null;
  }
  return (
    <>
      <TopBar title={t("Insights")}>
        <a class="btn sm ghost" href="/events">
          {t("My events")}
        </a>
      </TopBar>
      <main class="wrap stack" style={{ maxWidth: 920 }}>
        <p class="muted">{t("How your events compare over time.")}</p>
        <Trends src="/api/me/analytics" />
      </main>
    </>
  );
}

type Metric = "participants" | "questions" | "votes" | "answers";

export function Trends({ src, team }: { src: string; team?: string }) {
  const [rows, setRows] = useState<EventStats[] | null>(null);
  const [metric, setMetric] = useState<Metric>("participants");
  useEffect(() => {
    fetch(src)
      .then((r) => r.json())
      .then((d) => setRows(d.events ?? []))
      .catch(() => setRows([]));
  }, [src]);
  const labels: Record<Metric, string> = { participants: t("People"), questions: t("Questions"), votes: t("Upvotes"), answers: t("Poll answers") };
  const totals = useMemo(() => {
    const r = rows ?? [];
    const sum = (k: keyof EventStats) => r.reduce((n, x) => n + (x[k] as number), 0);
    return { events: r.length, people: sum("participants"), questions: sum("questions"), answers: sum("answers") };
  }, [rows]);
  if (!rows) return <p class="muted">{t("Loading…")}</p>;
  if (!rows.length)
    return (
      <div class="panel">
        <Empty title={t("Nothing to compare yet")}>{t("Once you've run a few events, you'll see how they compare here.")}</Empty>
      </div>
    );
  const max = Math.max(1, ...rows.map((r) => r[metric]));
  const avg = (n: number) => (totals.events ? Math.round(n / totals.events) : 0);
  const csv = () => {
    const head = ["Date", "Code", "Title", "People", "Most online", "Questions", "Upvotes", "Polls", "Poll answers", "Reactions"];
    const q = (v: string | number) => (typeof v === "number" ? String(v) : `"${v.replace(/"/g, '""')}"`);
    const body = rows.map((r) => [new Date(r.createdAt).toISOString().slice(0, 10), r.code, r.title, r.participants, r.peakOnline, r.questions, r.votes, r.polls, r.answers, r.reactions].map(q).join(","));
    const url = URL.createObjectURL(new Blob([[head.join(","), ...body].join("\n")], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "rslide-insights.csv" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div class="stack">
      <section class="stats-row">
        <div class="stat">
          <b>{totals.events}</b>
          <span>{t("events")}</span>
        </div>
        <div class="stat">
          <b>{totals.people.toLocaleString(lang)}</b>
          <span>{t("people in total, {n} per event on average", { n: avg(totals.people) })}</span>
        </div>
        <div class="stat">
          <b>{totals.questions.toLocaleString(lang)}</b>
          <span>{t("questions, {n} per event on average", { n: avg(totals.questions) })}</span>
        </div>
        <div class="stat">
          <b>{totals.answers.toLocaleString(lang)}</b>
          <span>{t("poll answers, {n} per event on average", { n: avg(totals.answers) })}</span>
        </div>
      </section>
      {rows.length < 2 ? (
        <p class="muted small">{t("Run one more event to see how they compare over time.")}</p>
      ) : (
      <section class="panel stack">
        <div class="spread">
          <h2>{t("Event by event")}</h2>
          <div class="seg" role="group" aria-label={t("What to compare")}>
            {(Object.keys(labels) as Metric[]).map((m) => (
              <button key={m} aria-pressed={metric === m} onClick={() => setMetric(m)}>
                {labels[m]}
              </button>
            ))}
          </div>
        </div>
        <ol class="trend-bars" aria-label={t("{what} per event, oldest first", { what: labels[metric] })}>
          {rows.map((r) => (
            <li key={r.code} title={`${r.title} · ${day(r.createdAt)} · ${r[metric]}`}>
              <span class="trend-val num">{r[metric].toLocaleString(lang)}</span>
              <i style={{ height: `${Math.max(2, (r[metric] / max) * 100)}%` }} aria-hidden="true" />
              <span class="trend-lbl">{new Date(r.createdAt).toLocaleDateString(lang, { month: "short", day: "numeric" })}</span>
              <span class="sr-only">{r.title}</span>
            </li>
          ))}
        </ol>
      </section>
      )}
      <section class="panel stack">
        <div class="spread">
          <h2>{t("All events")}</h2>
          <button class="btn sm ghost" onClick={csv}>
            {t("Download CSV")}
          </button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">{t("Event")}</th>
                <th scope="col">{t("Date")}</th>
                <th scope="col" class="num">{t("People")}</th>
                <th scope="col" class="num">{t("Questions")}</th>
                <th scope="col" class="num">{t("Upvotes")}</th>
                <th scope="col" class="num">{t("Poll answers")}</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.code}>
                  <th scope="row">{team ? <a href={`/teams/${team}/analytics/${r.code}`}>{r.title}</a> : r.title}</th>
                  <td>{day(r.createdAt)}</td>
                  <td class="num">{r.participants}</td>
                  <td class="num">{r.questions}</td>
                  <td class="num">{r.votes}</td>
                  <td class="num">{r.answers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
