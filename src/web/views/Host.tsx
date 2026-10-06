import { useEffect, useRef, useState } from "preact/hooks";
import { ITEM_TYPES, THEMES, type ClientMsg, type ItemDraft, type ItemType, type Poll, type PollDraft, type PollType, type Question, type Settings, type ThemeName } from "../../shared/protocol";
import { resultsOf, sortQuestions } from "../../shared/store";
import { useRoom, type Send } from "../lib/room";
import { CFG, joinUrl, mediaUrl, rememberHosted, toast, uploadImage, useTheme, useTitle } from "../lib/util";
import { Board, ConnProblem, Countdown, Empty, Icon, Podium, QuestionMeta, ResultsView, TopBar, TYPE_HINT, TYPE_LABEL, VoteCount } from "../components/ui";

type QTab = "live" | "pending" | "answered" | "archived";
const Q_TABS: [QTab, string][] = [
  ["live", "Live"],
  ["pending", "To review"],
  ["answered", "Answered"],
  ["archived", "Archived"],
];
const EMPTY_TEXT: Record<QTab, [string, string]> = {
  live: ["No questions yet", "Share the code so people can start asking."],
  pending: ["Nothing to review", "New questions wait here until you approve them."],
  answered: ["Nothing answered yet", "Mark questions answered as you go."],
  archived: ["Nothing archived", "Archive questions to hide them from everyone."],
};
const THEME_SWATCH: Record<ThemeName, [string, string, string]> = {
  indigo: ["#3b3fd8", "#ffb21a", "Indigo"],
  ocean: ["#0b6e99", "#ff9f1c", "Ocean"],
  forest: ["#1f7a4d", "#e9b949", "Forest"],
  berry: ["#b1245f", "#ffb21a", "Berry"],
  mono: ["#24242e", "#ffd400", "Mono"],
  contrast: ["#0000b3", "#ffe600", "High contrast"],
};

