import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { MAIN_ROOM, POINTS_BUDGET, REACTIONS, type EventInfo, type Item, type Label, type Leaderboard, type Poll, type Question, type ResponseValue, type Results } from "../../shared/protocol";
import { activePoll, resultsOf, secondsLeft, sortQuestions } from "../../shared/store";
import { findSimilar } from "../../shared/similar";
import { useRoom, type Send } from "../lib/room";
import { t, tj, lang } from "../lib/i18n";
import { CFG, fetchEvent, mediaUrl, passcodeFor, plural, savePasscode, store, toast, useTheme, useTitle } from "../lib/util";
import { Board, LabelChip, OfflineBanner, TeamBoard, ConnDot, ConnProblem, Confetti, Countdown, Empty, Icon, PinMap, Podium, QuestionLabels, Replies, whenText, QuestionMeta, ResultsView, TopBar, TYPE_LABEL, useTick } from "../components/ui";

type Tab = "qa" | "polls" | "board";

/** Loads event info first so we know whether a passcode is needed. */
export function Attendee({ code }: { code: string }) {
  const [info, setInfo] = useState<EventInfo | null | undefined>(undefined);
  const [pass, setPass] = useState(() => passcodeFor(code));
  const [wrong, setWrong] = useState(false);
  useEffect(() => {
    fetchEvent(code).then(setInfo);
  }, [code]);
  useTheme(info?.theme);

  if (info === undefined) return <TopBar />;
  if (info === null) return <ConnProblem status="not-found" code={code} />;
  if (info.passcode && !pass) return <PasscodeGate code={code} title={info.title} onDone={setPass} wrong={wrong} />;
  return (
    <Live
      code={code}
      passcode={pass}
      onBadPasscode={() => {
        savePasscode(code, "");
        setWrong(true);
        setPass("");
      }}
    />
  );
}

function PasscodeGate({ code, title, onDone, wrong }: { code: string; title: string; onDone: (p: string) => void; wrong?: boolean }) {
  const [v, setV] = useState("");
  return (
    <>
      <TopBar />
      <form
        class="gate"
        onSubmit={(e) => {
          e.preventDefault();
          if (!v.trim()) return toast(t("Type the passcode"));
          savePasscode(code, v.trim());
          onDone(v.trim());
        }}
      >
        <div class="panel stack">
          <p class="muted">{title}</p>
          <h1>{t("Enter the passcode")}</h1>
          <p class="muted">{t("The host has locked this event. Ask them for the passcode.")}</p>
          {wrong && <p style={{ color: "var(--danger)", fontWeight: 600 }}>{t("That passcode didn't work. Try again.")}</p>}
          <input class="input" aria-label={t("Passcode")} autoFocus autoComplete="off" value={v} onInput={(e) => setV(e.currentTarget.value)} />
          <button class="btn block lg">{t("Join event")}</button>
        </div>
      </form>
    </>
  );
}

function JoinGate({ title, email, send, initialName }: { title: string; email: boolean; send: Send; initialName: string }) {
  const [name, setName] = useState(initialName);
  const [mail, setMail] = useState(() => store.get("rs.email", ""));
  return (
    <>
      <TopBar title={title} />
      <form
        class="gate"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return toast(t("Enter your name"));
          if (email && !mail.trim()) return toast(t("Enter your email"));
          store.set("rs.name", name.trim());
          if (email) store.set("rs.email", mail.trim());
          send({ type: "join", name: name.trim(), ...(email ? { email: mail.trim() } : {}) });
        }}
      >
        <div class="panel stack">
          <h1>{t("Before you join")}</h1>
          <p class="muted">{email ? t("The host asks everyone for their name and email.") : t("The host asks everyone for their name.")}</p>
          <div>
            <label class="label" for="jn">
              {t("Your name")}
            </label>
            <input id="jn" class="input" autoComplete="name" maxLength={40} autoFocus value={name} onInput={(e) => setName(e.currentTarget.value)} />
          </div>
          {email && (
            <div>
              <label class="label" for="je">
                {t("Your email")}
              </label>
              <input id="je" class="input" type="email" autoComplete="email" maxLength={120} value={mail} onInput={(e) => setMail(e.currentTarget.value)} />
              <p class="muted tiny" style={{ marginTop: 6 }}>
                {t("Only the host sees your email.")}
              </p>
            </div>
          )}
          <button class="btn block lg">{t("Continue")}</button>
        </div>
      </form>
    </>
  );
}

