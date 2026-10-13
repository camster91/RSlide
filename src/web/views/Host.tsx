import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  ITEM_TYPES,
  LABEL_COLORS,
  MAIN_ROOM,
  THEMES,
  type ClientMsg,
  type ItemDraft,
  type ItemType,
  type Label,
  type LabelColor,
  type Meta,
  type Poll,
  type PollDraft,
  type PollType,
  type Question,
  type Room,
  type Settings,
  type ApiSetup,
  type WebhookEvent,
  WEBHOOK_EVENTS,
  type ThemeName,
} from "../../shared/protocol";
import { resultsOf, sortQuestions } from "../../shared/store";
import { TEMPLATES } from "../../shared/templates";
import { parsePolls, type PasteResult } from "../../shared/paste";
import { saveToAccount } from "../lib/account";
import { useRoom, type Send } from "../lib/room";
import { CFG, joinUrl, mediaUrl, navigate, plural, rememberHosted, store, toast, uploadImage, useTheme, useTitle } from "../lib/util";
import { t, tj } from "../lib/i18n";
import { Board, ConnProblem, Countdown, Empty, Icon, LabelChip, Podium, QrCode, TeamBoard, QuestionMeta, Replies, ResultsView, TopBar, TYPE_HINT, TYPE_LABEL, VoteCount, whenText } from "../components/ui";

type QTab = "live" | "pending" | "answered" | "archived";
const Q_TABS: [QTab, string][] = [
  ["live", t("Live")],
  ["pending", t("To review")],
  ["answered", t("Answered||tab")],
  ["archived", t("Archived||tab")],
];
const EMPTY_TEXT: Record<QTab, [string, string]> = {
  live: [t("No questions yet"), t("Share the code so people can start asking.")],
  pending: [t("Nothing to review"), t("New questions wait here until you approve them.")],
  answered: [t("Nothing answered yet"), t("Mark questions answered as you go.")],
  archived: [t("Nothing archived"), t("Archive questions to hide them from everyone.")],
};
const THEME_SWATCH: Record<ThemeName, [string, string, string]> = {
  indigo: ["#3b3fd8", "#ffb21a", t("Indigo")],
  ocean: ["#0b6e99", "#ff9f1c", t("Ocean")],
  forest: ["#1f7a4d", "#e9b949", t("Forest")],
  berry: ["#b1245f", "#ffb21a", t("Berry")],
  mono: ["#24242e", "#ffd400", t("Mono")],
  contrast: ["#0000b3", "#ffe600", t("High contrast")],
};
type ModAction = "approve" | "answer" | "archive" | "highlight" | "deleteQuestion";

const copy = (txt: string, msg: string) =>
  navigator.clipboard?.writeText(txt).then(
    () => toast(msg),
    () => prompt(t("Copy this link:"), txt),
  );

