import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { REACTIONS, type EventInfo, type Item, type Poll, type Question, type ResponseValue, type Results } from "../../shared/protocol";
import { activePoll, resultsOf, secondsLeft, sortQuestions } from "../../shared/store";
import { useRoom, type Send } from "../lib/room";
import { CFG, fetchEvent, mediaUrl, passcodeFor, plural, savePasscode, store, toast, useTheme, useTitle } from "../lib/util";
import { Board, ConnDot, ConnProblem, Confetti, Countdown, Empty, Icon, Podium, QuestionMeta, ResultsView, TopBar, TYPE_LABEL, useTick } from "../components/ui";

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
          if (!v.trim()) return toast("Type the passcode");
          savePasscode(code, v.trim());
          onDone(v.trim());
        }}
      >
        <div class="panel stack">
          <p class="muted">{title}</p>
          <h1>Enter the passcode</h1>
          <p class="muted">The host has locked this event. Ask them for the passcode.</p>
          {wrong && <p style={{ color: "var(--danger)", fontWeight: 600 }}>That passcode didn't work. Try again.</p>}
          <input class="input" aria-label="Passcode" autoFocus autoComplete="off" value={v} onInput={(e) => setV(e.currentTarget.value)} />
          <button class="btn block lg">Join event</button>
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
          if (!name.trim()) return toast("Enter your name");
          if (email && !mail.trim()) return toast("Enter your email");
          store.set("rs.name", name.trim());
          if (email) store.set("rs.email", mail.trim());
          send({ type: "join", name: name.trim(), ...(email ? { email: mail.trim() } : {}) });
        }}
      >
        <div class="panel stack">
          <h1>Before you join</h1>
          <p class="muted">{email ? "The host asks everyone for their name and email." : "The host asks everyone for their name."}</p>
          <div>
            <label class="label" for="jn">
              Your name
            </label>
            <input id="jn" class="input" autoComplete="name" maxLength={40} autoFocus value={name} onInput={(e) => setName(e.currentTarget.value)} />
          </div>
          {email && (
            <div>
              <label class="label" for="je">
                Your email
              </label>
              <input id="je" class="input" type="email" autoComplete="email" maxLength={120} value={mail} onInput={(e) => setMail(e.currentTarget.value)} />
              <p class="muted tiny" style={{ marginTop: 6 }}>
                Only the host sees your email.
              </p>
            </div>
          )}
          <button class="btn block lg">Continue</button>
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
  const lastPoll = useRef<string | null>(null);
  useEffect(() => {
    const id = s?.meta.activePollId ?? null;
    if (id && id !== lastPoll.current) setTab("polls");
    lastPoll.current = id;
  }, [s?.meta.activePollId]);

  useEffect(() => {
    if (status === "passcode") onBadPasscode();
  }, [status]);
  if (status === "passcode") return <TopBar />;
  const problem = ConnProblem({ status, code });
  if (problem) return problem;
  if (!s || !me) return <TopBar title="Connecting…" />;
  if (!me.joined) return <JoinGate title={s.meta.title} email={s.meta.settings.identity === "email"} send={send} initialName={store.get("rs.name", "")} />;

  const poll = activePoll(s);
  const showBoard = s.leaderboard.rounds > 0;
  const current: Tab = tab === "board" && !showBoard ? "qa" : tab;

  return (
    <>
      <TopBar title={s.meta.title}>
        <span class="chip code">{code}</span>
        <ConnDot status={status} />
      </TopBar>
      <main class="wrap stack">
        {current === "qa" && <QATab s={s} me={me} send={send} />}
        {current === "polls" && (poll ? <PollAnswer key={poll.id} code={code} poll={poll} results={resultsOf(s, poll.id)} me={me} clockOffset={state.clockOffset} send={send} /> : <NoPoll />)}
        {current === "board" && <BoardTab s={s} me={me} />}
        {s.meta.settings.reactions && current !== "board" && <ReactBar send={send} />}
      </main>
      <nav class="bottom-nav" aria-label="Sections">
        <button aria-current={current === "qa" ? "page" : undefined} onClick={() => setTab("qa")}>
          <Icon.chat />
          Q&amp;A
        </button>
        <button aria-current={current === "polls" ? "page" : undefined} onClick={() => setTab("polls")}>
          <Icon.chart />
          Polls
          {poll && current !== "polls" && <span class="pip" aria-label="A poll is live" />}
        </button>
        {showBoard && (
          <button aria-current={current === "board" ? "page" : undefined} onClick={() => setTab("board")}>
            <Icon.trophy />
            Leaderboard
          </button>
        )}
      </nav>
    </>
  );
}

