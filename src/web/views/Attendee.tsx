import { useEffect, useMemo, useState } from "preact/hooks";
import type { Poll, Question, ResponseValue, Results } from "../../shared/protocol";
import { activePoll, resultsOf, sortQuestions } from "../../shared/store";
import { useRoom } from "../lib/room";
import { CFG, plural, store, toast, useTitle } from "../lib/util";
import { ConnDot, ConnProblem, Empty, QuestionMeta, ResultsView, TopBar, TYPE_LABEL, UpIcon } from "../components/ui";

export function Attendee({ code }: { code: string }) {
  const { state, status, send } = useRoom(code, "attendee");
  const [tab, setTab] = useState<"qa" | "poll">("qa");
  const [sort, setSort] = useState<"popular" | "recent">("popular");
  const [text, setText] = useState("");
  const [name, setName] = useState(() => store.get("rs.name", ""));
  const s = state.snapshot;
  const me = state.me;
  useTitle(s ? `${s.meta.title} · ${CFG.name}` : CFG.name);
  const myVotes = useMemo(() => new Set(me?.votes ?? []), [me]);
  const mine = useMemo(() => new Set(me?.questions ?? []), [me]);

  if (status === "not-found" || status === "full" || status === "forbidden") return <ConnProblem status={status} code={code} />;

  const poll = s ? activePoll(s) : undefined;
  const questions = s ? sortQuestions(s.questions, sort) : [];
  const visibleCount = questions.filter((q) => q.status !== "pending").length;
  const settings = s?.meta.settings;

  const ask = (e: Event) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return toast("Type a question first");
    store.set("rs.name", name.trim());
    send({ type: "ask", text: t, name: name.trim() });
    setText("");
    toast(settings?.moderation ? "Sent! The host will review it shortly." : "Question sent");
  };

  return (
    <>
      <TopBar title={s?.meta.title}>
        <span class="chip">#{code}</span>
        <ConnDot status={status} />
      </TopBar>
      <div class="wrap stack">
        <div class="tabs" role="tablist">
          <button class={`tab ${tab === "qa" ? "active" : ""}`} role="tab" aria-selected={tab === "qa"} onClick={() => setTab("qa")}>
            Q&amp;A
          </button>
          <button class={`tab ${tab === "poll" ? "active" : ""}`} role="tab" aria-selected={tab === "poll"} onClick={() => setTab("poll")}>
            Polls {poll && <span class="badge pulse">1</span>}
          </button>
        </div>

        {tab === "qa" && (
          <section class="stack">
            <form class="card stack" onSubmit={ask}>
              <textarea
                class="input"
                maxLength={300}
                placeholder="Type your question"
                aria-label="Your question"
                disabled={!settings?.qaOpen}
                value={text}
                onInput={(e) => setText(e.currentTarget.value)}
              />
              <div class="row">
                <input
                  class="input grow"
                  maxLength={40}
                  style={{ flex: "1 1 180px" }}
                  aria-label="Your name"
                  placeholder={settings && settings.allowAnonymous && !settings.requireName ? "Your name (optional)" : "Your name (required)"}
                  disabled={!settings?.qaOpen}
                  value={name}
                  onInput={(e) => setName(e.currentTarget.value)}
                />
                <button class="btn accent" disabled={!settings?.qaOpen}>
                  Send
                </button>
              </div>
              {settings && !settings.qaOpen && <div class="muted small">The host has closed questions for now.</div>}
              {settings?.qaOpen && settings.moderation && <div class="muted small">Questions are reviewed by the host before they appear.</div>}
            </form>
            <div class="row">
              <b class="grow">{plural(visibleCount, "question")}</b>
              <div class="tabs" style={{ padding: 3 }}>
                {(["popular", "recent"] as const).map((m) => (
                  <button key={m} class={`tab ${sort === m ? "active" : ""}`} style={{ padding: "5px 12px" }} onClick={() => setSort(m)}>
                    {m === "popular" ? "Popular" : "Recent"}
                  </button>
                ))}
              </div>
            </div>
            <div class="card">
              {!s ? (
                <Empty>Connecting…</Empty>
              ) : questions.length ? (
                questions.map((q) => <AttendeeQuestion key={q.id} q={q} voted={myVotes.has(q.id)} onVote={() => send({ type: "vote", id: q.id })} />)
              ) : (
                <Empty>No questions yet. Be the first to ask!</Empty>
              )}
            </div>
            {mine.size > 0 && <p class="muted small" style={{ textAlign: "center" }}>You've asked {plural(mine.size, "question")}.</p>}
          </section>
        )}

        {tab === "poll" &&
          (poll && s ? (
            <PollAnswer key={poll.id} poll={poll} results={resultsOf(s, poll.id)} mine={me?.responses[poll.id] ?? null} send={send} />
          ) : (
            <div class="card">
              <Empty>
                No poll is running right now.
                <br />
                It will show up here when the host starts one.
              </Empty>
            </div>
          ))}
      </div>
    </>
  );
}