/** The host console. With `moderator`, only the Q&A tools are shown. */
export function Host({ code, moderator = false }: { code: string; moderator?: boolean }) {
  const key = decodeURIComponent(location.hash.slice(1));
  const [reactions, setReactions] = useState(0);
  const { state, status, send } = useRoom(code, moderator ? "mod" : "host", {
    key,
    onReactions: (c) => setReactions((n) => n + Object.values(c).reduce((a, b) => a + (b ?? 0), 0)),
  });
  const [qTab, setQTab] = useState<QTab>("live");
  const [roomFilter, setRoomFilter] = useState<string>("all");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<PollDraft | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [templates, setTemplates] = useState<false | AddTab>(false);
  const [remote, setRemote] = useState(false);
  const [recap, setRecap] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const s = state.snapshot;
  useTitle(s ? (moderator ? t("Moderate: {title}", { title: s.meta.title }) : t("Host: {title}", { title: s.meta.title })) : CFG.name);
  useTheme(s?.meta.settings.theme);
  useEffect(() => {
    if (s && !moderator) {
      rememberHosted({ code, key, title: s.meta.title, ts: Date.now() });
      void saveToAccount({ code, key });
    }
  }, [!!s]);

  if (!key || status === "forbidden") return <ConnProblem status="forbidden" code={code} />;
  if (status === "not-found") return <ConnProblem status={status} code={code} />;

  const meta = s?.meta;
  const rooms = meta?.rooms ?? [];
  const labels = meta?.labels ?? [];
  const inFilter = (q: Question) => (roomFilter === "all" || q.room === roomFilter) && (!labelFilter || q.labels.includes(labelFilter));
  const by: Record<QTab, Question[]> = { live: [], pending: [], answered: [], archived: [] };
  s?.questions.filter(inFilter).forEach((q) => by[q.status].push(q));
  const showReview = !!s && (s.meta.settings.moderation || s.meta.settings.profanity === "review" || by.pending.length > 0);
  const tab = qTab === "pending" && !showReview ? "live" : qTab;
  const list = sortQuestions(by[tab], "popular");
  const byId = new Map((s?.questions ?? []).map((q) => [q.id, q]));
  const act = (type: ModAction, id: string) => {
    if (type === "deleteQuestion" && !confirm(t("Delete this question for everyone?"))) return;
    send({ type, id });
  };
  const settings = meta?.settings;

  const qaPanel = (
    <section class="panel stack">
      <div class="section-title">
        <h2>{t("Q&A")}</h2>
        {settings && !moderator && (
          <label class="check small">
            <input type="checkbox" checked={settings.qaOpen} onChange={(e) => send({ type: "setSettings", settings: { qaOpen: e.currentTarget.checked } })} />
            {t("Taking questions")}
          </label>
        )}
      </div>
      {settings?.qaOpensAt && !settings.qaOpen && <p class="notice">{t("Opens by itself at {time}.", { time: whenText(settings.qaOpensAt) })}</p>}
      {settings?.qaClosesAt && settings.qaOpen && <p class="notice">{t("Closes by itself at {time}.", { time: whenText(settings.qaClosesAt) })}</p>}
      {rooms.length > 1 && (
        <div class="room-tabs" role="group" aria-label={t("Filter by room")}>
          <button aria-pressed={roomFilter === "all"} onClick={() => setRoomFilter("all")}>
            {t("All rooms")}
          </button>
          {rooms.map((r) => (
            <button key={r.id} aria-pressed={roomFilter === r.id} onClick={() => setRoomFilter(r.id)}>
              {r.name}
            </button>
          ))}
        </div>
      )}
      {labels.length > 0 && (
        <div class="filters" role="group" aria-label={t("Filter by label")}>
          <span class="muted small">{t("Label:")}</span>
          {labels.map((l) => (
            <LabelChip key={l.id} label={l} on={labelFilter === l.id ? true : labelFilter ? false : undefined} onClick={() => setLabelFilter(labelFilter === l.id ? null : l.id)} />
          ))}
        </div>
      )}
      <div class="tabs" role="tablist">
        {Q_TABS.filter(([k]) => k !== "pending" || showReview).map(([k, label]) => (
          <button key={k} class="tab" role="tab" aria-selected={tab === k} onClick={() => setQTab(k)}>
            {label}
            {by[k].length > 0 && <span class={`count ${k === "pending" ? "hot" : ""}`}>{by[k].length}</span>}
          </button>
        ))}
      </div>
      {list.length ? (
        <div class="q-list">
          {list.map((q) => (
            <HostQuestion key={q.id} q={q} act={act} send={send} labels={labels} rooms={rooms} original={q.dupOf ? byId.get(q.dupOf) : undefined} />
          ))}
        </div>
      ) : (
        <Empty title={s ? EMPTY_TEXT[tab][0] : t("Connecting…")}>{s ? EMPTY_TEXT[tab][1] : null}</Empty>
      )}
    </section>
  );

  if (moderator)
    return (
      <>
        <TopBar title={s ? t("Moderating: {title}", { title: s.meta.title }) : t("Connecting…")} logo={settings?.logo} code={code}>
          <span class="chip">
            <span class={`dot ${status === "online" ? "" : "off"}`} />
            {tj("{n} online", { n: <span class="num">{s?.online ?? 0}</span> })}
          </span>
        </TopBar>
        <main class="wrap stack" style={{ maxWidth: 820 }}>
          <p class="muted small">{t("You're a moderator. You can approve, label, reply to and highlight questions.")}</p>
          {qaPanel}
        </main>
      </>
    );

  return (
    <>
      <TopBar title={s?.meta.title} logo={settings?.logo} code={code}>
        <span class="chip" title={t("Attendees connected now")}>
          <span class={`dot ${status === "online" ? "" : "off"}`} />
          {tj("{n} online", { n: <span class="num">{s?.online ?? 0}</span> })}
        </span>
        <ExportMenu code={code} hostKey={key} onRecap={() => setRecap(true)} />
        <button class="btn sm ghost" onClick={() => setDrawer(true)} aria-label={t("Event settings")}>
          <Icon.gear /> {t("Settings")}
        </button>
        <button class="btn sm ghost" onClick={() => setRemote(true)} title={t("Control polls and questions from your phone")}>
          <Icon.phone /> {t("Remote")}
        </button>
        <a class="btn sm accent" href={`/present/${code}#${key}`} target="_blank" rel="noopener">
          {t("Open big screen")}
        </a>
      </TopBar>

      <main class="wrap wide stack">
        <input
          class="title-input"
          maxLength={120}
          aria-label={t("Event name")}
          value={titleDraft ?? s?.meta.title ?? ""}
          onInput={(e) => setTitleDraft(e.currentTarget.value)}
          onBlur={() => {
            if (titleDraft !== null && titleDraft.trim() && titleDraft !== s?.meta.title) send({ type: "setTitle", title: titleDraft });
            setTitleDraft(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />

        <div class="join-strip">
          <span>
            {tj("Join at {host} with code", { host: <b>{location.host}</b> })}
          </span>
          <span class="code">{code}</span>
          {meta?.passcode && (
            <span class="chip" style={{ background: "rgba(255,255,255,.18)", color: "inherit" }}>
              {t("Passcode: {passcode}", { passcode: meta.passcode })}
            </span>
          )}
          <span class="grow" />
          <button class="btn sm ghost" onClick={() => copy(joinUrl(code), t("Join link copied"))}>
            {t("Copy join link")}
          </button>
          <button class="btn sm ghost" onClick={() => copy(location.href, t("Host link copied. Keep it private."))}>
            {t("Copy host link")}
          </button>
        </div>

        <div class="grid-host">
          {qaPanel}

          <section class="stack">
            <div class="panel stack">
              <div class="section-title">
                <h2>{t("Polls")}</h2>
                <button class="btn sm ghost" onClick={() => setTemplates("paste")} title={t("Paste a list of questions and turn them into polls")}>
                  {t("Paste")}
                </button>
                <button class="btn sm ghost" onClick={() => setTemplates("templates")}>
                  {t("Templates")}
                </button>
                <button class="btn sm" onClick={() => setEditing(newDraft("multiple"))}>
                  {t("New poll")}
                </button>
              </div>
              {editing && (
                <PollEditor
                  key={editing.id ?? "new"}
                  code={code}
                  hostKey={key}
                  draft={editing}
                  onCancel={() => setEditing(null)}
                  onSave={(poll) => {
                    send({ type: "savePoll", poll });
                    setEditing(null);
                  }}
                />
              )}
              {s && s.polls.length ? (
                <div>
                  {s.polls.map((p, i) => (
                    <HostPoll
                      key={p.id}
                      code={code}
                      poll={p}
                      first={i === 0}
                      last={i === s.polls.length - 1}
                      results={resultsOf(s, p.id)}
                      clockOffset={state.clockOffset}
                      send={send}
                      onEdit={() => setEditing(toDraft(p))}
                    />
                  ))}
                </div>
              ) : (
                !editing && (
                  <Empty title={t("No polls yet")}>
                    {tj("Make a few before you start, or {template} or {paste}.", {
                      template: (
                        <button class="link-btn" onClick={() => setTemplates("templates")}>
                          {t("start from a template")}
                        </button>
                      ),
                      paste: (
                        <button class="link-btn" onClick={() => setTemplates("paste")}>
                          {t("paste your questions")}
                        </button>
                      ),
                    })}
                  </Empty>
                )
              )}
            </div>

            {s && s.leaderboard.rounds > 0 && (
              <div class="panel stack">
                <div class="section-title">
                  <h2>{t("Quiz leaderboard")}</h2>
                  <button
                    class={`btn sm ${s.meta.presentMode === "leaderboard" ? "on" : "ghost"}`}
                    onClick={() => send({ type: "setPresentMode", mode: s.meta.presentMode === "leaderboard" ? "auto" : "leaderboard" })}
                  >
                    {s.meta.presentMode === "leaderboard" ? t("On big screen") : t("Show on big screen")}
                  </button>
                </div>
                {s.leaderboard.teams && s.leaderboard.teams.length > 0 && <TeamBoard teams={s.leaderboard.teams} />}
                <Podium board={s.leaderboard} />
                <Board board={s.leaderboard} from={3} teams={s.meta.teams} />
              </div>
            )}

            {settings?.reactions && (
              <p class="muted small" style={{ textAlign: "center" }}>
                {reactions ? t("{reactions} since you opened this page", { reactions: plural(reactions, "reaction") }) : t("Reactions are on. They float up the big screen.")}
              </p>
            )}
          </section>
        </div>
      </main>

      {drawer && meta && <SettingsDrawer code={code} hostKey={key} meta={meta} send={send} onClose={() => setDrawer(false)} />}
      {remote && <RemoteModal code={code} hostKey={key} onClose={() => setRemote(false)} />}
      {recap && meta && <RecapModal code={code} hostKey={key} meta={meta} send={send} onClose={() => setRecap(false)} />}
      {templates && (
        <AddPolls
          tab={templates}
          code={code}
          hostKey={key}
          ai={!!meta?.ai}
          onClose={() => setTemplates(false)}
          onPick={(polls) => {
            send({ type: "importPolls", polls });
            setTemplates(false);
            toast(polls.length === 1 ? t("Added 1 poll") : t("Added {n} polls", { n: polls.length }));
          }}
        />
      )}
    </>
  );
}

// ---------- export ----------

function ExportMenu({ code, hostKey, onRecap }: { code: string; hostKey: string; onRecap: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  const k = encodeURIComponent(hostKey);
  const duplicate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: { code, key: hostKey } }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      rememberHosted({ code: d.code, key: d.hostKey, title: d.title, ts: Date.now() });
      toast(t("Copy made. You're now in the new event."));
      navigate(`/host/${d.code}#${d.hostKey}`);
    } catch (e) {
      toast((e as Error).message || t("Couldn't copy the event"));
    }
    setBusy(false);
    setOpen(false);
  };
  return (
    <div class="menu" ref={ref}>
      <button class="btn sm ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t("Results")}
      </button>
      {open && (
        <div class="menu-list" role="menu">
          <a role="menuitem" href={`/analytics/${code}#${hostKey}`} target="_blank" rel="noopener">
            {t("Analytics")}
          </a>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onRecap();
            }}
          >
            {t("Recap page to share with attendees")}
          </button>
          <a role="menuitem" href={`/report/${code}#${hostKey}`} target="_blank" rel="noopener">
            {t("Report to print or save as PDF")}
          </a>
          <a role="menuitem" href={`/api/events/${code}/export?format=xlsx&key=${k}`} download>
            {t("Download Excel (.xlsx)")}
          </a>
          <a role="menuitem" href={`/api/events/${code}/export?key=${k}`} download>
            {t("Download CSV")}
          </a>
          <button role="menuitem" onClick={duplicate} disabled={busy}>
            {busy ? t("Copying…") : t("Copy this event (polls and settings)")}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- recap ----------

function RecapModal({ code, hostKey, meta, send, onClose }: { code: string; hostKey: string; meta: Meta; send: Send; onClose: () => void }) {
  const [summary, setSummary] = useState(meta.recapSummary ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  const url = `${location.origin}/recap/${code}`;
  const saved = summary.trim() === (meta.recapSummary ?? "");
  const write = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/events/${code}/ai/summary?key=${encodeURIComponent(hostKey)}`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSummary(d.summary);
      toast(t("Draft written. Check it, then save."));
    } catch (e) {
      toast((e as Error).message || t("The AI didn't answer. Try again."));
    }
    setBusy(false);
  };
  return (
    <>
      <div class="drawer-backdrop" onClick={onClose} />
      <div class="modal recap-modal" role="dialog" aria-modal="true" aria-label={t("Recap page")}>
        <div class="spread">
          <h2>{t("Recap page")}</h2>
          <button class="btn sm quiet" onClick={onClose} aria-label={t("Close")}>
            <Icon.x />
          </button>
        </div>
        <p class="muted small">
          {t("A page attendees can open after the event: your summary, the top questions with your replies, and poll results they could already see. Pending and archived questions are left out.")}
        </p>
        <label class="toggle">
          <span>
            {t("Share the recap")}
            <span class="muted small" style={{ display: "block" }}>
              {t("Anyone with the link can see it. Attendees also get a link in the event.")}
            </span>
          </span>
          <input type="checkbox" checked={meta.recapPublic} onChange={(e) => send({ type: "setRecap", public: e.currentTarget.checked })} />
        </label>
        {meta.recapPublic && (
          <div class="mod-link">
            <input class="input" readOnly value={url} aria-label={t("Recap link")} onFocus={(e) => e.currentTarget.select()} />
            <button class="btn sm" onClick={() => copy(url, t("Recap link copied"))}>
              {t("Copy")}
            </button>
            <a class="btn sm ghost" href={url} target="_blank" rel="noopener">
              {t("Open")}
            </a>
          </div>
        )}
        <label class="label" for="recap-summary">
          {t("Summary")}
        </label>
        <textarea
          id="recap-summary"
          class="input"
          rows={7}
          maxLength={2000}
          placeholder={t("A few lines about what came up. Leave empty to skip it.")}
          value={summary}
          onInput={(e) => setSummary(e.currentTarget.value)}
        />
        <div class="row">
          <button class="btn sm" disabled={saved} onClick={() => send({ type: "setRecap", summary })}>
            {saved ? t("Saved") : t("Save summary")}
          </button>
          {meta.ai && (
            <button class="btn sm ghost" disabled={busy} onClick={write} title={t("Uses Workers AI on your Cloudflare account")}>
              {busy ? t("Writing…") : summary ? t("Rewrite with AI") : t("Write it with AI")}
            </button>
          )}
        </div>
        {meta.ai && <p class="muted tiny">{t("AI drafts are never shared until you save them.")}</p>}
      </div>
    </>
  );
}

// ---------- phone remote ----------

function RemoteModal({ code, hostKey, onClose }: { code: string; hostKey: string; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  const url = `${location.origin}/remote/${code}#${hostKey}`;
  return (
    <>
      <div class="drawer-backdrop" onClick={onClose} />
      <div class="modal remote-modal" role="dialog" aria-modal="true" aria-label={t("Phone remote")}>
        <div class="spread">
          <h2>{t("Control from your phone")}</h2>
          <button class="btn sm quiet" onClick={onClose} aria-label={t("Close")}>
            <Icon.x />
          </button>
        </div>
        <p class="muted small">{t("Scan with your phone camera. Move through polls, show results and put questions on the big screen while you're on stage.")}</p>
        <QrCode url={url} />
        <div class="row">
          <button class="btn sm" onClick={() => copy(url, t("Remote link copied. Keep it private."))}>
            {t("Copy remote link")}
          </button>
          <a class="btn sm ghost" href={url} target="_blank" rel="noopener">
            {t("Open here")}
          </a>
        </div>
        <p class="notice small">{t("This link has full host control. Only share it with people you trust.")}</p>
      </div>
    </>
  );
}

// ---------- templates ----------

type AddTab = "templates" | "paste";

const PASTE_EXAMPLE = t("Which launch excites you most?\n- New dashboard\n- Mobile app\n- AI assistant\n\nWhat is 2 + 2?\n- 3\n- 4 *\n\nHow clear is our roadmap? (rating)\n\nOne word for this quarter");

function AddPolls({ tab: firstTab, code, hostKey, ai, onClose, onPick }: {
  tab: AddTab;
  code: string;
  hostKey: string;
  ai: boolean;
  onClose: () => void;
  onPick: (polls: PollDraft[]) => void;
}) {
  const [tab, setTab] = useState<AddTab>(firstTab);
  const [text, setText] = useState(() => store.get(`rs.paste.${code}`, ""));
  const [aiResult, setAiResult] = useState<PasteResult | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  useEffect(() => store.set(`rs.paste.${code}`, text), [text]);
  const parsed = useMemo(() => parsePolls(text), [text]);
  const result = aiResult ?? parsed;
  const askAi = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/events/${code}/ai/polls?key=${encodeURIComponent(hostKey)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setAiResult(d as PasteResult);
    } catch (e) {
      toast((e as Error).message || t("The AI didn't answer. Try again."));
    }
    setBusy(false);
  };
  return (
    <>
      <div class="drawer-backdrop" onClick={onClose} />
      <div class="modal" role="dialog" aria-modal="true" aria-label={t("Add polls")}>
        <div class="spread">
          <h2>{t("Add polls")}</h2>
          <button class="btn sm quiet" onClick={onClose} aria-label={t("Close")}>
            <Icon.x />
          </button>
        </div>
        <div class="tabs" role="tablist" style={{ marginTop: 12 }}>
          <button class="tab" role="tab" aria-selected={tab === "paste"} onClick={() => setTab("paste")}>
            {t("Paste your questions")}
          </button>
          <button class="tab" role="tab" aria-selected={tab === "templates"} onClick={() => setTab("templates")}>
            {t("Templates")}
          </button>
        </div>
        {tab === "templates" ? (
          <>
            <p class="muted small" style={{ marginTop: 12 }}>{t("The polls are added to the end of your list. You can edit them before you launch.")}</p>
            <div class="tpl-grid">
              {TEMPLATES.map((t) => (
                <button key={t.id} class="tpl" onClick={() => onPick(t.polls)}>
                  <b>{t.name}</b>
                  <small>{t.description}</small>
                  <span class="count">{plural(t.polls.length, "poll")}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div class="paste">
            <div class="stack-sm">
              <label class="label" for="paste" style={{ marginTop: 12 }}>
                {tj("One question per block. Put options on the lines below, and a {star} after the right answer for a quiz.", { star: <b>*</b> })}
              </label>
              <textarea
                id="paste"
                class="input paste-input"
                placeholder={PASTE_EXAMPLE}
                value={text}
                onInput={(e) => {
                  setText(e.currentTarget.value);
                  setAiResult(null);
                }}
              />
              <p class="muted tiny">
                {t("Hints in brackets set the type: (rating), (scale), (word cloud), (open), (ranking), (pick several).")}
              </p>
              {ai && (
                <button class="btn sm ghost" disabled={busy || text.trim().length < 10} onClick={askAi} title={t("Uses Workers AI on your Cloudflare account")}>
                  {busy ? t("Thinking…") : t("Messy notes? Let AI write the polls")}
                </button>
              )}
            </div>
            <div class="paste-preview" aria-live="polite">
              <p class="label" style={{ marginTop: 12 }}>
                {aiResult ? t("AI suggestions") : t("Preview")}
                {result.polls.length > 0 && <span class="muted"> · {plural(result.polls.length, "poll")}</span>}
              </p>
              {result.polls.length ? (
                <ol class="paste-list">
                  {result.polls.map((p, i) => (
                    <li key={i}>
                      <span class="tag archived">{TYPE_LABEL[p.type]}</span>
                      <b>{p.title}</b>
                      {p.options.length > 0 && (
                        <span class="muted small">
                          {p.options.map((o, j) => (
                            <span key={j} class={p.correct.includes(j) && p.type === "quiz" ? "paste-correct" : undefined}>
                              {j ? " · " : ""}
                              {o}
                            </span>
                          ))}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p class="muted small">{t("Your polls will show up here as you type.")}</p>
              )}
              {result.notes.map((n, i) => (
                <p key={i} class="notice small" style={{ marginTop: 6 }}>
                  {n}
                </p>
              ))}
              <div class="row" style={{ marginTop: 12 }}>
                <button class="btn" disabled={!result.polls.length} onClick={() => onPick(result.polls)}>
                  {result.polls.length ? t("Add {polls}", { polls: plural(result.polls.length, "poll") }) : t("Add polls")}
                </button>
                {aiResult && (
                  <button class="btn quiet" onClick={() => setAiResult(null)}>
                    {t("Back to my text")}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

const COLOR_NAMES: Record<LabelColor, string> = { blue: t("Blue"), green: t("Green"), amber: t("Amber"), red: t("Red"), purple: t("Purple"), grey: t("Grey") };

// ---------- settings ----------

type ToggleKey = "qaOpen" | "moderation" | "allowAnonymous" | "allowDownvotes" | "reactions" | "audienceReplies" | "hideNames" | "aiAssist";
function SettingToggle({ k, label, hint, settings, set }: { k: ToggleKey; label: string; hint?: string; settings: Settings; set: (p: Partial<Settings>) => void }) {
  return (
    <label class="toggle">
      <span>
        {label}
        {hint && (
          <span class="muted small" style={{ display: "block" }}>
            {hint}
          </span>
        )}
      </span>
      <input type="checkbox" checked={settings[k]} onChange={(e) => set({ [k]: e.currentTarget.checked })} />
    </label>
  );
}

/** `datetime-local` works in local time, without seconds. */
const toLocalInput = (ts: number | null) => {
  if (!ts) return "";
  const d = new Date(ts);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).getTime() : null);

function SettingsDrawer({ code, hostKey, meta, send, onClose }: { code: string; hostKey: string; meta: Meta; send: Send; onClose: () => void }) {
  const settings = meta.settings;
  const [pass, setPass] = useState(meta.passcode ?? "");
  const [words, setWords] = useState(settings.blockedWords.join(", "));
  const [uploading, setUploading] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Settings>) => send({ type: "setSettings", settings: patch });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  const Toggle = (p: { k: ToggleKey; label: string; hint?: string }) => <SettingToggle {...p} settings={settings} set={set} />;
  const modUrl = `${location.origin}/mod/${code}#${meta.modKey ?? ""}`;
  const overlayUrl = `${location.origin}/present/${code}?overlay=1#${hostKey}`;
  const embedCode = `<div data-rslide="${code}"></div>\n<script src="${location.origin}/embed.js" async></script>`;
  const deleteIn = (days: number | null) => set({ deleteAt: days ? Date.now() + days * 86_400_000 : null });

  return (
    <>
      <div class="drawer-backdrop" onClick={onClose} />
      <div class="drawer" role="dialog" aria-modal="true" aria-label={t("Event settings")}>
        <div class="spread">
          <h2>{t("Settings")}</h2>
          <button class="btn sm quiet" onClick={onClose} aria-label={t("Close settings")}>
            <Icon.x />
          </button>
        </div>

        <h3>{t("Questions")}</h3>
        {Toggle({ k: "qaOpen", label: t("Taking questions") })}
        {Toggle({ k: "moderation", label: t("Review questions first"), hint: t("New questions stay hidden until you approve them.") })}
        {Toggle({ k: "allowAnonymous", label: t("Allow anonymous questions") })}
        {Toggle({ k: "allowDownvotes", label: t("Allow downvotes") })}
        {Toggle({ k: "audienceReplies", label: t("Let attendees reply"), hint: t("You and your moderators can always reply.") })}
        {Toggle({ k: "hideNames", label: t("Hide names from the audience"), hint: t("Only you and moderators see who asked.") })}
        <p class="muted tiny" style={{ marginTop: 6 }}>
          {t("Repeated questions are spotted for you, so you can merge them. This runs on the server and nothing is sent elsewhere.")}
        </p>
        {meta.ai ? (
          Toggle({ k: "aiAssist", label: t("AI help for repeats"), hint: t("Also catches repeats worded differently, or in another language. Uses Workers AI on your Cloudflare account.") })
        ) : (
          <p class="muted tiny">{t("AI help is not set up on this server. See the README to turn it on.")}</p>
        )}

        <p class="label">{t("Open and close questions automatically")}</p>
        <div class="row">
          <label class="small grow">
            {t("Opens")}
            <input
              class="input"
              type="datetime-local"
              value={toLocalInput(settings.qaOpensAt)}
              onChange={(e) => {
                const t = fromLocalInput(e.currentTarget.value);
                set(t && t > Date.now() ? { qaOpensAt: t, qaOpen: false } : { qaOpensAt: null });
              }}
            />
          </label>
          <label class="small grow">
            {t("Closes")}
            <input class="input" type="datetime-local" value={toLocalInput(settings.qaClosesAt)} onChange={(e) => set({ qaClosesAt: fromLocalInput(e.currentTarget.value) })} />
          </label>
        </div>
        <p class="muted tiny" style={{ marginTop: 6 }}>
          {t("Leave empty to open and close by hand.")}
        </p>

        <h3>{t("Word filter")}</h3>
        <div class="seg" role="group" aria-label={t("Word filter")}>
          {(
            [
              ["off", t("Off")],
              ["mask", t("Hide bad words")],
              ["review", t("Send to review")],
            ] as const
          ).map(([v, l]) => (
            <button key={v} aria-pressed={settings.profanity === v} onClick={() => set({ profanity: v })}>
              {l}
            </button>
          ))}
        </div>
        <p class="muted tiny" style={{ marginTop: 6 }}>
          {settings.profanity === "review" ? t("Questions with filtered words wait for your review. The audience sees them with the words hidden.") : t("Covers common swear words, plus your own list.")}
        </p>
        {settings.profanity !== "off" && (
          <form
            class="stack-sm"
            style={{ marginTop: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              set({ blockedWords: words.split(/[\n,]/) as unknown as string[] });
              toast(t("Word list saved"));
            }}
          >
            <label class="label" for="bw" style={{ marginTop: 0 }}>
              {t("Your own words to filter")}
            </label>
            <textarea id="bw" class="input" placeholder={t("e.g. competitor names, spoilers")} value={words} onInput={(e) => setWords(e.currentTarget.value)} />
            <button class="btn sm">{t("Save words")}</button>
          </form>
        )}

        <h3>{t("Labels")}</h3>
        <p class="muted tiny">{t("Tag questions to sort them, e.g. by topic. Everyone sees the labels.")}</p>
        <LabelsEditor labels={meta.labels} onSave={(labels) => send({ type: "setLabels", labels })} />

        <h3>{t("Rooms")}</h3>
        <p class="muted tiny">{t("Split Q&A into separate rooms, e.g. one per session or track. Attendees pick a room.")}</p>
        <RoomsEditor rooms={meta.rooms} code={code} hostKey={hostKey} onSave={(rooms) => send({ type: "setRooms", rooms })} />

        <h3>{t("Quiz teams")}</h3>
        <p class="muted tiny">{t("Add two or more teams to play quizzes in teams. People pick a team (or let the app pick) before they answer. Teams are ranked by average points, so team size doesn't matter.")}</p>
        <LabelsEditor teams labels={meta.teams} onSave={(teams) => send({ type: "setTeams", teams })} />

        <h3>{t("Audience")}</h3>
        {Toggle({ k: "reactions", label: t("Emoji reactions"), hint: t("People can send 👏 ❤️ 🔥 to the big screen.") })}
        <p class="label">{t("Ask people for")}</p>
        <div class="seg" role="group" aria-label={t("What attendees must enter")}>
          {(
            [
              ["none", t("Nothing")],
              ["name", t("Name")],
              ["email", t("Name + email")],
            ] as const
          ).map(([v, l]) => (
            <button key={v} aria-pressed={settings.identity === v} onClick={() => set({ identity: v })}>
              {l}
            </button>
          ))}
        </div>
        <form
          class="stack-sm"
          style={{ marginTop: 16 }}
          onSubmit={(e) => {
            e.preventDefault();
            send({ type: "setPasscode", passcode: pass });
            toast(pass.trim() ? t("Passcode set") : t("Passcode removed"));
          }}
        >
          <label class="label" for="pc" style={{ marginTop: 0 }}>
            {t("Passcode")}
          </label>
          <div class="row nowrap">
            <input id="pc" class="input" maxLength={20} placeholder={t("No passcode")} value={pass} onInput={(e) => setPass(e.currentTarget.value)} />
            <button class="btn">{t("Save")}</button>
          </div>
          <p class="muted tiny">{t("People who join with the code must also type this. Leave empty for no passcode.")}</p>
        </form>

        <h3>{t("Moderators")}</h3>
        <p class="muted tiny">{t("Moderators can review, label, reply to and highlight questions. They can't change polls or settings.")}</p>
        <div class="mod-link" style={{ marginTop: 8 }}>
          <input class="input" readOnly value={modUrl} aria-label={t("Moderator link")} onFocus={(e) => e.currentTarget.select()} />
          <button class="btn sm" onClick={() => copy(modUrl, t("Moderator link copied"))}>
            {t("Copy")}
          </button>
        </div>
        <button class="btn sm ghost" style={{ marginTop: 8 }} onClick={() => confirm(t("Make a new moderator link? The old link stops working and anyone using it is signed out.")) && send({ type: "newModKey" })}>
          {t("Make a new link")}
        </button>

        <h3>{t("Stream and embed")}</h3>
        <p class="label" style={{ marginTop: 0 }}>{t("Stream overlay")}</p>
        <p class="muted tiny">{t("Add as a browser source in OBS, vMix or StreamYard (1920×1080). It has a see-through background and shows the live poll or the question on screen.")}</p>
        <div class="mod-link" style={{ marginTop: 8 }}>
          <input class="input" readOnly value={overlayUrl} aria-label={t("Stream overlay link")} onFocus={(e) => e.currentTarget.select()} />
          <button class="btn sm" onClick={() => copy(overlayUrl, t("Overlay link copied. Keep it private."))}>
            {t("Copy")}
          </button>
        </div>
        <p class="label">{t("Embed on a website")}</p>
        <p class="muted tiny">{t("Paste this into any web page, like an event site or a course page. People can ask and vote without leaving it.")}</p>
        <textarea class="input code-snippet" readOnly rows={3} aria-label={t("Embed code")} value={embedCode} onFocus={(e) => e.currentTarget.select()} />
        <button class="btn sm" style={{ marginTop: 8 }} onClick={() => copy(embedCode, t("Embed code copied"))}>
          {t("Copy embed code")}
        </button>

        <h3>{t("API and webhooks")}</h3>
        <ApiSettings code={code} api={meta.api ?? { key: null, webhook: null }} send={send} />

        <h3>{t("Look")}</h3>
        <div class="logo-pick">
          {settings.logo ? <img src={mediaUrl(code, settings.logo)} alt={t("Event logo")} /> : <span class="muted small">{t("No logo")}</span>}
          <input
            ref={logoRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (!file) return;
              setUploading(true);
              try {
                set({ logo: await uploadImage(code, hostKey, file) });
              } catch (err) {
                toast((err as Error).message);
              }
              setUploading(false);
            }}
          />
          <button class="btn sm ghost" onClick={() => logoRef.current?.click()} disabled={uploading}>
            {uploading ? t("Uploading…") : settings.logo ? t("Change logo") : t("Add logo")}
          </button>
          {settings.logo && (
            <button class="btn sm quiet" onClick={() => set({ logo: null })}>
              {t("Remove")}
            </button>
          )}
        </div>
        <div class="themes" role="group" aria-label={t("Colour theme")} style={{ marginTop: 14 }}>
          {THEMES.map((t) => (
            <button key={t} aria-pressed={settings.theme === t} onClick={() => set({ theme: t })}>
              <span class="swatch">
                <i style={{ background: THEME_SWATCH[t][0] }} />
                <i style={{ background: THEME_SWATCH[t][1] }} />
              </span>
              {THEME_SWATCH[t][2]}
            </button>
          ))}
        </div>
        <p class="label">{t("Big screen")}</p>
        <div class="seg" role="group" aria-label={t("Big screen light or dark")}>
          {(["light", "dark"] as const).map((v) => (
            <button key={v} aria-pressed={settings.screen === v} onClick={() => set({ screen: v })}>
              {v === "light" ? t("Light") : t("Dark")}
            </button>
          ))}
        </div>
        <p class="label">{t("Big screen shows")}</p>
        <div class="seg" role="group" aria-label={t("What the big screen shows")} style={{ flexWrap: "wrap" }}>
          {(
            [
              ["auto", t("Auto")],
              ["qa", t("Q&A")],
              ["poll", t("Poll")],
              ["leaderboard", t("Leaderboard")],
              ["code", t("Join code")],
            ] as const
          ).map(([m, l]) => (
            <button key={m} aria-pressed={meta.presentMode === m} onClick={() => send({ type: "setPresentMode", mode: m })}>
              {l}
            </button>
          ))}
        </div>
        <p class="muted tiny" style={{ marginTop: 8 }}>
          {t("Auto shows the live poll when one is running, and questions the rest of the time.")}
        </p>

        <h3>{t("Privacy")}</h3>
        <p class="label" style={{ marginTop: 6 }}>
          {t("Delete this event automatically")}
        </p>
        <select
          class="input"
          aria-label={t("Delete this event automatically")}
          value=""
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v === "") return;
            deleteIn(v === "never" ? null : Number(v));
          }}
        >
          <option value="">{settings.deleteAt ? t("On {date}", { date: new Date(settings.deleteAt).toLocaleString() }) : t("Never")}</option>
          <option value="never">{t("Never")}</option>
          <option value="1">{t("1 day from now")}</option>
          <option value="7">{t("{n} days from now", { n: 7 })}</option>
          <option value="30">{t("{n} days from now", { n: 30 })}</option>
          <option value="90">{t("{n} days from now", { n: 90 })}</option>
        </select>
        <p class="muted tiny" style={{ marginTop: 6 }}>
          {t("Everything is deleted: questions, answers, names and images. Download your results first.")}
        </p>
      </div>
    </>
  );
}

function LabelsEditor({ labels, onSave, teams = false }: { labels: Label[]; onSave: (l: { id?: string; name: string; color: LabelColor }[]) => void; teams?: boolean }) {
  const [list, setList] = useState(labels.map((l) => ({ ...l })));
  const [name, setName] = useState("");
  useEffect(() => setList(labels.map((l) => ({ ...l }))), [JSON.stringify(labels)]);
  const save = (next: typeof list) => {
    setList(next);
    onSave(next);
  };
  return (
    <div class="edit-list">
      {list.map((l, i) => (
        <div class="row" key={l.id}>
          <select class="input" aria-label={t("Colour for {name}", { name: l.name })} value={l.color} onChange={(e) => save(list.map((x, j) => (j === i ? { ...x, color: e.currentTarget.value as LabelColor } : x)))}>
            {LABEL_COLORS.map((c) => (
              <option key={c} value={c}>
                {COLOR_NAMES[c]}
              </option>
            ))}
          </select>
          <LabelChip label={l} />
          <span class="grow" />
          <button class="btn sm quiet" aria-label={teams ? t("Delete team {name}", { name: l.name }) : t("Delete label {name}", { name: l.name })} onClick={() => save(list.filter((_, j) => j !== i))}>
            <Icon.x />
          </button>
        </div>
      ))}
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          save([...list, { id: "", name: name.trim(), color: LABEL_COLORS[list.length % LABEL_COLORS.length] }].map((x) => (x.id ? x : { name: x.name, color: x.color }) as Label));
          setName("");
        }}
      >
        <input class="input" maxLength={24} placeholder={teams ? t("New team, e.g. Red team") : t("New label, e.g. Finance")} value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <button class="btn sm">{t("Add")}</button>
      </form>
    </div>
  );
}

const HOOK_LABEL: Record<WebhookEvent, string> = {
  "question.created": t("New question"),
  "question.updated": t("Question changed (approved, answered, highlighted…)"),
  "question.deleted": t("Question removed"),
  "reply.created": t("New reply"),
  "poll.launched": t("Poll launched"),
  "poll.closed": t("Poll closed"),
  "poll.revealed": t("Quiz answer revealed"),
  "response.created": t("Every poll answer (busy!)"),
};

function hookError(last: { status: number; error?: string }): string {
  if (last.error === "No answer within 8 seconds") return t("No answer within 8 seconds");
  if (last.error === "Couldn't reach that address") return t("Couldn't reach that address");
  return t("The server answered {status}", { status: last.status });
}

function ApiSettings({ code, api, send }: { code: string; api: ApiSetup; send: Send }) {
  const [url, setUrl] = useState(api.webhook?.url ?? "");
  const [events, setEvents] = useState<WebhookEvent[]>(api.webhook?.events ?? WEBHOOK_EVENTS.filter((e) => e !== "response.created"));
  const [show, setShow] = useState(false);
  useEffect(() => {
    setUrl(api.webhook?.url ?? "");
    if (api.webhook) setEvents(api.webhook.events);
  }, [api.webhook?.url, api.webhook?.events.join()]);
  const base = `${location.origin}/api/v1/events/${code}`;
  const last = api.webhook?.last;
  return (
    <div class="stack-sm api-settings">
      <p class="muted tiny">
        {tj("Let other tools read this event's questions, polls and results, or get told when things happen. {docs}", {
          docs: (
            <a href="https://github.com/camster91/RSlide/blob/main/docs/API.md" target="_blank" rel="noopener">
              {t("How to use the API")}
            </a>
          ),
        })}
      </p>
      <label class="toggle">
        <span>
          {t("Read-only API key")}
          <span class="muted small" style={{ display: "block" }}>
            {t("Anyone with the key can read everything in this event, including names and emails.")}
          </span>
        </span>
        <input type="checkbox" checked={!!api.key} onChange={(e) => send({ type: "setApiKey", on: e.currentTarget.checked })} />
      </label>
      {api.key && (
        <>
          <div class="mod-link">
            <input class="input mono" readOnly value={show ? api.key : `${api.key.slice(0, 6)}${"•".repeat(24)}`} aria-label={t("API key")} onFocus={(e) => e.currentTarget.select()} />
            <button class="btn sm ghost" onClick={() => setShow(!show)}>
              {show ? t("Hide") : t("Show")}
            </button>
            <button class="btn sm" onClick={() => copy(api.key!, t("API key copied. Keep it private."))}>
              {t("Copy")}
            </button>
          </div>
          <p class="muted tiny mono">GET {base}/questions</p>
          <button class="btn sm ghost" onClick={() => confirm(t("Make a new API key? The old key stops working.")) && send({ type: "setApiKey", on: true })}>
            {t("Make a new key")}
          </button>
        </>
      )}

      <p class="label">{t("Webhook")}</p>
      <form
        class="stack-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!url.trim()) return toast(t("Enter the address that should receive events"));
          send({ type: "setWebhook", url: url.trim(), events });
          toast(t("Webhook saved"));
        }}
      >
        <input class="input" type="url" inputMode="url" placeholder="https://example.com/rslide-hook" aria-label={t("Webhook address")} value={url} onInput={(e) => setUrl(e.currentTarget.value)} />
        <fieldset class="hook-events">
          <legend class="sr-only">{t("Events to send")}</legend>
          {WEBHOOK_EVENTS.map((ev) => (
            <label key={ev} class="check small">
              <input type="checkbox" checked={events.includes(ev)} onChange={(e) => setEvents(e.currentTarget.checked ? [...events, ev] : events.filter((x) => x !== ev))} />
              {HOOK_LABEL[ev]}
            </label>
          ))}
        </fieldset>
        <div class="row">
          <button class="btn sm">{api.webhook ? t("Save webhook") : t("Add webhook")}</button>
          {api.webhook && (
            <>
              <button type="button" class="btn sm ghost" onClick={() => send({ type: "testWebhook" })}>
                {t("Send a test")}
              </button>
              <button type="button" class="btn sm quiet danger" onClick={() => confirm(t("Remove this webhook?")) && send({ type: "removeWebhook" })}>
                {t("Remove")}
              </button>
            </>
          )}
        </div>
      </form>
      {api.webhook && (
        <>
          <p class="muted tiny">{t("Each delivery is signed with this secret, so your server can check it came from here:")}</p>
          <div class="mod-link">
            <input class="input mono" readOnly value={api.webhook.secret} aria-label={t("Webhook secret")} onFocus={(e) => e.currentTarget.select()} />
            <button class="btn sm" onClick={() => copy(api.webhook!.secret, t("Secret copied"))}>
              {t("Copy")}
            </button>
          </div>
          {last ? (
            <p class={`notice small ${last.ok ? "" : "bad"}`}>
              {last.ok ? t("Last delivery worked ({status}) at {time}.", { status: last.status, time: whenText(last.at) }) : t("Last delivery failed at {time}: {error}", { time: whenText(last.at), error: hookError(last) })}
            </p>
          ) : (
            <p class="muted tiny">{t("Nothing sent yet. Use \"Send a test\" to check it works.")}</p>
          )}
        </>
      )}
    </div>
  );
}

function RoomsEditor({ rooms, code, hostKey, onSave }: { rooms: Room[]; code: string; hostKey: string; onSave: (r: { id?: string; name: string }[]) => void }) {
  const current = rooms.length ? rooms : [{ id: MAIN_ROOM, name: t("Main") }];
  const [name, setName] = useState("");
  return (
    <div class="edit-list">
      {rooms.length > 1 &&
        current.map((r, i) => (
          <div class="row" key={r.id}>
            <input class="input" maxLength={40} aria-label={t("Room name")} value={r.name} onChange={(e) => onSave(current.map((x, j) => (j === i ? { ...x, name: e.currentTarget.value } : x)))} />
            <button class="btn sm ghost" title={t("Copy a big-screen link that only shows this room")} onClick={() => copy(`${location.origin}/present/${code}?room=${r.id}#${hostKey}`, t("Big-screen link for {name} copied", { name: r.name }))}>
              {t("Screen link")}
            </button>
            {i > 0 && (
              <button class="btn sm quiet" aria-label={t("Delete room {name}", { name: r.name })} onClick={() => confirm(t("Delete \"{name}\"? Its questions move to \"{first}\".", { name: r.name, first: current[0].name })) && onSave(current.filter((_, j) => j !== i))}>
                <Icon.x />
              </button>
            )}
          </div>
        ))}
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onSave([...current, { name: name.trim() }]);
          setName("");
        }}
      >
        <input class="input" maxLength={40} placeholder={rooms.length > 1 ? t("Another room") : t("Add a second room, e.g. Workshop")} value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <button class="btn sm">{t("Add")}</button>
      </form>
      {rooms.length > 1 && (
        <button class="btn sm quiet" style={{ marginTop: 6 }} onClick={() => confirm(t("Go back to one room? All questions move to the first room.")) && onSave([])}>
          {t("Use one room")}
        </button>
      )}
    </div>
  );
}

// ---------- questions ----------

function HostQuestion({ q, act, send, labels, rooms, original }: {
  q: Question;
  act: (type: ModAction, id: string) => void;
  send: Send;
  labels: Label[];
  rooms: Room[];
  /** The earlier question this one probably repeats. */
  original?: Question;
}) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [tagging, setTagging] = useState(false);
  return (
    <article class={`q ${q.highlighted ? "hl" : ""}`}>
      <VoteCount q={q} />
      <div class="body">
        {q.highlighted && (
          <span class="tag hl" style={{ marginBottom: 6 }}>
            {t("On the big screen")}
          </span>
        )}
        <div class="text">{q.text}</div>
        <QuestionMeta q={q} />
        {original && (
          <div class="dup-hint" role="note">
            <span class="dup-title">
              <Icon.copy /> {t("Looks like a repeat of")}
            </span>
            <q class="dup-text">{original.text}</q>
            <div class="row">
              <button class="btn sm" onClick={() => send({ type: "mergeQuestion", id: q.id, into: original.id })} title={t("Move this question's votes and replies to the earlier one, then remove it")}>
                {t("Merge into that one")}
              </button>
              <button class="btn sm quiet" onClick={() => send({ type: "notDuplicate", id: q.id })}>
                {t("Not a repeat")}
              </button>
            </div>
          </div>
        )}
        {(q.labels.length > 0 || tagging) && (
          <div class="labels">
            {(tagging ? labels : labels.filter((l) => q.labels.includes(l.id))).map((l) => (
              <LabelChip key={l.id} label={l} on={tagging ? q.labels.includes(l.id) : undefined} onClick={tagging ? () => send({ type: "tagQuestion", id: q.id, label: l.id }) : undefined} />
            ))}
          </div>
        )}
        <Replies replies={q.replies} canDelete={() => true} onDelete={(r) => send({ type: "deleteReply", id: q.id, replyId: r.id })} />
        {replying && (
          <form
            class="reply-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!reply.trim()) return toast(t("Type a reply first"));
              send({ type: "reply", id: q.id, text: reply.trim() });
              setReply("");
              setReplying(false);
            }}
          >
            <input class="input" maxLength={300} placeholder={t("Reply to everyone")} aria-label={t("Your reply")} autoFocus value={reply} onInput={(e) => setReply(e.currentTarget.value)} />
            <button class="btn sm">{t("Send")}</button>
            <button type="button" class="btn sm quiet" onClick={() => setReplying(false)}>
              {t("Cancel")}
            </button>
          </form>
        )}
        <div class="actions">
          {q.status === "pending" && (
            <button class="btn sm" onClick={() => act("approve", q.id)}>
              {t("Approve")}
            </button>
          )}
          {q.status !== "archived" && (
            <button class={`btn sm ${q.highlighted ? "on" : "ghost"}`} onClick={() => act("highlight", q.id)}>
              {q.highlighted ? t("Remove from screen") : t("Show on screen")}
            </button>
          )}
          {(q.status === "live" || q.status === "answered") && (
            <button class="btn sm ghost" onClick={() => act("answer", q.id)}>
              {q.status === "answered" ? t("Mark not answered") : t("Mark answered")}
            </button>
          )}
          {!replying && (
            <button class="btn sm ghost" onClick={() => setReplying(true)}>
              {t("Reply")}
            </button>
          )}
          {labels.length > 0 && (
            <button class={`btn sm ${tagging ? "on" : "ghost"}`} onClick={() => setTagging(!tagging)}>
              {tagging ? t("Done") : t("Label")}
            </button>
          )}
          <button class="btn sm ghost" onClick={() => act("archive", q.id)}>
            {q.status === "archived" ? t("Restore") : t("Archive")}
          </button>
          {rooms.length > 1 && (
            <select class="input btn sm ghost" aria-label={t("Move to room")} value={q.room} onChange={(e) => send({ type: "moveQuestion", id: q.id, room: e.currentTarget.value })} style={{ width: "auto" }}>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
          <button class="btn sm danger" onClick={() => act("deleteQuestion", q.id)}>
            {t("Delete")}
          </button>
        </div>
      </div>
    </article>
  );
}

function HostPoll({ code, poll: p, results, first, last, clockOffset, send, onEdit }: {
  code: string;
  poll: Poll;
  results: ReturnType<typeof resultsOf>;
  first: boolean;
  last: boolean;
  clockOffset: number;
  send: Send;
  onEdit: () => void;
}) {
  const confirmThen = (msg: string, m: ClientMsg) => confirm(msg) && send(m);
  const statusText = p.status === "active" ? t("Live now") : p.status === "closed" ? t("Closed") : t("Not started");
  return (
    <div class={`poll-item ${p.status === "active" ? "active" : ""}`}>
      <div class="spread">
        <span class="row" style={{ gap: 8 }}>
          <span class={`status ${p.status}`}>{statusText}</span>
          <span class="muted small">
            {TYPE_LABEL[p.type]}
            {p.type === "quiz" && (p.timeLimit ? `, ${t("{n}s", { n: p.timeLimit })}` : `, ${t("no timer")}`)}
            {p.type === "survey" && `, ${plural(p.items.length, "question")}`}
          </span>
        </span>
        <span class="row" style={{ gap: 4 }}>
          {p.status === "active" && p.type === "quiz" && !p.revealed && <Countdown poll={p} clockOffset={clockOffset} />}
          <button class="btn sm quiet" disabled={first} aria-label={t("Move up")} onClick={() => send({ type: "movePoll", pollId: p.id, dir: "up" })}>
            ↑
          </button>
          <button class="btn sm quiet" disabled={last} aria-label={t("Move down")} onClick={() => send({ type: "movePoll", pollId: p.id, dir: "down" })}>
            ↓
          </button>
        </span>
      </div>
      <h3>{p.title}</h3>
      {p.status !== "draft" ? (
        <ResultsView poll={p} results={results} code={code} />
      ) : (
        <p class="muted small">{p.type === "survey" ? p.items.map((i) => i.title).join(" / ") : p.options.join(" / ")}</p>
      )}
      <div class="actions">
        {p.status === "active" ? (
          <button class="btn sm" onClick={() => send({ type: "closePoll", pollId: p.id })}>
            {t("Close poll")}
          </button>
        ) : (
          <button class="btn sm accent" onClick={() => send({ type: "activatePoll", pollId: p.id })}>
            {p.status === "closed" ? t("Reopen") : t("Launch")}
          </button>
        )}
        {p.type === "quiz" ? (
          <button class={`btn sm ${p.revealed ? "on" : "ghost"}`} onClick={() => send({ type: "revealAnswer", pollId: p.id })}>
            {p.revealed ? t("Hide answer") : t("Reveal answer")}
          </button>
        ) : (
          <button class="btn sm ghost" onClick={() => send({ type: "toggleResults", pollId: p.id })}>
            {p.showResults ? t("Hide results from audience") : t("Show results to audience")}
          </button>
        )}
        <button class="btn sm ghost" onClick={onEdit}>
          {t("Edit")}
        </button>
        <button class="btn sm ghost" onClick={() => send({ type: "duplicatePoll", pollId: p.id })}>
          {t("Duplicate")}
        </button>
        {results.total > 0 && (
          <button class="btn sm ghost" onClick={() => confirmThen(t("Clear every answer to this poll?"), { type: "resetPoll", pollId: p.id })}>
            {t("Clear answers")}
          </button>
        )}
        <button class="btn sm danger" onClick={() => confirmThen(t("Delete this poll and its answers?"), { type: "deletePoll", pollId: p.id })}>
          {t("Delete")}
        </button>
      </div>
    </div>
  );
}

// ---------- poll editor ----------

const ALL_TYPES: PollType[] = ["multiple", "quiz", "rating", "scale", "ranking", "wordcloud", "open", "points", "grid", "pin", "survey"];
const needsOptions = (t: string) => t === "multiple" || t === "quiz" || t === "ranking" || t === "points" || t === "grid";
const DEFAULT_AXES: [string, string] = [t("Impact"), t("Effort")];

function newItem(type: ItemType = "multiple"): ItemDraft {
  return {
    type,
    title: "",
    options: needsOptions(type) ? ["", ""] : [],
    images: [],
    multi: false,
    range: type === "scale" ? { min: 1, max: 10, minLabel: "", maxLabel: "" } : null,
    axes: type === "grid" ? DEFAULT_AXES : null,
    image: null,
  };
}
function newDraft(type: PollType): PollDraft {
  return {
    type,
    title: "",
    options: needsOptions(type) ? ["", ""] : [],
    images: [],
    correct: [],
    multi: false,
    timeLimit: 20,
    range: { min: 1, max: 10, minLabel: "", maxLabel: "" },
    axes: DEFAULT_AXES,
    image: null,
    items: [newItem("rating")],
  };
}
function toDraft(p: Poll): PollDraft {
  return {
    id: p.id,
    type: p.type,
    title: p.title,
    options: [...p.options],
    images: p.options.map((_, i) => p.images?.[i] ?? null),
    correct: [...(p.correct ?? [])],
    multi: p.multi,
    timeLimit: p.timeLimit,
    range: p.range ?? { min: 1, max: 10, minLabel: "", maxLabel: "" },
    axes: p.axes ?? DEFAULT_AXES,
    image: p.image,
    items: p.items.length
      ? p.items.map((it) => ({ type: it.type as ItemType, title: it.title, options: [...it.options], images: it.images, multi: it.multi, range: it.range, axes: it.axes, image: it.image }))
      : [newItem("rating")],
  };
}

function OptionsEditor({ code, hostKey, options, images, correct, quiz, onChange }: {
  code: string;
  hostKey: string;
  options: string[];
  images: (string | null)[];
  correct?: number[];
  quiz?: boolean;
  onChange: (o: { options: string[]; images: (string | null)[]; correct?: number[] }) => void;
}) {
  const [uploading, setUploading] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const target = useRef(0);
  const imgs = options.map((_, i) => images[i] ?? null);
  const pickImage = (i: number) => {
    target.current = i;
    fileRef.current?.click();
  };
  const onFile = async (e: Event) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = "";
    if (!file) return;
    const i = target.current;
    setUploading(i);
    try {
      const id = await uploadImage(code, hostKey, file);
      onChange({ options, images: imgs.map((x, j) => (j === i ? id : x)), correct });
    } catch (err) {
      toast((err as Error).message);
    }
    setUploading(null);
  };
  const remove = (i: number) =>
    onChange({
      options: options.filter((_, j) => j !== i),
      images: imgs.filter((_, j) => j !== i),
      correct: correct?.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c)),
    });

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={onFile} />
      {options.map((o, i) => (
        <div class="opt-row" key={i}>
          {quiz && (
            <label class="check" title={t("Correct answer")}>
              <input
                type="checkbox"
                aria-label={t("Option {n} is correct", { n: i + 1 })}
                checked={!!correct?.includes(i)}
                onChange={(e) => onChange({ options, images: imgs, correct: e.currentTarget.checked ? [...(correct ?? []), i] : (correct ?? []).filter((c) => c !== i) })}
              />
            </label>
          )}
          <button type="button" class="img-btn" aria-label={imgs[i] ? t("Change image for option {n}", { n: i + 1 }) : t("Add image to option {n}", { n: i + 1 })} onClick={() => (imgs[i] ? onChange({ options, images: imgs.map((x, j) => (j === i ? null : x)), correct }) : pickImage(i))} title={imgs[i] ? t("Remove image") : t("Add image")}>
            {uploading === i ? "…" : imgs[i] ? <img src={mediaUrl(code, imgs[i]!)} alt="" /> : <Icon.image />}
          </button>
          <input class="input" maxLength={120} placeholder={t("Option {n}", { n: i + 1 })} value={o} aria-label={t("Option {n}", { n: i + 1 })} onInput={(e) => onChange({ options: options.map((x, j) => (j === i ? e.currentTarget.value : x)), images: imgs, correct })} />
          {options.length > 2 && (
            <button type="button" class="btn sm quiet" aria-label={t("Remove option {n}", { n: i + 1 })} onClick={() => remove(i)}>
              <Icon.x />
            </button>
          )}
        </div>
      ))}
      {options.length < 10 && (
        <button type="button" class="btn sm ghost" style={{ marginTop: 10 }} onClick={() => onChange({ options: [...options, ""], images: [...imgs, null], correct })}>
          {t("Add option")}
        </button>
      )}
    </div>
  );
}

