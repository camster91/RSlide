import { useEffect, useRef, useState } from "preact/hooks";
import { PRESENT_MODES, type PresentMode } from "../../shared/protocol";
import { activePoll, resultsOf, sortQuestions } from "../../shared/store";
import { useRoom } from "../lib/room";
import { CFG, plural, toast, useTheme, useTitle } from "../lib/util";
import { ConnDot, OfflineBanner, ConnProblem, Countdown, Empty, Icon, TYPE_LABEL } from "../components/ui";
import { t, tj, pluralWord } from "../lib/i18n";

const MODE_LABEL: Record<PresentMode, string> = { auto: t("Auto"), qa: t("Q&A"), poll: t("Poll"), leaderboard: t("Scores"), code: t("Join code") };

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
  useTitle(s ? t("Remote: {title}", { title: s.meta.title }) : CFG.name);
  useTheme(s?.meta.settings.theme);
  useWakeLock();
  // The last poll this remote launched, so "Next" still works after a poll is stopped.
  const cursor = useRef<string | null>(null);
  const [, force] = useState(0);

  if (!key || status === "forbidden") return <ConnProblem status="forbidden" code={code} />;
  if (status === "not-found") return <ConnProblem status={status} code={code} />;
  if (!s) return <div class="remote muted" style={{ padding: 24 }}>{t("Connecting…")}</div>;

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
  // In Auto mode a live poll wins the screen, so showing a question switches the screen to Q&A.
  const showQuestion = (id: string) => {
    send({ type: "highlight", id });
    if (mode === "poll" || (mode === "auto" && live)) {
      send({ type: "setPresentMode", mode: "qa" });
      toast(t("Big screen switched to Q&A"));
    }
    if (navigator.vibrate) navigator.vibrate(15);
  };

  return (
    <div class="remote">
      <OfflineBanner status={status} />
      <header class="remote-head">
        <div class="grow" style={{ minWidth: 0 }}>
          <div class="remote-title">{s.meta.title}</div>
          <div class="muted tiny">
            {tj("Remote · code {code}", { code: <b>{code}</b> })}
          </div>
        </div>
        <span class="chip">
          <ConnDot status={status} />
          {tj("{n} here", { n: <span class="num">{s.online}</span> })}
        </span>
      </header>

      <section aria-label={t("Big screen")}>
        <p class="label">{t("Big screen shows")}</p>
        <div class="seg remote-seg" role="group" aria-label={t("Big screen shows")}>
          {PRESENT_MODES.map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => send({ type: "setPresentMode", mode: m })}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </section>

      <section class="remote-card" aria-label={t("Polls")}>
        {live ? (
          <>
            <div class="spread">
              <span class="tag live">{TYPE_LABEL[live.type]}</span>
              <span class="muted small">
                {t("Poll {n} of {total}", { n: at + 1, total: polls.length })}
              </span>
            </div>
            <h2 class="remote-poll">{live.title}</h2>
            <div class="remote-count">
              <b class="num">{results?.total ?? 0}</b> {pluralWord(results?.total ?? 0, "answer")}
              {live.type === "quiz" && live.timeLimit > 0 && !live.revealed && <Countdown poll={live} clockOffset={state.clockOffset} />}
            </div>
            <div class="remote-actions">
              {live.type === "quiz" ? (
                <button class={`btn ${live.revealed ? "on" : ""}`} onClick={() => send({ type: "revealAnswer", pollId: live.id })}>
                  <Icon.check /> {live.revealed ? t("Hide answer") : t("Reveal answer")}
                </button>
              ) : (
                <button class={`btn ${live.showResults ? "on" : "ghost"}`} onClick={() => send({ type: "toggleResults", pollId: live.id })}>
                  <Icon.eye /> {live.showResults ? t("Hide results") : t("Show results")}
                </button>
              )}
              <button class="btn ghost" onClick={() => go(null)}>
                <Icon.stop /> {t("Stop poll")}
              </button>
            </div>
          </>
        ) : polls.length ? (
          <>
            <p class="muted small">{t("No poll running")}</p>
            <h2 class="remote-poll">{next ? t("Up next: {title}", { title: next.title }) : t("That was the last poll")}</h2>
          </>
        ) : (
          <Empty title={t("No polls yet")}>{t("Add polls from the host page.")}</Empty>
        )}
        {polls.length > 0 && (
          <div class="remote-nav">
            <button class="btn lg ghost" disabled={!prev} onClick={() => prev && go(prev.id)} title={prev ? t("Previous poll: {title}", { title: prev.title }) : undefined}>
              <Icon.prev /> {t("Back")}
            </button>
            <button class="btn lg accent" disabled={!next} onClick={() => next && go(next.id)} title={next ? t("Next poll: {title}", { title: next.title }) : undefined}>
              {at < 0 ? t("Start") : t("Next")} <Icon.next />
            </button>
          </div>
        )}
        {next && live && <p class="muted tiny">{t("Next: {title}", { title: next.title })}</p>}
      </section>

      <section class="remote-card" aria-label={t("Questions")}>
        <div class="spread">
          <h2 style={{ fontSize: "1.05rem" }}>{t("Questions")}</h2>
          {pending > 0 && <span class="chip">{t("{questions} to review", { questions: plural(pending, "question") })}</span>}
        </div>
        {hl && (
          <div class="remote-q hl">
            <span class="tag hl">{t("On screen")}</span>
            <div class="text">{hl.text}</div>
            <div class="row">
              <button class="btn sm" onClick={() => send({ type: "answer", id: hl.id })}>
                <Icon.check /> {t("Answered")}
              </button>
              <button class="btn sm ghost" onClick={() => send({ type: "highlight", id: hl.id })}>
                {t("Take off screen")}
              </button>
            </div>
          </div>
        )}
        {top.length ? (
          top.map((q) => (
            <button key={q.id} class="remote-q" onClick={() => showQuestion(q.id)}>
              <span class="num remote-votes">
                <Icon.up />
                {q.votes - q.downs}
              </span>
              <span class="text">{q.text}</span>
            </button>
          ))
        ) : !hl ? (
          <p class="muted small">{t("No questions yet.")}</p>
        ) : null}
        {top.length > 0 && <p class="muted tiny">{t("Tap a question to put it on the big screen.")}</p>}
      </section>
    </div>
  );
}