export function Host({ code }: { code: string }) {
  const key = decodeURIComponent(location.hash.slice(1));
  const [reactions, setReactions] = useState(0);
  const { state, status, send } = useRoom(code, "host", { key, onReactions: (c) => setReactions((n) => n + Object.values(c).reduce((a, b) => a + (b ?? 0), 0)) });
  const [qTab, setQTab] = useState<QTab>("live");
  const [editing, setEditing] = useState<PollDraft | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const s = state.snapshot;
  useTitle(s ? `Host: ${s.meta.title}` : CFG.name);
  useTheme(s?.meta.settings.theme);
  useEffect(() => {
    if (s) rememberHosted({ code, key, title: s.meta.title, ts: Date.now() });
  }, [!!s]);

  if (!key || status === "forbidden") return <ConnProblem status="forbidden" code={code} />;
  if (status === "not-found") return <ConnProblem status={status} code={code} />;

  const copy = (txt: string, msg: string) =>
    navigator.clipboard?.writeText(txt).then(
      () => toast(msg),
      () => prompt("Copy this link:", txt),
    );

  const by: Record<QTab, Question[]> = { live: [], pending: [], answered: [], archived: [] };
  s?.questions.forEach((q) => by[q.status].push(q));
  const showReview = !!s && (s.meta.settings.moderation || by.pending.length > 0);
  const tab = qTab === "pending" && !showReview ? "live" : qTab;
  const list = sortQuestions(by[tab], "popular");
  const qAct = (type: "approve" | "answer" | "archive" | "highlight" | "deleteQuestion", id: string) => {
    if (type === "deleteQuestion" && !confirm("Delete this question for everyone?")) return;
    send({ type, id });
  };
  const settings = s?.meta.settings;

  return (
    <>
      <TopBar title={s?.meta.title}>
        <span class="chip" title="Attendees connected now">
          <span class={`dot ${status === "online" ? "" : "off"}`} />
          <span class="num">{s?.online ?? 0}</span> online
        </span>
        <ExportMenu code={code} hostKey={key} />
        <button class="btn sm ghost" onClick={() => setDrawer(true)} aria-label="Event settings">
          <Icon.gear /> Settings
        </button>
        <a class="btn sm accent" href={`/present/${code}#${key}`} target="_blank" rel="noopener">
          Open big screen
        </a>
      </TopBar>

      <main class="wrap wide stack">
        <input
          class="title-input"
          maxLength={120}
          aria-label="Event name"
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
            Join at <b>{location.host}</b> with code
          </span>
          <span class="code">{code}</span>
          {s?.meta.passcode && (
            <span class="chip" style={{ background: "rgba(255,255,255,.18)", color: "inherit" }}>
              Passcode: {s.meta.passcode}
            </span>
          )}
          <span class="grow" />
          <button class="btn sm ghost" onClick={() => copy(joinUrl(code), "Join link copied")}>
            Copy join link
          </button>
          <button class="btn sm ghost" onClick={() => copy(location.href, "Host link copied. Keep it private.")}>
            Copy host link
          </button>
        </div>

        <div class="grid-host">
          <section class="panel stack">
            <div class="section-title">
              <h2>Q&amp;A</h2>
              {settings && (
                <label class="check small">
                  <input type="checkbox" checked={settings.qaOpen} onChange={(e) => send({ type: "setSettings", settings: { qaOpen: e.currentTarget.checked } })} />
                  Taking questions
                </label>
              )}
            </div>
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
                  <HostQuestion key={q.id} q={q} act={qAct} />
                ))}
              </div>
            ) : (
              <Empty title={s ? EMPTY_TEXT[tab][0] : "Connecting…"}>{s ? EMPTY_TEXT[tab][1] : null}</Empty>
            )}
          </section>

          <section class="stack">
            <div class="panel stack">
              <div class="section-title">
                <h2>Polls</h2>
                <button class="btn sm" onClick={() => setEditing(newDraft("multiple"))}>
                  New poll
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
                !editing && <Empty title="No polls yet">Make a few before you start, then launch them one at a time.</Empty>
              )}
            </div>

            {s && s.leaderboard.rounds > 0 && (
              <div class="panel stack">
                <div class="section-title">
                  <h2>Quiz leaderboard</h2>
                  <button class={`btn sm ${s.meta.presentMode === "leaderboard" ? "on" : "ghost"}`} onClick={() => send({ type: "setPresentMode", mode: s.meta.presentMode === "leaderboard" ? "auto" : "leaderboard" })}>
                    {s.meta.presentMode === "leaderboard" ? "On big screen" : "Show on big screen"}
                  </button>
                </div>
                <Podium board={s.leaderboard} />
                <Board board={s.leaderboard} from={3} />
              </div>
            )}

            {settings?.reactions && (
              <p class="muted small" style={{ textAlign: "center" }}>
                {reactions ? `${reactions.toLocaleString()} reactions since you opened this page` : "Reactions are on. They float up the big screen."}
              </p>
            )}
          </section>
        </div>
      </main>

      {drawer && s && <SettingsDrawer settings={s.meta.settings} passcode={s.meta.passcode ?? ""} presentMode={s.meta.presentMode} send={send} onClose={() => setDrawer(false)} />}
    </>
  );
}

// ---------- export ----------

