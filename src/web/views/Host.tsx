import { useState } from "preact/hooks";
import type { ClientMsg, Poll, PollDraft, Question } from "../../shared/protocol";
import { resultsOf, sortQuestions } from "../../shared/store";
import { useRoom } from "../lib/room";
import { CFG, joinUrl, rememberHosted, toast, useTitle } from "../lib/util";
import { ConnProblem, Empty, QuestionMeta, ResultsView, TopBar, TYPE_LABEL, VoteCount } from "../components/ui";

type QTab = "live" | "pending" | "answered" | "archived";
const Q_TABS: [QTab, string][] = [
  ["live", "Live"],
  ["pending", "Review"],
  ["answered", "Answered"],
  ["archived", "Archived"],
];
const EMPTY_TEXT: Record<QTab, string> = {
  live: "No live questions yet.",
  pending: "Nothing to review.",
  answered: "Nothing marked answered yet.",
  archived: "Nothing archived.",
};

export function Host({ code }: { code: string }) {
  const key = decodeURIComponent(location.hash.slice(1));
  const { state, status, send } = useRoom(code, "host", key);
  const [qTab, setQTab] = useState<QTab>("live");
  const [editing, setEditing] = useState<PollDraft | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const s = state.snapshot;
  useTitle(s ? `Host · ${s.meta.title}` : CFG.name);

  if (!key || status === "forbidden") return <ConnProblem status="forbidden" code={code} />;
  if (status === "not-found") return <ConnProblem status={status} code={code} />;
  if (s) rememberHosted({ code, key, title: s.meta.title, ts: Date.now() });

  const copy = (txt: string, msg: string) =>
    navigator.clipboard?.writeText(txt).then(
      () => toast(msg),
      () => prompt("Copy this:", txt),
    );

  const by: Record<QTab, Question[]> = { live: [], pending: [], answered: [], archived: [] };
  s?.questions.forEach((q) => by[q.status].push(q));
  const showReview = !!s && (s.meta.settings.moderation || by.pending.length > 0);
  const tab = qTab === "pending" && !showReview ? "live" : qTab;
  const list = sortQuestions(by[tab], "popular");

  const qAct = (type: Extract<ClientMsg, { id: string }>["type"], id: string) => {
    if (type === "deleteQuestion" && !confirm("Delete this question?")) return;
    send({ type, id });
  };

  return (
    <>
      <TopBar title={s?.meta.title}>
        <span class="chip">#{code}</span>
        <span class="chip">
          <span class={`dot ${status === "online" ? "" : "off"}`} />
          <span>{s?.online ?? 0}</span> online
        </span>
        <a class="btn sm accent" href={`/present/${code}#${key}`} target="_blank" rel="noopener">
          Present ↗
        </a>
      </TopBar>
      <div class="wrap wide stack">
        <div class="card row">
          <input
            class="input grow"
            maxLength={120}
            aria-label="Event title"
            style={{ flex: "1 1 260px", fontWeight: 600 }}
            value={titleDraft ?? s?.meta.title ?? ""}
            onInput={(e) => setTitleDraft(e.currentTarget.value)}
            onBlur={() => {
              if (titleDraft !== null && titleDraft !== s?.meta.title) send({ type: "setTitle", title: titleDraft });
              setTitleDraft(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          <span class="muted small">
            Join at <b>{location.host}</b> with code <b>{code}</b>
          </span>
          <button class="btn sm ghost" onClick={() => copy(joinUrl(code), "Join link copied")}>
            Copy join link
          </button>
          <button class="btn sm ghost" onClick={() => copy(location.href, "Host link copied — keep it private")}>
            Copy host link
          </button>
          <a class="btn sm ghost" href={`/api/events/${code}/export?key=${encodeURIComponent(key)}`}>
            Export CSV
          </a>
        </div>

        <div class="grid2">
          <section class="card stack">
            <div class="row">
              <h2 class="grow">Q&amp;A</h2>
              {(
                [
                  ["qaOpen", "Open"],
                  ["moderation", "Review first"],
                  ["allowAnonymous", "Allow anonymous"],
                ] as const
              ).map(([k, label]) => (
                <label class="check small" key={k}>
                  <input type="checkbox" checked={!!s?.meta.settings[k]} onChange={(e) => send({ type: "setSettings", settings: { [k]: e.currentTarget.checked } })} /> {label}
                </label>
              ))}
            </div>
            <div class="tabs">
              {Q_TABS.filter(([k]) => k !== "pending" || showReview).map(([k, label]) => (
                <button key={k} class={`tab ${tab === k ? "active" : ""}`} onClick={() => setQTab(k)}>
                  {label}
                  {by[k].length > 0 && (
                    <span class="badge" style={k === "pending" ? undefined : { background: "#dfe4ee" }}>
                      {by[k].length}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div>
              {list.length ? list.map((q) => <HostQuestion key={q.id} q={q} act={qAct} />) : <Empty>{s ? EMPTY_TEXT[tab] : "Connecting…"}</Empty>}
            </div>
          </section>

          <section class="card stack">
            <div class="row">
              <h2 class="grow">Polls</h2>
              <button class="btn sm" onClick={() => setEditing({ type: "multiple", title: "", options: ["", ""], correct: [], multi: false })}>
                + New poll
              </button>
            </div>
            <div class="row small">
              <span class="muted">Big screen shows:</span>
              {(
                [
                  ["auto", "Auto"],
                  ["qa", "Q&A"],
                  ["poll", "Poll"],
                  ["code", "Join code"],
                ] as const
              ).map(([m, label]) => (
                <button key={m} class={`btn sm ${s?.meta.presentMode === m ? "on" : "ghost"}`} onClick={() => send({ type: "setPresentMode", mode: m })}>
                  {label}
                </button>
              ))}
            </div>
            {editing && (
              <PollEditor
                draft={editing}
                onCancel={() => setEditing(null)}
                onSave={(poll) => {
                  send({ type: "savePoll", poll });
                  setEditing(null);
                }}
              />
            )}
            <div>
              {s && s.polls.length ? (
                s.polls.map((p, i) => (
                  <HostPoll
                    key={p.id}
                    poll={p}
                    first={i === 0}
                    last={i === s.polls.length - 1}
                    results={resultsOf(s, p.id)}
                    send={send}
                    onEdit={() => setEditing({ id: p.id, type: p.type, title: p.title, options: [...p.options], correct: [...(p.correct ?? [])], multi: p.multi })}
                  />
                ))
              ) : (
                <Empty>No polls yet. Create one before class, then launch it live.</Empty>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function HostQuestion({ q, act }: { q: Question; act: (type: "approve" | "answer" | "archive" | "highlight" | "deleteQuestion", id: string) => void }) {
  return (
    <div class={`q ${q.highlighted ? "hl" : ""}`}>
      <VoteCount votes={q.votes} />
      <div class="body">
        <div class="text">{q.text}</div>
        <div class="meta">
          <QuestionMeta q={{ ...q, status: q.status === "answered" ? "live" : q.status }} />
          {q.highlighted && <span class="tag hl">On screen</span>}
        </div>
        <div class="actions">
          {q.status === "pending" && (
            <button class="btn sm" onClick={() => act("approve", q.id)}>
              Approve
            </button>
          )}
          {q.status !== "archived" && (
            <button class={`btn sm ${q.highlighted ? "on" : "ghost"}`} onClick={() => act("highlight", q.id)}>
              {q.highlighted ? "Unhighlight" : "Highlight"}
            </button>
          )}
          {(q.status === "live" || q.status === "answered") && (
            <button class="btn sm ghost" onClick={() => act("answer", q.id)}>
              {q.status === "answered" ? "Mark unanswered" : "Mark answered"}
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
    </div>
  );
}

function HostPoll({
  poll: p,
  results,
  first,
  last,
  send,
  onEdit,
}: {
  poll: Poll;
  results: ReturnType<typeof resultsOf>;
  first: boolean;
  last: boolean;
  send: (m: ClientMsg) => void;
  onEdit: () => void;
}) {
  const confirmThen = (msg: string, m: ClientMsg) => confirm(msg) && send(m);
  return (
    <div class={`poll-item ${p.status === "active" ? "active" : ""}`}>
      <div class="row">
        <span class={`status ${p.status}`}>{p.status === "active" ? "● Live" : p.status}</span>
        <span class="muted small grow">{TYPE_LABEL[p.type]}</span>
        <button class="btn sm ghost" disabled={first} aria-label="Move up" onClick={() => send({ type: "movePoll", pollId: p.id, dir: "up" })}>
          ↑
        </button>
        <button class="btn sm ghost" disabled={last} aria-label="Move down" onClick={() => send({ type: "movePoll", pollId: p.id, dir: "down" })}>
          ↓
        </button>
      </div>
      <h3 style={{ margin: "6px 0 4px", fontFamily: "var(--sans)", fontSize: 17 }}>{p.title}</h3>
      {p.status !== "draft" ? <ResultsView poll={p} results={results} /> : <p class="muted small">{p.options.join(" · ")}</p>}
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
        <button class="btn sm ghost" onClick={() => send({ type: "toggleResults", pollId: p.id })}>
          {p.showResults ? "Hide results from audience" : "Show results to audience"}
        </button>
        {p.type === "quiz" && (
          <button class="btn sm ghost" onClick={() => send({ type: "revealAnswer", pollId: p.id })}>
            {p.revealed ? "Hide answer" : "Reveal answer"}
          </button>
        )}
        <button class="btn sm ghost" onClick={onEdit}>
          Edit
        </button>
        {results.total > 0 && (
          <button class="btn sm ghost" onClick={() => confirmThen("Clear all responses to this poll?", { type: "resetPoll", pollId: p.id })}>
            Reset
          </button>
        )}
        <button class="btn sm danger" onClick={() => confirmThen("Delete this poll and its results?", { type: "deletePoll", pollId: p.id })}>
          Delete
        </button>
      </div>
    </div>
  );
}

function PollEditor({ draft, onSave, onCancel }: { draft: PollDraft; onSave: (p: PollDraft) => void; onCancel: () => void }) {
  const [d, setD] = useState<PollDraft>(draft);
  const hasOpts = d.type === "multiple" || d.type === "quiz";
  const set = (patch: Partial<PollDraft>) => setD({ ...d, ...patch });

  const save = (e: Event) => {
    e.preventDefault();
    if (!d.title.trim()) return toast("Add a question");
    if (hasOpts && d.options.filter((o) => o.trim()).length < 2) return toast("Add at least 2 options");
    if (d.type === "quiz" && !d.correct.length) return toast("Tick the correct answer");
    onSave(d);
  };
  const removeOpt = (i: number) =>
    set({ options: d.options.filter((_, j) => j !== i), correct: d.correct.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c)) });

  return (
    <form class="poll-item stack" style={{ background: "#f8fafd" }} onSubmit={save}>
      <div class="row">
        <b class="grow">{d.id ? "Edit poll" : "New poll"}</b>
        <select
          class="input"
          style={{ width: "auto" }}
          aria-label="Poll type"
          value={d.type}
          onChange={(e) => {
            const type = e.currentTarget.value as PollDraft["type"];
            set({ type, options: (type === "multiple" || type === "quiz") && d.options.length < 2 ? ["", ""] : d.options });
          }}
        >
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <input class="input" maxLength={300} placeholder="Your question" autoFocus value={d.title} onInput={(e) => set({ title: e.currentTarget.value })} />
      {hasOpts && (
        <>
          <div>
            {d.options.map((o, i) => (
              <div class="row" style={{ marginTop: 6 }} key={i}>
                {d.type === "quiz" && (
                  <label class="check small" title="Correct answer">
                    <input
                      type="checkbox"
                      checked={d.correct.includes(i)}
                      onChange={(e) => set({ correct: e.currentTarget.checked ? [...d.correct, i] : d.correct.filter((c) => c !== i) })}
                    />
                    ✓
                  </label>
                )}
                <input
                  class="input grow"
                  maxLength={120}
                  placeholder={`Option ${i + 1}`}
                  value={o}
                  onInput={(e) => set({ options: d.options.map((x, j) => (j === i ? e.currentTarget.value : x)) })}
                />
                {d.options.length > 2 && (
                  <button type="button" class="btn sm ghost" aria-label="Remove option" onClick={() => removeOpt(i)}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          <div class="row">
            {d.options.length < 10 && (
              <button type="button" class="btn sm ghost" onClick={() => set({ options: [...d.options, ""] })}>
                + Add option
              </button>
            )}
            {d.type === "multiple" && (
              <label class="check small">
                <input type="checkbox" checked={d.multi} onChange={(e) => set({ multi: e.currentTarget.checked })} /> Allow more than one answer
              </label>
            )}
            {d.type === "quiz" && <span class="muted small">Tick the correct answer(s)</span>}
          </div>
        </>
      )}
      {d.type === "rating" && <p class="muted small">People rate from 1 to 5 stars.</p>}
      {d.type === "wordcloud" && <p class="muted small">People send short words. Popular words grow bigger.</p>}
      {d.type === "open" && <p class="muted small">People type a short free-text answer.</p>}
      <div class="row">
        <button class="btn">Save poll</button>
        <button type="button" class="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