function NoPoll() {
  return (
    <div class="poll-card">
      <Empty title="No poll right now">When the host starts one, it shows up here.</Empty>
    </div>
  );
}

// ---------- Q&A ----------

function QATab({ s, me, send }: { s: NonNullable<ReturnType<typeof useRoom>["state"]["snapshot"]>; me: NonNullable<ReturnType<typeof useRoom>["state"]["me"]>; send: Send }) {
  const [sort, setSort] = useState<"popular" | "recent">("popular");
  const [text, setText] = useState("");
  const [name, setName] = useState(() => me.name || store.get("rs.name", ""));
  const settings = s.meta.settings;
  const named = settings.identity !== "none";
  const ups = useMemo(() => new Set(me.votes), [me.votes]);
  const downs = useMemo(() => new Set(me.downs), [me.downs]);
  const mine = useMemo(() => new Set(me.questions), [me.questions]);
  const questions = sortQuestions(s.questions, sort);
  const visible = questions.filter((q) => q.status !== "pending").length;

  const ask = (e: Event) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return toast("Type your question first");
    if (!named) store.set("rs.name", name.trim());
    send({ type: "ask", text: t, name: named ? undefined : name.trim() });
    setText("");
    toast(settings.moderation ? "Sent. The host will review it soon." : "Question sent");
  };

  return (
    <>
      <form class="ask" onSubmit={ask}>
        <label class="sr-only" for="qtext">
          Your question
        </label>
        <textarea
          id="qtext"
          class="input"
          maxLength={300}
          placeholder={settings.qaOpen ? "Ask the speaker a question" : "Questions are closed for now"}
          disabled={!settings.qaOpen}
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <div class="row nowrap">
          {named ? (
            <span class="grow muted small">Asking as {me.name}</span>
          ) : (
            <input
              class="input name grow"
              maxLength={40}
              aria-label="Your name"
              placeholder={settings.allowAnonymous ? "Your name (optional)" : "Your name"}
              disabled={!settings.qaOpen}
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          )}
          <button class="btn accent" disabled={!settings.qaOpen || !text.trim()}>
            Send
          </button>
        </div>
        {settings.qaOpen && settings.moderation && <p class="muted tiny" style={{ marginTop: 8 }}>The host reviews questions before they appear.</p>}
      </form>

      <div class="spread">
        <b>{plural(visible, "question")}</b>
        <div class="seg" role="group" aria-label="Sort questions">
          {(["popular", "recent"] as const).map((m) => (
            <button key={m} aria-pressed={sort === m} onClick={() => setSort(m)}>
              {m === "popular" ? "Popular" : "Recent"}
            </button>
          ))}
        </div>
      </div>

      {questions.length ? (
        <div class="q-list">
          {questions.map((q) => (
            <AttendeeQuestion key={q.id} q={q} up={ups.has(q.id)} down={downs.has(q.id)} mine={mine.has(q.id)} downvotes={settings.allowDownvotes} send={send} />
          ))}
        </div>
      ) : (
        <div class="poll-card">
          <Empty title="No questions yet">Ask the first one. Others can upvote it.</Empty>
        </div>
      )}
    </>
  );
}