function ExportMenu({ code, hostKey }: { code: string; hostKey: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  const k = encodeURIComponent(hostKey);
  return (
    <div class="menu" ref={ref}>
      <button class="btn sm ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        Export
      </button>
      {open && (
        <div class="menu-list" role="menu">
          <a role="menuitem" href={`/api/events/${code}/export?format=xlsx&key=${k}`} download>
            Excel workbook (.xlsx)
          </a>
          <a role="menuitem" href={`/api/events/${code}/export?key=${k}`} download>
            CSV file
          </a>
          <a role="menuitem" href={`/report/${code}#${hostKey}`} target="_blank" rel="noopener">
            Report to print or save as PDF
          </a>
        </div>
      )}
    </div>
  );
}

// ---------- settings ----------

type ToggleKey = "qaOpen" | "moderation" | "allowAnonymous" | "allowDownvotes" | "reactions";
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

function SettingsDrawer({ settings, passcode, presentMode, send, onClose }: { settings: Settings; passcode: string; presentMode: string; send: Send; onClose: () => void }) {
  const [pass, setPass] = useState(passcode);
  const set = (patch: Partial<Settings>) => send({ type: "setSettings", settings: patch });
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  const Toggle = (p: { k: ToggleKey; label: string; hint?: string }) => <SettingToggle {...p} settings={settings} set={set} />;
  return (
    <>
      <div class="drawer-backdrop" onClick={onClose} />
      <div class="drawer" role="dialog" aria-modal="true" aria-label="Event settings">
        <div class="spread">
          <h2>Settings</h2>
          <button class="btn sm quiet" onClick={onClose} aria-label="Close settings">
            <Icon.x />
          </button>
        </div>

        <h3>Questions</h3>
        {Toggle({ k: "qaOpen", label: "Taking questions" })}
        {Toggle({ k: "moderation", label: "Review questions first", hint: "New questions stay hidden until you approve them." })}
        {Toggle({ k: "allowAnonymous", label: "Allow anonymous questions" })}
        {Toggle({ k: "allowDownvotes", label: "Allow downvotes" })}

        <h3>Audience</h3>
        {Toggle({ k: "reactions", label: "Emoji reactions", hint: "People can send 👏 ❤️ 🔥 to the big screen." })}
        <p class="label" style={{ marginTop: 14 }}>
          Ask people for
        </p>
        <div class="seg" role="group" aria-label="What attendees must enter">
          {(
            [
              ["none", "Nothing"],
              ["name", "Name"],
              ["email", "Name + email"],
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
            toast(pass.trim() ? "Passcode set" : "Passcode removed");
          }}
        >
          <label class="label" for="pc">
            Passcode
          </label>
          <div class="row nowrap">
            <input id="pc" class="input" maxLength={20} placeholder="No passcode" value={pass} onInput={(e) => setPass(e.currentTarget.value)} />
            <button class="btn">Save</button>
          </div>
          <p class="muted tiny">People who join with the code must also type this. Leave empty for no passcode.</p>
        </form>

        <h3>Look</h3>
        <div class="themes" role="group" aria-label="Colour theme">
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
        <p class="label" style={{ marginTop: 16 }}>
          Big screen
        </p>
        <div class="seg" role="group" aria-label="Big screen light or dark">
          {(["light", "dark"] as const).map((v) => (
            <button key={v} aria-pressed={settings.screen === v} onClick={() => set({ screen: v })}>
              {v === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
        <p class="label" style={{ marginTop: 16 }}>
          Big screen shows
        </p>
        <div class="seg" role="group" aria-label="What the big screen shows" style={{ flexWrap: "wrap" }}>
          {(
            [
              ["auto", "Auto"],
              ["qa", "Q&A"],
              ["poll", "Poll"],
              ["leaderboard", "Leaderboard"],
              ["code", "Join code"],
            ] as const
          ).map(([m, l]) => (
            <button key={m} aria-pressed={presentMode === m} onClick={() => send({ type: "setPresentMode", mode: m })}>
              {l}
            </button>
          ))}
        </div>
        <p class="muted tiny" style={{ marginTop: 8 }}>
          Auto shows the live poll when one is running, and questions the rest of the time.
        </p>
      </div>
    </>
  );
}

// ---------- questions ----------

function HostQuestion({ q, act }: { q: Question; act: (type: "approve" | "answer" | "archive" | "highlight" | "deleteQuestion", id: string) => void }) {
  return (
    <article class={`q ${q.highlighted ? "hl" : ""}`}>
      <VoteCount q={q} />
      <div class="body">
        {q.highlighted && (
          <span class="tag hl" style={{ marginBottom: 6 }}>
            On the big screen
          </span>
        )}
        <div class="text">{q.text}</div>
        <QuestionMeta q={q} />
        <div class="actions">
          {q.status === "pending" && (
            <button class="btn sm" onClick={() => act("approve", q.id)}>
              Approve
            </button>
          )}
          {q.status !== "archived" && (
            <button class={`btn sm ${q.highlighted ? "on" : "ghost"}`} onClick={() => act("highlight", q.id)}>
              {q.highlighted ? "Remove from screen" : "Show on screen"}
            </button>
          )}
          {(q.status === "live" || q.status === "answered") && (
            <button class="btn sm ghost" onClick={() => act("answer", q.id)}>
              {q.status === "answered" ? "Mark not answered" : "Mark answered"}
            </button>
          )}
          <button class="btn sm ghost" onClick={() => act("archive", q.id)}>
            {q.status === "archived" ? "Restore" : "Archive"}
          </button>
          <button class="btn sm danger" onClick={() => act("deleteQuestion", q.id)}>
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

// ---------- polls ----------

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
  const statusText = p.status === "active" ? "Live now" : p.status === "closed" ? "Closed" : "Not started";
  return (
    <div class={`poll-item ${p.status === "active" ? "active" : ""}`}>
      <div class="spread">
        <span class="row" style={{ gap: 8 }}>
          <span class={`status ${p.status}`}>{statusText}</span>
          <span class="muted small">
            {TYPE_LABEL[p.type]}
            {p.type === "quiz" && (p.timeLimit ? `, ${p.timeLimit}s` : ", no timer")}
            {p.type === "survey" && `, ${p.items.length} questions`}
          </span>
        </span>
        <span class="row" style={{ gap: 4 }}>
          {p.status === "active" && p.type === "quiz" && !p.revealed && <Countdown poll={p} clockOffset={clockOffset} />}
          <button class="btn sm quiet" disabled={first} aria-label="Move up" onClick={() => send({ type: "movePoll", pollId: p.id, dir: "up" })}>
            ↑
          </button>
          <button class="btn sm quiet" disabled={last} aria-label="Move down" onClick={() => send({ type: "movePoll", pollId: p.id, dir: "down" })}>
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
            Close poll
          </button>
        ) : (
          <button class="btn sm accent" onClick={() => send({ type: "activatePoll", pollId: p.id })}>
            {p.status === "closed" ? "Reopen" : "Launch"}
          </button>
        )}
        {p.type === "quiz" ? (
          <button class={`btn sm ${p.revealed ? "on" : "ghost"}`} onClick={() => send({ type: "revealAnswer", pollId: p.id })}>
            {p.revealed ? "Hide answer" : "Reveal answer"}
          </button>
        ) : (
          <button class="btn sm ghost" onClick={() => send({ type: "toggleResults", pollId: p.id })}>
            {p.showResults ? "Hide results from audience" : "Show results to audience"}
          </button>
        )}
        <button class="btn sm ghost" onClick={onEdit}>
          Edit
        </button>
        <button class="btn sm ghost" onClick={() => send({ type: "duplicatePoll", pollId: p.id })}>
          Duplicate
        </button>
        {results.total > 0 && (
          <button class="btn sm ghost" onClick={() => confirmThen("Clear every answer to this poll?", { type: "resetPoll", pollId: p.id })}>
            Clear answers
          </button>
        )}
        <button class="btn sm danger" onClick={() => confirmThen("Delete this poll and its answers?", { type: "deletePoll", pollId: p.id })}>
          Delete
        </button>
      </div>
    </div>
  );
}

// ---------- poll editor ----------

const ALL_TYPES: PollType[] = ["multiple", "quiz", "rating", "scale", "ranking", "wordcloud", "open", "survey"];
const needsOptions = (t: string) => t === "multiple" || t === "quiz" || t === "ranking";

function newItem(type: ItemType = "multiple"): ItemDraft {
  return { type, title: "", options: needsOptions(type) ? ["", ""] : [], images: [], multi: false, range: type === "scale" ? { min: 1, max: 10, minLabel: "", maxLabel: "" } : null };
}
function newDraft(type: PollType): PollDraft {
  return { type, title: "", options: needsOptions(type) ? ["", ""] : [], images: [], correct: [], multi: false, timeLimit: 20, range: { min: 1, max: 10, minLabel: "", maxLabel: "" }, items: [newItem("rating")] };
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
    items: p.items.length ? p.items.map((it) => ({ type: it.type as ItemType, title: it.title, options: [...it.options], images: it.images, multi: it.multi, range: it.range })) : [newItem("rating")],
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
            <label class="check" title="Correct answer">
              <input
                type="checkbox"
                aria-label={`Option ${i + 1} is correct`}
                checked={!!correct?.includes(i)}
                onChange={(e) => onChange({ options, images: imgs, correct: e.currentTarget.checked ? [...(correct ?? []), i] : (correct ?? []).filter((c) => c !== i) })}
              />
            </label>
          )}
          <button type="button" class="img-btn" aria-label={imgs[i] ? `Change image for option ${i + 1}` : `Add image to option ${i + 1}`} onClick={() => (imgs[i] ? onChange({ options, images: imgs.map((x, j) => (j === i ? null : x)), correct }) : pickImage(i))} title={imgs[i] ? "Remove image" : "Add image"}>
            {uploading === i ? "…" : imgs[i] ? <img src={mediaUrl(code, imgs[i]!)} alt="" /> : <Icon.image />}
          </button>
          <input class="input" maxLength={120} placeholder={`Option ${i + 1}`} value={o} aria-label={`Option ${i + 1}`} onInput={(e) => onChange({ options: options.map((x, j) => (j === i ? e.currentTarget.value : x)), images: imgs, correct })} />
          {options.length > 2 && (
            <button type="button" class="btn sm quiet" aria-label={`Remove option ${i + 1}`} onClick={() => remove(i)}>
              <Icon.x />
            </button>
          )}
        </div>
      ))}
      {options.length < 10 && (
        <button type="button" class="btn sm ghost" style={{ marginTop: 10 }} onClick={() => onChange({ options: [...options, ""], images: [...imgs, null], correct })}>
          Add option
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
        From{" "}
        <select class="input" style={{ width: "auto", display: "inline-block" }} value={r.min} onChange={(e) => onChange({ ...r, min: num(e.currentTarget.value) })}>
          {[0, 1].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <label class="small">
        to{" "}
        <select class="input" style={{ width: "auto", display: "inline-block" }} value={r.max} onChange={(e) => onChange({ ...r, max: num(e.currentTarget.value) })}>
          {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <input class="input grow" style={{ flex: "1 1 120px" }} maxLength={30} placeholder="Low end label (optional)" value={r.minLabel} onInput={(e) => onChange({ ...r, minLabel: e.currentTarget.value })} />
      <input class="input grow" style={{ flex: "1 1 120px" }} maxLength={30} placeholder="High end label (optional)" value={r.maxLabel} onInput={(e) => onChange({ ...r, maxLabel: e.currentTarget.value })} />
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
    if (!d.title.trim()) return toast(d.type === "survey" ? "Give the survey a name" : "Type the question");
    if (needsOptions(d.type) && d.options.filter((o, i) => o.trim() || d.images?.[i]).length < 2) return toast("Add at least 2 options");
    if (d.type === "quiz" && !d.correct.length) return toast("Tick the correct answer");
    if (d.type === "survey") {
      if (!items.length) return toast("Add a question to the survey");
      if (items.some((it) => !it.title.trim())) return toast("Every survey question needs text");
    }
    onSave({ ...d, items: d.type === "survey" ? items : [] });
  };

  return (
    <form class="editor stack" onSubmit={save}>
      <div class="spread">
        <b>{d.id ? "Edit poll" : "New poll"}</b>
        <button type="button" class="btn sm quiet" onClick={onCancel} aria-label="Close editor">
          <Icon.x />
        </button>
      </div>
      <div class="type-grid" role="group" aria-label="Poll type">
        {ALL_TYPES.map((t) => (
          <button type="button" key={t} aria-pressed={d.type === t} onClick={() => setType(t)}>
            {TYPE_LABEL[t]}
            <small>{TYPE_HINT[t]}</small>
          </button>
        ))}
      </div>
      <div>
        <label class="label" for="ptitle">
          {d.type === "survey" ? "Survey name" : "Question"}
        </label>
        <input id="ptitle" class="input" maxLength={300} autoFocus value={d.title} onInput={(e) => set({ title: e.currentTarget.value })} placeholder={d.type === "survey" ? "e.g. Session feedback" : "What do you want to ask?"} />
      </div>

      {needsOptions(d.type) && (
        <div>
          <span class="label">{d.type === "quiz" ? "Answers (tick the correct one)" : "Options"}</span>
          <OptionsEditor code={code} hostKey={hostKey} options={d.options} images={d.images ?? []} correct={d.correct} quiz={d.type === "quiz"} onChange={(o) => set({ options: o.options, images: o.images, correct: o.correct ?? d.correct })} />
        </div>
      )}
      {d.type === "multiple" && (
        <label class="check small">
          <input type="checkbox" checked={d.multi} onChange={(e) => set({ multi: e.currentTarget.checked })} /> People can pick more than one
        </label>
      )}
      {d.type === "quiz" && (
        <label class="small row">
          Time to answer
          <select class="input" style={{ width: "auto" }} value={d.timeLimit ?? 20} onChange={(e) => set({ timeLimit: Number(e.currentTarget.value) })}>
            {[0, 10, 15, 20, 30, 45, 60, 90, 120].map((n) => (
              <option key={n} value={n}>
                {n ? `${n} seconds` : "No timer"}
              </option>
            ))}
          </select>
        </label>
      )}
      {d.type === "scale" && <RangeEditor range={d.range} onChange={(range) => set({ range })} />}
      {d.type === "rating" && <p class="muted small">People rate from 1 to 5 stars.</p>}
      {d.type === "ranking" && <p class="muted small">People put the options in order. The big screen shows the overall order.</p>}
      {d.type === "wordcloud" && <p class="muted small">People send short words. The most popular grow biggest.</p>}
      {d.type === "open" && <p class="muted small">People type a short answer. Newest answers show first.</p>}

      {d.type === "survey" && (
        <div>
          <span class="label">Questions</span>
          {items.map((it, i) => (
            <div class="sub-item stack-sm" key={i}>
              <div class="row nowrap">
                <span class="muted small num" style={{ width: 22 }}>
                  {i + 1}.
                </span>
                <select class="input" style={{ width: "auto" }} aria-label={`Question ${i + 1} type`} value={it.type} onChange={(e) => setItem(i, { ...newItem(e.currentTarget.value as ItemType), title: it.title })}>
                  {ITEM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                <span class="grow" />
                <button type="button" class="btn sm quiet" disabled={i === 0} aria-label="Move question up" onClick={() => set({ items: items.map((x, j) => (j === i - 1 ? items[i] : j === i ? items[i - 1] : x)) })}>
                  ↑
                </button>
                <button type="button" class="btn sm quiet" aria-label="Remove question" disabled={items.length === 1} onClick={() => set({ items: items.filter((_, j) => j !== i) })}>
                  <Icon.x />
                </button>
              </div>
              <input class="input" maxLength={300} placeholder="Question" aria-label={`Question ${i + 1}`} value={it.title} onInput={(e) => setItem(i, { title: e.currentTarget.value })} />
              {needsOptions(it.type) && <OptionsEditor code={code} hostKey={hostKey} options={it.options} images={it.images ?? []} onChange={(o) => setItem(i, { options: o.options, images: o.images })} />}
              {it.type === "multiple" && (
                <label class="check small">
                  <input type="checkbox" checked={!!it.multi} onChange={(e) => setItem(i, { multi: e.currentTarget.checked })} /> Allow more than one
                </label>
              )}
              {it.type === "scale" && <RangeEditor range={it.range ?? null} onChange={(range) => setItem(i, { range })} />}
            </div>
          ))}
          {items.length < 15 && (
            <button type="button" class="btn sm ghost" style={{ marginTop: 10 }} onClick={() => set({ items: [...items, newItem("multiple")] })}>
              Add question
            </button>
          )}
        </div>
      )}

      <div class="row">
        <button class="btn">{d.id ? "Save changes" : "Save poll"}</button>
        <button type="button" class="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        {d.id && <span class="muted tiny">Changing the type or options clears existing answers.</span>}
      </div>
    </form>
  );
}