function RangeEditor({ range, onChange }: { range: PollDraft["range"]; onChange: (r: NonNullable<PollDraft["range"]>) => void }) {
  const r = { min: 1, max: 10, minLabel: "", maxLabel: "", ...range };
  const num = (v: string) => Math.max(0, Math.min(10, Number(v) || 0));
  return (
    <div class="row">
      <label class="small">
        {t("From")}{" "}
        <select class="input" style={{ width: "auto", display: "inline-block" }} value={r.min} onChange={(e) => onChange({ ...r, min: num(e.currentTarget.value) })}>
          {[0, 1].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <label class="small">
        {t("to")}{" "}
        <select class="input" style={{ width: "auto", display: "inline-block" }} value={r.max} onChange={(e) => onChange({ ...r, max: num(e.currentTarget.value) })}>
          {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <input class="input grow" style={{ flex: "1 1 120px" }} maxLength={30} placeholder={t("Low end label (optional)")} value={r.minLabel} onInput={(e) => onChange({ ...r, minLabel: e.currentTarget.value })} />
      <input class="input grow" style={{ flex: "1 1 120px" }} maxLength={30} placeholder={t("High end label (optional)")} value={r.maxLabel} onInput={(e) => onChange({ ...r, maxLabel: e.currentTarget.value })} />
    </div>
  );
}

function PollEditor({ code, hostKey, draft, onSave, onCancel }: { code: string; hostKey: string; draft: PollDraft; onSave: (p: PollDraft) => void; onCancel: () => void }) {
  const [d, setD] = useState<PollDraft>(draft);
  const set = (patch: Partial<PollDraft>) => setD((cur) => ({ ...cur, ...patch }));
  const setType = (type: PollType) => setD((cur) => ({ ...cur, type, options: needsOptions(type) && cur.options.length < 2 ? ["", ""] : cur.options }));
  const items = d.items ?? [];
  const setItem = (i: number, patch: Partial<ItemDraft>) => set({ items: items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });

  const save = (e: Event) => {
    e.preventDefault();
    if (!d.title.trim()) return toast(d.type === "survey" ? t("Give the survey a name") : t("Type the question"));
    if (needsOptions(d.type) && d.options.filter((o, i) => o.trim() || d.images?.[i]).length < 2) return toast(t("Add at least 2 options"));
    if (d.type === "quiz" && !d.correct.length) return toast(t("Tick the correct answer"));
    if (d.type === "pin" && !d.image) return toast(t("Add the picture people will tap on"));
    if (d.type === "survey") {
      if (!items.length) return toast(t("Add a question to the survey"));
      if (items.some((it) => !it.title.trim())) return toast(t("Every survey question needs text"));
      if (items.some((it) => it.type === "pin" && !it.image)) return toast(t("Add a picture to each pin question"));
    }
    onSave({ ...d, items: d.type === "survey" ? items : [] });
  };

  return (
    <form class="editor stack" onSubmit={save}>
      <div class="spread">
        <b>{d.id ? t("Edit poll") : t("New poll")}</b>
        <button type="button" class="btn sm quiet" onClick={onCancel} aria-label={t("Close editor")}>
          <Icon.x />
        </button>
      </div>
      <div class="type-grid" role="group" aria-label={t("Poll type")}>
        {ALL_TYPES.map((t) => (
          <button type="button" key={t} aria-pressed={d.type === t} onClick={() => setType(t)}>
            {TYPE_LABEL[t]}
            <small>{TYPE_HINT[t]}</small>
          </button>
        ))}
      </div>
      <div>
        <label class="label" for="ptitle">
          {d.type === "survey" ? t("Survey name") : t("Question")}
        </label>
        <input id="ptitle" class="input" maxLength={300} autoFocus value={d.title} onInput={(e) => set({ title: e.currentTarget.value })} placeholder={d.type === "survey" ? t("e.g. Session feedback") : t("What do you want to ask?")} />
      </div>

      {needsOptions(d.type) && (
        <div>
          <span class="label">{d.type === "quiz" ? t("Answers (tick the correct one)") : t("Options")}</span>
          <OptionsEditor code={code} hostKey={hostKey} options={d.options} images={d.images ?? []} correct={d.correct} quiz={d.type === "quiz"} onChange={(o) => set({ options: o.options, images: o.images, correct: o.correct ?? d.correct })} />
        </div>
      )}
      {d.type === "multiple" && (
        <label class="check small">
          <input type="checkbox" checked={d.multi} onChange={(e) => set({ multi: e.currentTarget.checked })} /> {t("People can pick more than one")}
        </label>
      )}
      {d.type === "quiz" && (
        <label class="small row">
          {t("Time to answer")}
          <select class="input" style={{ width: "auto" }} value={d.timeLimit ?? 20} onChange={(e) => set({ timeLimit: Number(e.currentTarget.value) })}>
            {[0, 10, 15, 20, 30, 45, 60, 90, 120].map((n) => (
              <option key={n} value={n}>
                {n ? t("{n} seconds", { n }) : t("No timer")}
              </option>
            ))}
          </select>
        </label>
      )}
      {d.type === "scale" && <RangeEditor range={d.range} onChange={(range) => set({ range })} />}
      {d.type === "grid" && <AxesEditor axes={d.axes ?? DEFAULT_AXES} onChange={(axes) => set({ axes })} />}
      {d.type === "pin" && <ImagePicker code={code} hostKey={hostKey} image={d.image ?? null} onChange={(image) => set({ image })} />}
      {d.type === "points" && <p class="muted small">{t("Each person shares out 100 points across the options.")}</p>}
      {d.type === "rating" && <p class="muted small">{t("People rate from 1 to 5 stars.")}</p>}
      {d.type === "ranking" && <p class="muted small">{t("People put the options in order. The big screen shows the overall order.")}</p>}
      {d.type === "wordcloud" && <p class="muted small">{t("People send short words. The most popular grow biggest.")}</p>}
      {d.type === "open" && <p class="muted small">{t("People type a short answer. Newest answers show first.")}</p>}

      {d.type === "survey" && (
        <div>
          <span class="label">{t("Questions")}</span>
          {items.map((it, i) => (
            <div class="sub-item stack-sm" key={i}>
              <div class="row nowrap">
                <span class="muted small num" style={{ width: 22 }}>
                  {i + 1}.
                </span>
                <select class="input" style={{ width: "auto" }} aria-label={t("Question {n} type", { n: i + 1 })} value={it.type} onChange={(e) => setItem(i, { ...newItem(e.currentTarget.value as ItemType), title: it.title })}>
                  {ITEM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                <span class="grow" />
                <button type="button" class="btn sm quiet" disabled={i === 0} aria-label={t("Move question up")} onClick={() => set({ items: items.map((x, j) => (j === i - 1 ? items[i] : j === i ? items[i - 1] : x)) })}>
                  ↑
                </button>
                <button type="button" class="btn sm quiet" aria-label={t("Remove question")} disabled={items.length === 1} onClick={() => set({ items: items.filter((_, j) => j !== i) })}>
                  <Icon.x />
                </button>
              </div>
              <input class="input" maxLength={300} placeholder={t("Question")} aria-label={t("Question {n}", { n: i + 1 })} value={it.title} onInput={(e) => setItem(i, { title: e.currentTarget.value })} />
              {needsOptions(it.type) && <OptionsEditor code={code} hostKey={hostKey} options={it.options} images={it.images ?? []} onChange={(o) => setItem(i, { options: o.options, images: o.images })} />}
              {it.type === "multiple" && (
                <label class="check small">
                  <input type="checkbox" checked={!!it.multi} onChange={(e) => setItem(i, { multi: e.currentTarget.checked })} /> {t("Allow more than one")}
                </label>
              )}
              {it.type === "scale" && <RangeEditor range={it.range ?? null} onChange={(range) => setItem(i, { range })} />}
              {it.type === "grid" && <AxesEditor axes={it.axes ?? DEFAULT_AXES} onChange={(axes) => setItem(i, { axes })} />}
              {it.type === "pin" && <ImagePicker code={code} hostKey={hostKey} image={it.image ?? null} onChange={(image) => setItem(i, { image })} />}
            </div>
          ))}
          {items.length < 15 && (
            <button type="button" class="btn sm ghost" style={{ marginTop: 10 }} onClick={() => set({ items: [...items, newItem("multiple")] })}>
              {t("Add question")}
            </button>
          )}
        </div>
      )}

      <div class="row">
        <button class="btn">{d.id ? t("Save changes") : t("Save poll")}</button>
        <button type="button" class="btn ghost" onClick={onCancel}>
          {t("Cancel")}
        </button>
        {d.id && <span class="muted tiny">{t("Changing the type or options clears existing answers.")}</span>}
      </div>
    </form>
  );
}


function AxesEditor({ axes, onChange }: { axes: [string, string]; onChange: (a: [string, string]) => void }) {
  return (
    <div class="row">
      <label class="small grow">
        {t("Across (left to right)")}
        <input class="input" maxLength={30} value={axes[0]} onInput={(e) => onChange([e.currentTarget.value, axes[1]])} />
      </label>
      <label class="small grow">
        {t("Up (bottom to top)")}
        <input class="input" maxLength={30} value={axes[1]} onInput={(e) => onChange([axes[0], e.currentTarget.value])} />
      </label>
    </div>
  );
}

function ImagePicker({ code, hostKey, image, onChange }: { code: string; hostKey: string; image: string | null; onChange: (id: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div class="stack-sm">
      <span class="label">{t("Picture to tap on")}</span>
      {image && (
        <div class="pin-wrap" style={{ maxWidth: 320 }}>
          <img src={mediaUrl(code, image)} alt="" />
        </div>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (!file) return;
          setBusy(true);
          try {
            onChange(await uploadImage(code, hostKey, file));
          } catch (err) {
            toast((err as Error).message);
          }
          setBusy(false);
        }}
      />
      <div class="row">
        <button type="button" class="btn sm ghost" disabled={busy} onClick={() => ref.current?.click()}>
          {busy ? t("Uploading…") : image ? t("Change picture") : t("Upload a picture")}
        </button>
        <span class="muted tiny">{t("A map, floor plan, chart or photo works well.")}</span>
      </div>
    </div>
  );
}