function AttendeeQuestion({ q, up, down, mine, downvotes, send }: { q: Question; up: boolean; down: boolean; mine: boolean; downvotes: boolean; send: Send }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(q.text);
  const canEdit = mine && (q.status === "pending" || q.status === "live");
  return (
    <article class={`q ${q.highlighted ? "hl" : ""} ${mine ? "mine" : ""}`}>
      <div class="body">
        {q.highlighted && (
          <span class="tag hl" style={{ marginBottom: 6 }}>
            Now answering
          </span>
        )}
        {editing ? (
          <form
            class="stack-sm"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.trim()) return toast("Question can't be empty");
              send({ type: "editQuestion", id: q.id, text: draft.trim() });
              setEditing(false);
            }}
          >
            <textarea class="input" maxLength={300} value={draft} onInput={(e) => setDraft(e.currentTarget.value)} aria-label="Edit your question" />
            <div class="row">
              <button class="btn sm">Save</button>
              <button type="button" class="btn sm ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div class="text">{q.text}</div>
        )}
        <QuestionMeta q={q} mine={mine} />
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
                Edit
              </button>
            )}
            <button class="btn sm quiet" onClick={() => confirm("Withdraw your question?") && send({ type: "withdraw", id: q.id })}>
              Withdraw
            </button>
          </div>
        )}
      </div>
      {q.status !== "pending" && (
        <div class="voter">
          <button class={`vote num ${up ? "on" : ""}`} aria-label={`Upvote. Score ${q.votes - q.downs}`} aria-pressed={up} onClick={() => send({ type: "vote", id: q.id, dir: 1 })}>
            <Icon.up />
            <span>{q.votes - q.downs}</span>
          </button>
          {downvotes && (
            <button class={`down ${down ? "on" : ""}`} aria-label="Downvote" aria-pressed={down} onClick={() => send({ type: "vote", id: q.id, dir: -1 })}>
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
    <div class="react-bar" role="group" aria-label="Send a reaction to the big screen">
      {REACTIONS.map((e) => (
        <button key={e} aria-label={`React ${e}`} onClick={() => send({ type: "react", emoji: e })}>
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
                  <span class="box" />
                  <span>{o}</span>
                </span>
              </button>
            );
          })}
        </div>
        {item.multi && <p class="muted small" style={{ marginTop: 8 }}>Pick all that apply.</p>}
      </>
    );
  }
  if (item.type === "rating") {
    const v = typeof value === "number" ? value : 0;
    return (
      <div class="stars" role="radiogroup" aria-label="Rating">
        {Array.from({ length: item.scale || 5 }, (_, i) => (
          <button
            type="button"
            key={i}
            role="radio"
            aria-checked={v === i + 1}
            disabled={disabled}
            class={`star ${i < v ? "on" : ""}`}
            aria-label={`${i + 1} star${i ? "s" : ""}`}
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
        <div class="scale" role="radiogroup" aria-label="Scale">
          {nums.map((n) => (
            <button
              type="button"
              key={n}
              role="radio"
              aria-checked={value === n}
              aria-pressed={value === n}
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
          Put your favourite at the top. Use the arrows to move options.
        </p>
        <ol class="rank-list" style={{ padding: 0, margin: 0, listStyle: "none" }}>
          {order.map((opt, pos) => (
            <li class="rank-item" key={opt}>
              <span class="pos">{pos + 1}</span>
              {item.images?.[opt] && <img src={mediaUrl(code, item.images[opt]!)} alt="" />}
              <span class="grow">{item.options[opt]}</span>
              <span class="moves">
                <button type="button" class="btn sm ghost" disabled={disabled || pos === 0} aria-label={`Move ${item.options[opt]} up`} onClick={() => move(pos, -1)}>
                  ↑
                </button>
                <button type="button" class="btn sm ghost" disabled={disabled || pos === order.length - 1} aria-label={`Move ${item.options[opt]} down`} onClick={() => move(pos, 1)}>
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
    return <input class="input" maxLength={30} placeholder="A word or short phrase" aria-label="Your word" disabled={disabled} value={typeof value === "string" ? value : ""} onInput={(e) => onChange(e.currentTarget.value)} />;
  if (item.type === "open")
    return <textarea class="input" maxLength={200} placeholder="Your answer" aria-label="Your answer" disabled={disabled} value={typeof value === "string" ? value : ""} onInput={(e) => onChange(e.currentTarget.value)} />;
  return null;
}

/** True when an item's draft value can be sent. */
const ready = (item: Item, v: ResponseValue | null) =>
  v !== null && v !== "" && !(Array.isArray(v) && !v.length) && !(typeof v === "string" && !v.trim());

/** Converts a draft value to what the server expects. */
const toWire = (item: Item, v: ResponseValue | null): ResponseValue | null => {
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
  const [draft, setDraft] = useState<ResponseValue | null>(freeText ? "" : mine);
  useEffect(() => {
    if (!freeText) setDraft(mine);
  }, [JSON.stringify(mine)]);

  const submit = (v = draft) => {
    const wire = toWire(item, v);
    if (wire === null) return toast(freeText ? "Type something first" : "Pick an answer first");
    send({ type: "respond", pollId: poll.id, value: wire });
    if (freeText) setDraft("");
  };

  return (
    <div class="poll-card">
      <div class="spread">
        <span class="tag live">Live</span>
        <span class="muted small">{TYPE_LABEL[poll.type]}</span>
      </div>
      <h2>{poll.title}</h2>
      <ItemInput item={item} code={code} value={draft} onChange={setDraft} onPick={oneTap ? (v) => submit(v) : undefined} />
      {!oneTap && (
        <div class="row" style={{ marginTop: 14 }}>
          <button class="btn accent" onClick={() => submit()}>
            {answered && !freeText ? "Update answer" : "Send"}
          </button>
        </div>
      )}
      {answered && (
        <p class="muted small" style={{ marginTop: 10 }}>
          ✓ {freeText ? "Sent. You can send another." : oneTap ? "Answer saved. Tap again to change it." : "Answer saved."}
        </p>
      )}
      {answered && (
        <div style={{ marginTop: 20 }}>
          <ResultsView poll={poll} results={results} code={code} />
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
    if (!Array.isArray(v) || !v.length) return toast("Pick an answer first");
    send({ type: "respond", pollId: poll.id, value: v });
  };

  return (
    <div class="poll-card">
      <div class="spread">
        <span class="tag live">Quiz</span>
        {!poll.revealed && <Countdown poll={poll} clockOffset={clockOffset} />}
      </div>
      <h2>{poll.title}</h2>
      {poll.revealed ? (
        <div class="stack">
          <Confetti fire={right ? poll.id : null} />
          <div class={`verdict ${right ? "right" : "wrong"}`}>
            <span class="big">{right ? "Correct!" : mine ? "Not this time" : "No answer"}</span>
            {right && me.quiz?.last ? <span class="num">+{me.quiz.last} points</span> : null}
          </div>
          {me.quiz && (
            <p class="muted">
              You're <b>#{me.quiz.rank}</b> of {me.quiz.players} with {me.quiz.points.toLocaleString()} points.
            </p>
          )}
          <ResultsView poll={poll} results={results} code={code} />
        </div>
      ) : (
        <>
          {!me.name && !locked && <Nickname send={send} />}
          <ItemInput item={poll as unknown as Item} code={code} value={draft} onChange={setDraft} tiles disabled={locked} onPick={!poll.multi ? (v) => submit(v) : undefined} />
          {poll.multi && !locked && (
            <button class="btn accent block" style={{ marginTop: 12 }} onClick={() => submit()}>
              Lock in answer
            </button>
          )}
          <p class="muted" style={{ marginTop: 14, textAlign: "center" }}>
            {answered ? "Answer locked in. Wait for the reveal…" : timeUp ? "Time's up! Wait for the reveal…" : "Faster correct answers score more points."}
          </p>
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
        if (!v.trim()) return toast("Type a name");
        store.set("rs.name", v.trim());
        send({ type: "join", name: v.trim() });
      }}
    >
      <label class="small grow" for="nick" style={{ flexBasis: "100%" }}>
        Your name on the leaderboard
      </label>
      <input id="nick" class="input" maxLength={40} value={v} onInput={(e) => setV(e.currentTarget.value)} />
      <button class="btn sm">Save</button>
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
    if (wire.every((x) => x === null)) return toast("Answer at least one question");
    send({ type: "respond", pollId: poll.id, value: wire as ResponseValue });
    setEditing(false);
  };

  if (!editing && mine)
    return (
      <div class="poll-card stack">
        <span class="tag live">Survey</span>
        <h2>Thanks for your answers!</h2>
        <button class="btn ghost" onClick={() => (setStep(0), setEditing(true))}>
          Change my answers
        </button>
        <ResultsView poll={poll} results={results} code={code} />
      </div>
    );

  return (
    <div class="poll-card">
      <div class="spread">
        <span class="tag live">Survey</span>
        <span class="muted small num">
          Question {step + 1} of {n}
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
          Back
        </button>
        {step < n - 1 ? (
          <button class="btn" onClick={() => setStep(step + 1)}>
            {ready(item, answers[step]) ? "Next" : "Skip"}
          </button>
        ) : (
          <button class="btn accent" onClick={finish}>
            Submit
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- leaderboard ----------

function BoardTab({ s, me }: { s: NonNullable<ReturnType<typeof useRoom>["state"]["snapshot"]>; me: NonNullable<ReturnType<typeof useRoom>["state"]["me"]> }) {
  const lb = s.leaderboard;
  const beat = me.quiz && lb.players > 1 ? Math.round(((lb.players - me.quiz.rank) / (lb.players - 1)) * 100) : null;
  return (
    <>
      {me.quiz ? (
        <div class="me-score">
          <div>
            <div class="big num">#{me.quiz.rank}</div>
            <div class="small">of {me.quiz.players}</div>
          </div>
          <div>
            <b class="num">{me.quiz.points.toLocaleString()} points</b>
            {beat !== null && beat > 0 && <div class="small">You're ahead of {beat}% of players</div>}
          </div>
        </div>
      ) : (
        <div class="poll-card">
          <Empty title="Not on the board yet">Answer a quiz question to get points.</Empty>
        </div>
      )}
      <div class="poll-card stack">
        <h2>Leaderboard</h2>
        <p class="muted small">{plural(lb.rounds, "question")} revealed so far.</p>
        <Podium board={lb} />
        <Board board={lb} from={3} />
      </div>
    </>
  );
}