function Live({ code, passcode, onBadPasscode }: { code: string; passcode: string; onBadPasscode: () => void }) {
  const { state, status, send } = useRoom(code, "attendee", { passcode: passcode || undefined });
  const [tab, setTab] = useState<Tab>("qa");
  const s = state.snapshot;
  const me = state.me;
  useTheme(s?.meta.settings.theme);
  useTitle(s ? `${s.meta.title} · ${CFG.name}` : CFG.name);

  // Jump to the poll when the host launches one.
  const lastPoll = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = s?.meta.activePollId ?? null;
    if (id && id !== lastPoll.current) {
      // Don't pull people away while they're typing a question.
      const typing = document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement;
      if (typing && lastPoll.current !== undefined) toast(t("A poll just started. Open Polls when you're ready."));
      else setTab("polls");
    }
    lastPoll.current = id;
  }, [s?.meta.activePollId]);

  useEffect(() => {
    if (status === "passcode") onBadPasscode();
  }, [status]);
  if (status === "passcode") return <TopBar />;
  const problem = ConnProblem({ status, code });
  if (problem) return problem;
  if (!s || !me) return <TopBar title={t("Connecting…")} />;
  if (!me.joined) return <JoinGate title={s.meta.title} email={s.meta.settings.identity === "email"} send={send} initialName={store.get("rs.name", "")} />;

  const poll = activePoll(s);
  const showBoard = s.leaderboard.rounds > 0;
  const current: Tab = tab === "board" && !showBoard ? "qa" : tab;

  return (
    <>
      <TopBar title={s.meta.title} logo={s.meta.settings.logo} code={code}>
        <span class="chip code">{code}</span>
        <ConnDot status={status} />
      </TopBar>
      <main class="wrap stack">
        <OfflineBanner status={status} />
        {current === "qa" && <QATab s={s} me={me} send={send} />}
        {s.meta.recapPublic && (
          <a class="notice recap-link" href={`/recap/${s.meta.code}`}>
            {t("The host shared a recap of this event.")} <b>{t("See the recap")}</b>
          </a>
        )}
        {current === "polls" && s.meta.teams.length > 0 && !me.team && poll?.type !== "quiz" && <TeamPicker teams={s.meta.teams} board={s.leaderboard} send={send} quizLive={false} />}
        {current === "polls" && (poll ? (<PollAnswer key={poll.id} code={code} poll={poll} results={resultsOf(s, poll.id)} me={me} clockOffset={state.clockOffset} send={send} />) : <NoPoll />)}
        {current === "polls" && s.meta.teams.length > 0 && !me.team && poll?.type === "quiz" && <TeamPicker teams={s.meta.teams} board={s.leaderboard} send={send} quizLive />}
        {current === "polls" && me.team && <MyTeam team={s.meta.teams.find((x) => x.id === me.team)} />}
        {current === "board" && <BoardTab s={s} me={me} />}
        {s.meta.settings.reactions && current !== "board" && <ReactBar send={send} />}
      </main>
      <nav class="bottom-nav" aria-label={t("Sections")}>
        <button aria-current={current === "qa" ? "page" : undefined} onClick={() => setTab("qa")}>
          <Icon.chat />
          {t("Q&A")}
        </button>
        <button aria-current={current === "polls" ? "page" : undefined} onClick={() => setTab("polls")}>
          <Icon.chart />
          {t("Polls")}
          {poll && current !== "polls" && <span class="pip" role="img" aria-label={t("A poll is live")} />}
        </button>
        {showBoard && (
          <button aria-current={current === "board" ? "page" : undefined} onClick={() => setTab("board")}>
            <Icon.trophy />
            {t("Leaderboard")}
          </button>
        )}
      </nav>
    </>
  );
}

/** Quiz teams: pick one, or let the app balance the teams. */
function TeamPicker({ teams, board, send, quizLive }: { teams: Label[]; board: Leaderboard; send: Send; quizLive: boolean }) {
  const members = new Map((board.teams ?? []).map((x) => [x.id, x.members]));
  return (
    <div class="poll-card team-pick">
      <h2>{t("Pick your team")}</h2>
      <p class="muted small">{quizLive ? t("Answer first if you like: you'll join the smallest team. Or pick one now.") : t("Quizzes in this event are played in teams.")}</p>
      <div class="teams">
        {teams.map((x) => (
          <button key={x.id} class={`team-btn c-${x.color}`} onClick={() => send({ type: "joinTeam", team: x.id })}>
            <span>
              {x.name}
              {members.has(x.id) && <small>{plural(members.get(x.id)!, "player")}</small>}
            </span>
          </button>
        ))}
      </div>
      <button class="btn ghost" onClick={() => send({ type: "joinTeam", team: "auto" })}>
        {t("Pick for me")}
      </button>
    </div>
  );
}

function MyTeam({ team }: { team?: Label }) {
  if (!team) return null;
  return (
    <p class="muted small my-team" style={{ textAlign: "center" }}>
      {tj("You're on {team}", { team: <LabelChip label={team} /> })}
    </p>
  );
}

function NoPoll() {
  return (
    <div class="poll-card">
      <Empty title={t("No poll right now")}>{t("When the host starts one, it shows up here.")}</Empty>
    </div>
  );
}

// ---------- Q&A ----------

let askDraft = "";

/** Arrow keys move between the buttons in a group (stars, scale), like a radio group. */
function arrowKeys(e: KeyboardEvent) {
  const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!dir) return;
  const btns = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const i = btns.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  btns[(i + dir + btns.length) % btns.length].focus();
}