function AttendeeQuestion({ q, voted, onVote }: { q: Question; voted: boolean; onVote: () => void }) {
  return (
    <div class={`q ${q.highlighted ? "hl" : ""}`}>
      <div class="body">
        {q.highlighted && <span class="tag hl">Now answering</span>}
        <div class="text">{q.text}</div>
        <QuestionMeta q={q} />
      </div>
      {q.status !== "pending" && (
        <button class={`vote ${voted ? "on" : ""}`} aria-label="Upvote" aria-pressed={voted} onClick={onVote}>
          <UpIcon />
          <span>{q.votes}</span>
        </button>
      )}
    </div>
  );
}

function PollAnswer({ poll, results, mine, send }: { poll: Poll; results: Results; mine: ResponseValue | null; send: ReturnType<typeof useRoom>["send"] }) {
  const answered = mine !== null;
  const [sel, setSel] = useState<number[]>(() => (Array.isArray(mine) && typeof mine[0] === "number" ? [...(mine as number[])] : []));
  const [text, setText] = useState("");
  useEffect(() => {
    if (Array.isArray(mine) && typeof mine[0] === "number") setSel([...(mine as number[])]);
  }, [JSON.stringify(mine)]);

  const choice = poll.type === "multiple" || poll.type === "quiz";
  const freeText = poll.type === "wordcloud" || poll.type === "open";
  const pick = (i: number) => setSel(poll.multi ? (sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i]) : [i]);
  const submit = () => {
    if (choice) {
      if (!sel.length) return toast("Pick an option");
      send({ type: "respond", pollId: poll.id, value: sel });
    } else {
      const v = text.trim();
      if (!v) return toast("Type something first");
      send({ type: "respond", pollId: poll.id, value: poll.type === "wordcloud" ? [v] : v });
      setText("");
    }
  };
  const quizRight =
    poll.type === "quiz" && poll.correct && Array.isArray(mine)
      ? poll.correct.length === mine.length && poll.correct.every((c) => (mine as number[]).includes(c))
      : null;

  return (
    <div class="card stack">
      <div class="row">
        <span class="kicker grow">{TYPE_LABEL[poll.type]}</span>
        <span class="status active">Live</span>
      </div>
      <h2>{poll.title}</h2>
      <div>
        {choice &&
          poll.options.map((o, i) => (
            <button type="button" key={i} class={`opt ${poll.multi ? "multi" : ""} ${sel.includes(i) ? "sel" : ""}`} aria-pressed={sel.includes(i)} onClick={() => pick(i)}>
              <span class="box" />
              <span>{o}</span>
            </button>
          ))}
        {choice && poll.multi && <p class="muted small">You can pick more than one.</p>}
        {poll.type === "rating" && (
          <div class="stars">
            {Array.from({ length: poll.scale || 5 }, (_, i) => (
              <button type="button" key={i} class={`star ${typeof mine === "number" && i < mine ? "on" : ""}`} aria-label={`${i + 1} stars`} onClick={() => send({ type: "respond", pollId: poll.id, value: i + 1 })}>
                ★
              </button>
            ))}
          </div>
        )}
        {poll.type === "wordcloud" && (
          <input class="input" maxLength={30} placeholder="One word or short phrase" value={text} onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        )}
        {poll.type === "open" && <textarea class="input" maxLength={200} placeholder="Your answer" value={text} onInput={(e) => setText(e.currentTarget.value)} />}
      </div>
      <div class="row">
        {poll.type !== "rating" && (
          <button class="btn accent" onClick={submit}>
            {answered && choice ? "Update answer" : "Send"}
          </button>
        )}
        {answered && (
          <span class="muted small">
            ✓ Your answer was sent{freeText ? " — you can send another" : ""}
          </span>
        )}
      </div>
      {quizRight !== null && <p>{quizRight ? <b>✅ Correct!</b> : <b>❌ Not quite.</b>}</p>}
      {answered && <ResultsView poll={poll} results={results} />}
    </div>
  );
}
