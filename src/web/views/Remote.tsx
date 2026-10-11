import { useEffect, useRef, useState } from "preact/hooks";
import { PRESENT_MODES, type PresentMode } from "../../shared/protocol";
import { activePoll, resultsOf, sortQuestions } from "../../shared/store";
import { useRoom } from "../lib/room";
import { CFG, plural, useTheme, useTitle } from "../lib/util";
import { ConnDot, ConnProblem, Countdown, Empty, Icon, TYPE_LABEL } from "../components/ui";

const MODE_LABEL: Record<PresentMode, string> = { auto: "Auto", qa: "Q&A", poll: "Poll", leaderboard: "Scores", code: "Join code" };

/** Keeps the phone screen on while the remote is open (where the browser allows it). */
function useWakeLock() {
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } };
    const get = () => {
      if (document.visibilityState === "visible" && nav.wakeLock) nav.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {});
    };
    get();
    document.addEventListener("visibilitychange", get);
    return () => {
      document.removeEventListener("visibilitychange", get);
      lock?.release().catch(() => {});
    };
  }, []);
}

/** A phone-sized controller for the person on stage: move through polls and pick questions. */
export function Remote({ code }: { code: string }) {
  const key = decodeURIComponent(location.hash.slice(1));
  const { state, status, send } = useRoom(code, "host", { key });
  const s = state.snapshot;
  useTitle(s ? `Remote: ${s.meta.title}` : CFG.name);
  useTheme(s?.meta.settings.theme);
  useWakeLock();
  // The last poll this remote launched, so "Next" still works after a poll is stopped.
  const cursor = useRef<string | null>(null);
  const [, force] = useState(0);

  if (!key || status === "forbidden") return <ConnProblem status="forbidden" code={code} />;
  if (status === "not-found") return <ConnProblem status={status} code={code} />;
  if (!s) return <div class="remote muted" style={{ padding: 24 }}>Connecting…</div>;

  const polls = s.polls;
  const live = activePoll(s);
  if (live) cursor.current = live.id;
  const at = polls.findIndex((p) => p.id === (live?.id ?? cursor.current));
  const prev = at > 0 ? polls[at - 1] : null;
  const next = polls[at + 1] ?? null;
  const go = (id: string | null) => {
    if (id) cursor.current = id;
    send({ type: "activatePoll", pollId: id });
    if (navigator.vibrate) navigator.vibrate(15);
    force((n) => n + 1);
  };
  const results = live ? resultsOf(s, live.id) : null;
  const mode = s.meta.presentMode;

  const questions = sortQuestions(
    s.questions.filter((q) => q.status === "live"),
    "popular",
  );
  const hl = questions.find((q) => q.highlighted);
  const top = questions.filter((q) => !q.highlighted).slice(0, 6);
  const pending = s.questions.filter((q) => q.status === "pending").length;

  return (
    <div class="remote">
      <header class="remote-head">
        <div class="grow" style={{ minWidth: 0 }}>
          <div class="remote-title">{s.meta.title}</div>
          <div class="muted tiny">
            Remote · code <b>{code}</b>
          </div>
        </div>
        <span class="chip">
          <ConnDot status={status} />
          <span class="num">{s.online}</span> here
        </span>
      </header>

      <section aria-label="Big screen">
        <p class="label">Big screen shows</p>
        <div class="seg remote-seg" role="group" aria-label="Big screen shows">
          {PRESENT_MODES.map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => send({ type: "setPresentMode", mode: m })}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </section>

      <section class="remote-card" aria-label="Polls">
        {live ? (
          <>
            <div class="spread">
              <span class="tag live">{TYPE_LABEL[live.type]}</span>
              <span class="muted small">
                Poll {at + 1} of {polls.length}
              </span>
            </div>
            <h2 class="remote-poll">{live.title}</h2>
            <div class="remote-count">
              <b class="num">{results?.total ?? 0}</b> {(results?.total ?? 0) === 1 ? "answer" : "answers"}
              {live.type === "quiz" && live.timeLimit > 0 && !live.revealed && <Countdown poll={live} clockOffset={state.clockOffset} />}
            </div>
            <div class="remote-actions">
              {live.type === "quiz" ? (
                <button class={`btn ${live.revealed ? "on" : ""}`} onClick={() => send({ type: "revealAnswer", pollId: live.id })}>
                  <Icon.check /> {live.revealed ? "Hide answer" : "Reveal answer"}
                </button>
              ) : (
                <button class={`btn ${live.showResults ? "on" : "ghost"}`} onClick={() => send({ type: "toggleResults", pollId: live.id })}>
                  <Icon.eye /> {live.showResults ? "Results shown" : "Results hidden"}
                </button>
              )}
              <button class="btn ghost" onClick={() => go(null)}>
                <Icon.stop /> Stop poll
              </button>
            </div>
          </>
        ) : polls.length ? (
          <>
            <p class="muted small">No poll running</p>
            <h2 class="remote-poll">{next ? `Up next: ${next.title}` : "That was the last poll"}</h2>
          </>
        ) : (
          <Empty title="No polls yet">Add polls from the host page.</Empty>
        )}
        {polls.length > 0 && (
          <div class="remote-nav">
            <button class="btn lg ghost" disabled={!prev} onClick={() => prev && go(prev.id)} aria-label={prev ? `Previous poll: ${prev.title}` : "No previous poll"}>
              <Icon.prev /> Back
            </button>
            <button class="btn lg accent" disabled={!next} onClick={() => next && go(next.id)} aria-label={next ? `Next poll: ${next.title}` : "No next poll"}>
              {at < 0 ? "Start" : "Next"} <Icon.next />
            </button>
          </div>
        )}
        {next && live && <p class="muted tiny">Next: {next.title}</p>}
      </section>

      <section class="remote-card" aria-label="Questions">
        <div class="spread">
          <h2 style={{ fontSize: "1.05rem" }}>Questions</h2>
          {pending > 0 && <span class="chip">{plural(pending, "question")} to review</span>}
        </div>
        {hl && (
          <div class="remote-q hl">
            <span class="tag hl">On screen</span>
            <div class="text">{hl.text}</div>
            <div class="row">
              <button class="btn sm" onClick={() => send({ type: "answer", id: hl.id })}>
                <Icon.check /> Answered
              </button>
              <button class="btn sm ghost" onClick={() => send({ type: "highlight", id: hl.id })}>
                Take off screen
              </button>
            </div>
          </div>
        )}
        {top.length ? (
          top.map((q) => (
            <button key={q.id} class="remote-q" onClick={() => send({ type: "highlight", id: q.id })} aria-label={`Show on screen: ${q.text}`}>
              <span class="num remote-votes">
                <Icon.up />
                {q.votes - q.downs}
              </span>
              <span class="text">{q.text}</span>
            </button>
          ))
        ) : !hl ? (
          <p class="muted small">No questions yet.</p>
        ) : null}
        {top.length > 0 && <p class="muted tiny">Tap a question to put it on the big screen.</p>}
      </section>
    </div>
  );
}