function QATab({ s, me, send }: { s: NonNullable<ReturnType<typeof useRoom>["state"]["snapshot"]>; me: NonNullable<ReturnType<typeof useRoom>["state"]["me"]>; send: Send }) {
  const [sort, setSort] = useState<"popular" | "recent">("popular");
  const [text, setTextState] = useState(askDraft);
  // Kept outside the component, so switching tabs (e.g. when a poll starts) doesn't lose it.
  const setText = (v: string) => {
    askDraft = v;
    setTextState(v);
  };
  const [name, setName] = useState(() => me.name || store.get("rs.name", ""));
  const settings = s.meta.settings;
  const named = settings.identity !== "none";
  const ups = useMemo(() => new Set(me.votes), [me.votes]);
  const downs = useMemo(() => new Set(me.downs), [me.downs]);
  const mine = useMemo(() => new Set(me.questions), [me.questions]);
  const myReplies = useMemo(() => new Set(me.replies), [me.replies]);
  const rooms = s.meta.rooms;
  const [room, setRoom] = useState(() => store.get(`rs.room.${s.meta.code}`, rooms[0]?.id ?? MAIN_ROOM));
  const roomId = rooms.some((r) => r.id === room) ? room : (rooms[0]?.id ?? MAIN_ROOM);
  const pickRoom = (id: string) => {
    setRoom(id);
    store.set(`rs.room.${s.meta.code}`, id);
  };
  const inRoom = rooms.length > 1 ? s.questions.filter((q) => q.room === roomId) : s.questions;
  // Your own questions that wait for approval stay at the top, so you can see they arrived.
  const sorted = sortQuestions(inRoom, sort);
  const questions = [...sorted.filter((q) => q.status === "pending"), ...sorted.filter((q) => q.status !== "pending")];
  const visible = questions.filter((q) => q.status !== "pending").length;
  const waiting = questions.length - visible;
  // After you ask, scroll to your new question and make it flash once.
  const myCount = useRef(me.questions.length);
  useEffect(() => {
    if (me.questions.length > myCount.current) {
      const id = me.questions[me.questions.length - 1];
      requestAnimationFrame(() => {
        const el = document.getElementById(`q-${id}`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("flash");
        setTimeout(() => el.classList.remove("flash"), 1600);
      });
    }
    myCount.current = me.questions.length;
  }, [me.questions.length]);
  // "Already asked?" — similar questions others asked, so people upvote instead of repeating.
  const typed = useDebounced(text, 300);
  const similar = useMemo(
    () => (typed.trim().length < 12 ? [] : findSimilar(typed, inRoom.filter((q) => q.status === "live" && !mine.has(q.id)))),
    [typed, inRoom, mine],
  );

  const ask = (e: Event) => {
    e.preventDefault();
    const msg = text.trim();
    if (!msg) return toast(t("Type your question first"));
    if (!named) store.set("rs.name", name.trim());
    const now = send({ type: "ask", text: msg, name: named ? undefined : name.trim(), room: roomId });
    setText("");
    if (now) toast(settings.moderation ? t("Sent. The host will review it soon.") : t("Question sent"));
  };

  return (
    <>
      {rooms.length > 1 && (
        <div class="room-tabs" role="group" aria-label={t("Q&A rooms")}>
          {rooms.map((r) => (
            <button key={r.id} aria-pressed={r.id === roomId} onClick={() => pickRoom(r.id)}>
              {r.name}
              <span class="count">{s.questions.filter((q) => q.room === r.id && q.status !== "pending").length}</span>
            </button>
          ))}
        </div>
      )}
      {!settings.qaOpen && settings.qaOpensAt && <p class="notice">{t("Questions open at {time}.", { time: whenText(settings.qaOpensAt) })}</p>}
      {settings.qaOpen && settings.qaClosesAt && <p class="notice">{t("Questions close at {time}.", { time: whenText(settings.qaClosesAt) })}</p>}
      {!settings.qaOpen ? (
        <p class="notice">{t("Questions are closed right now. You can still vote on the ones below.")}</p>
      ) : (
      <form class="ask" onSubmit={ask}>
        <label class="sr-only" for="qtext">
          {t("Your question")}
        </label>
        <textarea
          id="qtext"
          class="input"
          maxLength={300}
          placeholder={rooms.length > 1 ? t("Ask a question in {room}", { room: rooms.find((r) => r.id === roomId)?.name ?? "" }) : t("Ask the speaker a question")}
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <div class="row nowrap">
          {named ? (
            <span class="grow muted small">{t("Asking as {name}", { name: me.name })}</span>
          ) : (
            <input
              class="input name grow"
              maxLength={40}
              aria-label={t("Your name")}
              placeholder={settings.allowAnonymous ? t("Your name (optional)") : t("Your name")}
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          )}
          <button class="btn accent" disabled={!text.trim()}>
            {t("Send")}
          </button>
        </div>
        {settings.qaOpen && settings.moderation && <p class="muted tiny" style={{ marginTop: 8 }}>{t("The host reviews questions before they appear.")}</p>}
        {similar.length > 0 && (
          <div class="similar" aria-live="polite">
            <p class="small">
              <b>{t("Already asked?")}</b> <span class="muted">{t("Upvote it instead, and it rises to the top.")}</span>
            </p>
            {similar.map(({ item: q }) => (
              <div class="similar-q" key={q.id}>
                <span class="grow">{q.text}</span>
                <button
                  type="button"
                  class={`btn sm ${ups.has(q.id) ? "on" : "ghost"}`}
                  aria-pressed={ups.has(q.id)}
                  onClick={() => {
                    if (!ups.has(q.id) && send({ type: "vote", id: q.id, dir: 1 })) toast(t("Upvoted. Thanks!"));
                    setText("");
                  }}
                >
                  <Icon.up /> {t("Upvote ({n})", { n: q.votes - q.downs })}
                </button>
              </div>
            ))}
          </div>
        )}
      </form>
      )}

      <div class="spread">
        <b>
          {plural(visible, "question")}
          {waiting > 0 && <span class="muted small"> · {t("{n} of yours waiting for approval", { n: waiting })}</span>}
        </b>
        <div class="seg" role="group" aria-label={t("Sort questions")}>
          {(["popular", "recent"] as const).map((m) => (
            <button key={m} aria-pressed={sort === m} onClick={() => setSort(m)}>
              {m === "popular" ? t("Popular") : t("Recent")}
            </button>
          ))}
        </div>
      </div>

      {questions.length ? (
        <div class="q-list">
          {questions.map((q) => (
            <AttendeeQuestion
              key={q.id}
              q={q}
              up={ups.has(q.id)}
              down={downs.has(q.id)}
              mine={mine.has(q.id)}
              downvotes={settings.allowDownvotes}
              labels={s.meta.labels}
              canReply={settings.audienceReplies && q.status !== "pending" && !mine.has(q.id)}
              myReplies={myReplies}
              defaultName={named ? me.name : name}
              send={send}
            />
          ))}
        </div>
      ) : (
        <div class="poll-card">
          <Empty title={t("No questions yet")}>{t("Ask the first one. Others can upvote it.")}</Empty>
        </div>
      )}
    </>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setV(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return v;
}

function AttendeeQuestion({ q, up, down, mine, downvotes, labels, canReply, myReplies, defaultName, send }: {
  q: Question;
  up: boolean;
  down: boolean;
  mine: boolean;
  downvotes: boolean;
  labels: Label[];
  canReply: boolean;
  myReplies: Set<string>;
  defaultName: string;
  send: Send;
}) {
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(q.text);
  const canEdit = mine && (q.status === "pending" || q.status === "live");
  return (
    <article id={`q-${q.id}`} class={`q ${q.highlighted ? "hl" : ""} ${mine ? "mine" : ""}`}>
      <div class="body">
        {q.highlighted && (
          <span class="tag hl" style={{ marginBottom: 6 }}>
            {t("Now answering")}
          </span>
        )}
        {editing ? (
          <form
            class="stack-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return toast(t("Question can't be empty"));
              send({ type: "editQuestion", id: q.id, text: draft.trim() });
              setEditing(false);
            }}
          >
            <textarea class="input" maxLength={300} value={draft} onInput={(e) => setDraft(e.currentTarget.value)} aria-label={t("Edit your question")} />
            <div class="row">
              <button class="btn sm">{t("Save")}</button>
              <button type="button" class="btn sm ghost" onClick={() => setEditing(false)}>
                {t("Cancel")}
              </button>
            </div>
          </form>
        ) : (
          <div class="text">{q.text}</div>
        )}
        <QuestionMeta q={q} mine={mine} />
        <QuestionLabels q={q} labels={labels} />
        <Replies replies={q.replies} canDelete={(r) => myReplies.has(r.id)} onDelete={(r) => send({ type: "deleteReply", id: q.id, replyId: r.id })} />
        {canReply && !replying && (
          <button class="link-btn" style={{ marginTop: 8 }} onClick={() => setReplying(true)}>
            {t("Reply")}
          </button>
        )}
        {replying && (
          <form
            class="reply-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!reply.trim()) return toast(t("Type a reply first"));
              send({ type: "reply", id: q.id, text: reply.trim(), name: defaultName.trim() || undefined });
              setReply("");
              setReplying(false);
            }}
          >
            <input class="input" maxLength={300} placeholder={t("Write a reply")} aria-label={t("Your reply")} autoFocus value={reply} onInput={(e) => setReply(e.currentTarget.value)} />
            <button class="btn sm">{t("Send")}</button>
            <button type="button" class="btn sm quiet" onClick={() => setReplying(false)}>
              {t("Cancel")}
            </button>
          </form>
        )}
        {mine && !editing && (
          <div class="actions">
            {canEdit && (
              <button
                class="btn sm quiet"
                onClick={() => {
                  setDraft(q.text);
                  setEditing(true);
                }}
              >
                {t("Edit")}
              </button>
            )}
            <button class="btn sm quiet" onClick={() => confirm(t("Withdraw your question?")) && send({ type: "withdraw", id: q.id })}>
              {t("Withdraw")}
            </button>
          </div>
        )}
      </div>
      {q.status !== "pending" && (
        <div class="voter">
          <button class={`vote num ${up ? "on" : ""}`} aria-label={t("Upvote. Score {score}", { score: q.votes - q.downs })} aria-pressed={up} onClick={() => send({ type: "vote", id: q.id, dir: 1 })}>
            <Icon.up />
            <span>{q.votes - q.downs}</span>
          </button>
          {downvotes && (
            <button class={`down ${down ? "on" : ""}`} aria-label={t("Downvote")} aria-pressed={down} onClick={() => send({ type: "vote", id: q.id, dir: -1 })}>
              <Icon.down />
            </button>
          )}
        </div>
      )}
    </article>
  );
}

// ---------- reactions ----------

function ReactBar({ send }: { send: Send }) {
  return (
    <div class="react-bar" role="group" aria-label={t("Send a reaction to the big screen")}>
      {REACTIONS.map((e) => (
        <button key={e} aria-label={t("React {emoji}", { emoji: e })} onClick={() => send({ type: "react", emoji: e })}>
          {e}
        </button>
      ))}
    </div>
  );
}

// ---------- answering polls ----------

/** One question's input. Controlled: the parent decides when to send. */
function ItemInput({ item, code, value, onChange, tiles = false, disabled = false, onPick }: {
  item: Item;
  code: string;
  value: ResponseValue | null;
  onChange: (v: ResponseValue | null) => void;
  tiles?: boolean;
  disabled?: boolean;
  /** Called with the new value for one-tap types (stars, scale, single quiz tile). */
  onPick?: (v: ResponseValue) => void;
}) {
  const choice = item.type === "multiple" || item.type === "quiz";
  if (choice) {
    const sel = Array.isArray(value) ? (value as number[]) : [];
    const hasImages = item.images?.some(Boolean);
    const pick = (i: number) => {
      const next = item.multi ? (sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i]) : [i];
      onChange(next);
      if (!item.multi) onPick?.(next);
    };
    return (
      <>
        {item.multi && <p class="muted small hint">{t("Pick all that apply.")}</p>}
        <div class={`opts ${hasImages ? "images" : ""}`}>
          {item.options.map((o, i) => {
            const img = item.images?.[i];
            return (
              <button
                type="button"
                key={i}
                disabled={disabled}
                class={`opt ${item.multi ? "multi" : ""} ${img ? "img" : ""} ${tiles ? `tile q${i % 8}` : ""}`}
                aria-pressed={sel.includes(i)}
                onClick={() => pick(i)}
              >
                {img && <img src={mediaUrl(code, img)} alt="" loading="lazy" />}
                <span class={img ? "lbl" : "row nowrap"} style={img ? undefined : { gap: 12 }}>
                  {tiles ? <span class="tile-letter" aria-hidden="true">{String.fromCharCode(65 + i)}</span> : <span class="box" />}
                  <span>{o}</span>
                </span>
              </button>
            );
          })}
        </div>
      </>
    );
  }
  if (item.type === "points") {
    const vals = Array.isArray(value) && value.length === item.options.length ? (value as number[]) : item.options.map(() => 0);
    const used = vals.reduce((a, b) => a + b, 0);
    const left = POINTS_BUDGET - used;
    const set = (i: number, n: number) => {
      // Never let one slider push the total past the budget.
      const others = used - vals[i];
      if (n > POINTS_BUDGET - others && left === 0) toast(t("No points left. Lower another option first."));
      onChange(vals.map((v, j) => (j === i ? Math.max(0, Math.min(n, POINTS_BUDGET - others)) : v)));
    };
    return (
      <div class="points-list">
        {item.options.map((o, i) => (
          <label class="points-row" key={i}>
            <span>{o}</span>
            <b>{vals[i]}</b>
            <input type="range" min={0} max={POINTS_BUDGET} step={5} value={vals[i]} disabled={disabled} aria-label={t("Points for {option}", { option: o })} onInput={(e) => set(i, Number(e.currentTarget.value))} />
          </label>
        ))}
        <div class={`points-left ${left < 0 ? "over" : ""}`} aria-live="polite">
          <span>{t("Points left")}</span>
          <span class="num">{left}</span>
        </div>
      </div>
    );
  }
  if (item.type === "grid") {
    const r = item.range ?? { min: 1, max: 10 };
    const mid = Math.round((r.min + r.max) / 2);
    const vals = Array.isArray(value) && value.length === item.options.length ? (value as [number, number][]) : item.options.map(() => [mid, mid] as [number, number]);
    const [ax, ay] = item.axes ?? ["X", "Y"];
    const set = (i: number, k: 0 | 1, n: number) => onChange(vals.map((xy, j) => (j === i ? ((k ? [xy[0], n] : [n, xy[1]]) as [number, number]) : xy)));
    return (
      <div class="grid-answer">
        <p class="muted small">
          {t("Score each option from {min} to {max}.", { min: r.min, max: r.max })}
        </p>
        {item.options.map((o, i) => (
          <fieldset key={i}>
            <legend>{o}</legend>
            {([0, 1] as const).map((k) => (
              <label key={k}>
                {k ? ay : ax}
                <input type="range" min={r.min} max={r.max} value={vals[i][k]} disabled={disabled} onInput={(e) => set(i, k, Number(e.currentTarget.value))} />
                <b>{vals[i][k]}</b>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
    );
  }
  if (item.type === "pin") {
    const xy = Array.isArray(value) && value.length === 2 && typeof value[0] === "number" ? (value as unknown as [number, number]) : null;
    const tap = (e: MouseEvent) => {
      if (disabled) return;
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const p: [number, number] = [Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), Math.min(1, Math.max(0, (e.clientY - box.top) / box.height))];
      onChange(p as unknown as ResponseValue);
      onPick?.(p as unknown as ResponseValue);
    };
    // Keyboard: arrows move the pin (Shift = bigger steps).
    const key = (e: KeyboardEvent) => {
      const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const m = d[e.key];
      if (!m || disabled) return;
      e.preventDefault();
      const step = e.shiftKey ? 0.1 : 0.02;
      const cur = xy ?? [0.5, 0.5];
      const clamp = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
      onChange([clamp(cur[0] + m[0] * step), clamp(cur[1] + m[1] * step)] as unknown as ResponseValue);
    };
    return item.image ? (
      <div>
        <p class="muted small" style={{ marginBottom: 8 }}>
          {t("Tap the picture to place your pin, then press the button below.")}
        </p>
        <div
          class="pin-wrap pin-tap"
          onClick={tap}
          onKeyDown={key}
          tabIndex={disabled ? -1 : 0}
          role="application"
          aria-label={t("Picture to place your pin on. Use the arrow keys to move the pin.")}
          aria-describedby="pin-pos"
        >
          <img src={mediaUrl(code, item.image)} alt={t("Picture to place your pin on")} />
          <span id="pin-pos" class="sr-only" aria-live="polite">
            {xy ? t("Pin at {x}% across, {y}% down", { x: Math.round(xy[0] * 100), y: Math.round(xy[1] * 100) }) : t("No pin yet")}
          </span>
          {xy && <i class="pin-dot mine" style={{ left: `${xy[0] * 100}%`, top: `${xy[1] * 100}%` }} />}
        </div>
      </div>
    ) : null;
  }
  if (item.type === "rating") {
    const v = typeof value === "number" ? value : 0;
    return (
      <div class="stars" role="radiogroup" aria-label={t("Rating")} onKeyDown={arrowKeys}>
        {Array.from({ length: item.scale || 5 }, (_, i) => (
          <button
            type="button"
            key={i}
            role="radio"
            aria-checked={v === i + 1}
            disabled={disabled}
            class={`star ${i < v ? "on" : ""}`}
            aria-label={plural(i + 1, "star")}
            onClick={() => {
              onChange(i + 1);
              onPick?.(i + 1);
            }}
          >
            ★
          </button>
        ))}
      </div>
    );
  }
  if (item.type === "scale") {
    const r = item.range ?? { min: 1, max: 10, minLabel: "", maxLabel: "" };
    const nums = Array.from({ length: r.max - r.min + 1 }, (_, i) => r.min + i);
    return (
      <div>
        <div class={`scale ${nums.length > 7 ? "many" : ""}`} role="radiogroup" aria-label={t("Scale")} onKeyDown={arrowKeys}>
          {nums.map((n) => (
            <button
              type="button"
              key={n}
              role="radio"
              aria-checked={value === n}
              disabled={disabled}
              onClick={() => {
                onChange(n);
                onPick?.(n);
              }}
            >
              {n}
            </button>
          ))}
        </div>
        {(r.minLabel || r.maxLabel) && (
          <div class="scale-ends">
            <span>{r.minLabel}</span>
            <span>{r.maxLabel}</span>
          </div>
        )}
      </div>
    );
  }
  if (item.type === "ranking") {
    const order = Array.isArray(value) && value.length === item.options.length ? (value as number[]) : item.options.map((_, i) => i);
    const move = (pos: number, d: -1 | 1) => {
      const next = [...order];
      [next[pos], next[pos + d]] = [next[pos + d], next[pos]];
      onChange(next);
    };
    return (
      <div>
        <p class="muted small" style={{ marginBottom: 10 }}>
          {t("Put your favourite at the top. Use the arrows to move options.")}
        </p>
        <ol class="rank-list" style={{ padding: 0, margin: 0, listStyle: "none" }}>
          {order.map((opt, pos) => (
            <li class="rank-item" key={opt}>
              <span class="pos">{pos + 1}</span>
              {item.images?.[opt] && <img src={mediaUrl(code, item.images[opt]!)} alt="" />}
              <span class="grow">{item.options[opt]}</span>
              <span class="moves">
                <button type="button" class="btn sm ghost" disabled={disabled || pos === 0} aria-label={t("Move {option} up", { option: item.options[opt] })} onClick={() => move(pos, -1)}>
                  ↑
                </button>
                <button type="button" class="btn sm ghost" disabled={disabled || pos === order.length - 1} aria-label={t("Move {option} down", { option: item.options[opt] })} onClick={() => move(pos, 1)}>
                  ↓
                </button>
              </span>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (item.type === "wordcloud")
    return <input class="input" maxLength={30} placeholder={t("A word or short phrase")} aria-label={t("Your word")} disabled={disabled} value={typeof value === "string" ? value : ""} onInput={(e) => onChange(e.currentTarget.value)} />;
  if (item.type === "open")
    return <textarea class="input" maxLength={200} placeholder={t("Your answer")} aria-label={t("Your answer")} disabled={disabled} value={typeof value === "string" ? value : ""} onInput={(e) => onChange(e.currentTarget.value)} />;
  return null;
}

/** True when an item's draft value can be sent. */
const ready = (item: Item, v: ResponseValue | null) => {
  if (item.type === "points") return Array.isArray(v) && (v as number[]).some((n) => n > 0);
  if (item.type === "grid") return true; // sliders always have a value
  return v !== null && v !== "" && !(Array.isArray(v) && !v.length) && !(typeof v === "string" && !v.trim());
};

/** Converts a draft value to what the server expects. */
const toWire = (item: Item, v: ResponseValue | null): ResponseValue | null => {
  // A 2×2 grid needs at least one slider moved, so an untouched grid isn't sent as fake answers.
  if (item.type === "grid" && !Array.isArray(v)) return null;
  if (!ready(item, v)) return item.type === "ranking" ? item.options.map((_, i) => i) : null;
  if (item.type === "wordcloud") return [String(v).trim()];
  if (item.type === "open") return String(v).trim();
  return v;
};

function PollAnswer({ code, poll, results, me, clockOffset, send }: { code: string; poll: Poll; results: Results; me: NonNullable<ReturnType<typeof useRoom>["state"]["me"]>; clockOffset: number; send: Send }) {
  const mine = me.responses[poll.id] ?? null;
  if (poll.type === "survey") return <SurveyAnswer key={poll.type} code={code} poll={poll} results={results} mine={mine as (ResponseValue | null)[] | null} send={send} />;
  if (poll.type === "quiz") return <QuizAnswer key={poll.type} code={code} poll={poll} results={results} mine={mine as number[] | null} me={me} clockOffset={clockOffset} send={send} />;
  return <SimpleAnswer key={poll.type} code={code} poll={poll} results={results} mine={mine} send={send} />;
}

function SimpleAnswer({ code, poll, results, mine, send }: { code: string; poll: Poll; results: Results; mine: ResponseValue | null; send: Send }) {
  const answered = mine !== null;
  const item = poll as unknown as Item;
  const freeText = poll.type === "wordcloud" || poll.type === "open";
  const oneTap = poll.type === "rating" || poll.type === "scale" || (poll.type === "multiple" && !poll.multi);
  // Free-text answers show what you sent, so you can see and change it (one answer per person).
  const asText = (m: ResponseValue | null) => (Array.isArray(m) ? String(m[0] ?? "") : typeof m === "string" ? m : "");
  const [draft, setDraft] = useState<ResponseValue | null>(freeText ? asText(mine) : mine);
  const [movingPin, setMovingPin] = useState(false);
  const pinDone = poll.type === "pin" && answered && !movingPin;
  useEffect(() => {
    if (!freeText) setDraft(mine);
    else if (mine !== null) setDraft(asText(mine));
  }, [JSON.stringify(mine)]);

  const submit = (v = draft) => {
    const wire = toWire(item, v);
    if (wire === null) return toast(freeText ? t("Type something first") : poll.type === "grid" ? t("Move the sliders to place each option") : poll.type === "pin" ? t("Tap the picture to place your pin") : t("Pick an answer first"));
    send({ type: "respond", pollId: poll.id, value: wire });
    if (poll.type === "pin") setMovingPin(false);
  };

  return (
    <div class="poll-card">
      <div class="spread">
        <span class="tag live">{t("Live")}</span>
        <span class="muted small">{TYPE_LABEL[poll.type]}</span>
      </div>
      <h2>{poll.title}</h2>
      {oneTap && !answered && <p class="muted small hint">{t("Tap an answer to vote. You can change it.")}</p>}
      {!pinDone && (
        <ItemInput
          item={item}
          code={code}
          value={draft}
          onChange={setDraft}
          onPick={oneTap ? (v) => submit(v) : undefined}
        />
      )}
      {!oneTap && !pinDone && (
        <div class="row" style={{ marginTop: 14 }}>
          <button class="btn accent block lg" onClick={() => submit()}>
            {poll.type === "pin" ? t("Drop my pin here") : answered ? t("Update answer") : t("Send")}
          </button>
        </div>
      )}
      {answered && (
        <p class="saved-note small" role="status">
          ✓ {freeText ? t("Answer saved. You can change it.") : poll.type === "pin" ? t("Pin dropped.") : oneTap ? t("Answer saved. Tap again to change it.") : t("Answer saved.")}
        </p>
      )}
      {answered && (
        <div style={{ marginTop: 20 }}>
          {poll.type === "pin" ? (
            pinDone && (
              <>
                {poll.image && (
                  <PinMap src={mediaUrl(code, poll.image)} pins={results.pins ?? []} big={false} mine={mine as unknown as [number, number]} />
                )}
                {!results.pins && <p class="muted small">{t("The host is keeping other people's pins hidden for now.")}</p>}
                <button class="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setMovingPin(true)}>
                  {t("Move my pin")}
                </button>
              </>
            )
          ) : (
            <ResultsView poll={poll} results={results} code={code} />
          )}
        </div>
      )}
    </div>
  );
}

function QuizAnswer({ code, poll, results, mine, me, clockOffset, send }: { code: string; poll: Poll; results: Results; mine: number[] | null; me: NonNullable<ReturnType<typeof useRoom>["state"]["me"]>; clockOffset: number; send: Send }) {
  const [draft, setDraft] = useState<ResponseValue | null>(mine);
  const left = secondsLeft(poll, clockOffset);
  useTick(left !== null && left > 0);
  const timeUp = left === 0;
  const answered = mine !== null;
  const locked = answered || timeUp || poll.revealed;
  const right = poll.revealed && poll.correct && mine ? poll.correct.length === mine.length && poll.correct.every((c) => mine.includes(c)) : null;
  const submit = (v: ResponseValue | null = draft) => {
    if (!Array.isArray(v) || !v.length) return toast(t("Pick an answer first"));
    send({ type: "respond", pollId: poll.id, value: v });
  };

  return (
    <div class="poll-card">
      <div class="spread">
        <span class="tag live">{t("Quiz")}</span>
        {!poll.revealed && <Countdown poll={poll} clockOffset={clockOffset} />}
      </div>
      <h2>{poll.title}</h2>
      {poll.revealed ? (
        <div class="stack">
          <Confetti fire={right ? poll.id : null} />
          <div class={`verdict ${right ? "right" : "wrong"}`}>
            <span class="big">{right ? t("Correct!") : mine ? t("Not this time") : t("No answer")}</span>
            {right && me.quiz?.last ? <span class="num">+{plural(me.quiz.last, "point")}</span> : null}
          </div>
          {me.quiz && (
            <p class="muted">
              {mine
              ? tj("You're {rank} of {players} with {points}.", { rank: <b>#{me.quiz.rank}</b>, players: me.quiz.players.toLocaleString(lang), points: plural(me.quiz.points, "point") })
              : tj("No answer this round. You're {rank} of {players} overall.", { rank: <b>#{me.quiz.rank}</b>, players: me.quiz.players.toLocaleString(lang) })}
            </p>
          )}
          {mine && !right && poll.correct && (
            <p class="muted small">{t("The right answer: {answer}", { answer: poll.correct.map((c) => poll.options[c]).join(", ") })}</p>
          )}
          <ResultsView poll={poll} results={results} code={code} mine={mine ?? undefined} />
        </div>
      ) : (
        <>
          <ItemInput item={poll as unknown as Item} code={code} value={draft} onChange={setDraft} tiles disabled={locked} onPick={!poll.multi ? (v) => submit(v) : undefined} />
          {poll.multi && !locked && (
            <button class="btn accent block" style={{ marginTop: 12 }} onClick={() => submit()}>
              {t("Lock in answer")}
            </button>
          )}
          <p class="muted" style={{ marginTop: 14, textAlign: "center" }}>
            {answered ? t("Answer locked in. Wait for the reveal…") : timeUp ? t("Time's up! Wait for the reveal…") : t("Faster correct answers score more points.")}
          </p>
          {/* Asked after answering, so it never uses up quiz time. */}
          {!me.name && answered && <Nickname send={send} />}
        </>
      )}
    </div>
  );
}

/** Lets quiz players pick the name shown on the leaderboard. */
function Nickname({ send }: { send: Send }) {
  const [v, setV] = useState(() => store.get("rs.name", ""));
  return (
    <form
      class="nickname"
      onSubmit={(e) => {
        e.preventDefault();
        if (!v.trim()) return toast(t("Type a name"));
        store.set("rs.name", v.trim());
        send({ type: "join", name: v.trim() });
      }}
    >
      <label class="small grow" for="nick" style={{ flexBasis: "100%" }}>
        {t("Your name on the leaderboard")}
      </label>
      <input id="nick" class="input" maxLength={40} value={v} onInput={(e) => setV(e.currentTarget.value)} />
      <button class="btn sm">{t("Save")}</button>
    </form>
  );
}

function SurveyAnswer({ code, poll, results, mine, send }: { code: string; poll: Poll; results: Results; mine: (ResponseValue | null)[] | null; send: Send }) {
  const n = poll.items.length;
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<(ResponseValue | null)[]>(() => mine ?? poll.items.map(() => null));
  const [editing, setEditing] = useState(!mine);
  const item = poll.items[step];

  const finish = () => {
    const wire = poll.items.map((it, i) => toWire(it, answers[i]));
    if (wire.every((x) => x === null)) return toast(t("Answer at least one question"));
    send({ type: "respond", pollId: poll.id, value: wire as ResponseValue });
    setEditing(false);
  };

  if (!editing && mine)
    return (
      <div class="poll-card stack">
        <span class="tag live">{t("Survey")}</span>
        <h2>{t("Thanks for your answers!")}</h2>
        <button class="btn ghost" onClick={() => (setStep(0), setEditing(true))}>
          {t("Change my answers")}
        </button>
        <ResultsView poll={poll} results={results} code={code} />
      </div>
    );

  return (
    <div class="poll-card">
      <div class="spread">
        <span class="tag live">{t("Survey")}</span>
        <span class="muted small num">
          {t("Question {n} of {total}", { n: step + 1, total: n })}
        </span>
      </div>
      <div class="survey-progress" style={{ marginTop: 12 }} aria-hidden="true">
        {poll.items.map((_, i) => (
          <span key={i} class={i <= step ? "done" : ""} />
        ))}
      </div>
      <p class="muted small" style={{ marginTop: 14 }}>
        {poll.title}
      </p>
      <h2 style={{ marginTop: 4 }}>{item.title}</h2>
      <ItemInput key={step} item={item} code={code} value={answers[step]} onChange={(v) => setAnswers(answers.map((a, i) => (i === step ? v : a)))} />
      <div class="spread" style={{ marginTop: 18 }}>
        <button class="btn ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
          {t("Back")}
        </button>
        {step < n - 1 ? (
          <button class="btn" onClick={() => setStep(step + 1)}>
            {ready(item, answers[step]) ? t("Next") : t("Skip")}
          </button>
        ) : (
          <button class="btn accent" onClick={finish}>
            {t("Submit")}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- leaderboard ----------

function BoardTab({ s, me }: { s: NonNullable<ReturnType<typeof useRoom>["state"]["snapshot"]>; me: NonNullable<ReturnType<typeof useRoom>["state"]["me"]> }) {
  const lb = s.leaderboard;
  const beat = me.quiz && lb.players >= 5 ? Math.round(((lb.players - me.quiz.rank) / (lb.players - 1)) * 100) : null;
  return (
    <>
      {me.quiz ? (
        <div class="me-score">
          <div>
            <div class="big num">#{me.quiz.rank}</div>
            <div class="small">{t("of {players}", { players: me.quiz.players })}</div>
          </div>
          <div>
            <b class="num">{plural(me.quiz.points, "point")}</b>
            {beat !== null && beat > 0 && <div class="small">{t("You're ahead of {percent}% of players", { percent: beat })}</div>}
          </div>
        </div>
      ) : (
        <div class="poll-card">
          <Empty title={t("Not on the board yet")}>{t("Answer a quiz question to get points.")}</Empty>
        </div>
      )}
      <div class="poll-card stack">
        <h2>{t("Leaderboard")}</h2>
        <p class="muted small">{t("{questions} revealed so far.", { questions: plural(lb.rounds, "question") })}</p>
        {lb.teams && lb.teams.length > 0 && (
          <>
            <h3>{t("Teams")}</h3>
            <TeamBoard teams={lb.teams} mine={me.team} />
            <h3>{t("Players")}</h3>
          </>
        )}
        <Podium board={lb} />
        <Board board={lb} afterPodium teams={s.meta.teams} />
      </div>
    </>
  );
}

