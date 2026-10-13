import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { Poll, Snapshot } from "../../shared/protocol";
import { activePoll, resultsOf, sortQuestions } from "../../shared/store";
import { useRoom } from "../lib/room";
import { t, tj } from "../lib/i18n";
import { CFG, joinUrl, plural, useTheme, useTitle } from "../lib/util";
import { Board, Brand, ConnProblem, Confetti, Countdown, Icon, ItemResults, Podium, podiumVisible, QrCode, TeamBoard, ResultsView, TYPE_LABEL, useFloaters } from "../components/ui";

export function Present({ code }: { code: string }) {
  const key = decodeURIComponent(location.hash.slice(1));
  const floaters = useFloaters();
  const { state, status } = useRoom(code, "present", { key: key || undefined, onReactions: floaters.add });
  const s = state.snapshot;
  const params = new URLSearchParams(location.search);
  // ?overlay=1: a see-through layer for streaming software (OBS, vMix, StreamYard).
  const overlay = params.has("overlay");
  useEffect(() => {
    if (!overlay) return;
    document.documentElement.classList.add("overlay-mode");
    return () => document.documentElement.classList.remove("overlay-mode");
  }, [overlay]);
  useTitle(s ? `${s.meta.title} · ${CFG.name}` : CFG.name);
  useTheme(s?.meta.settings.theme, s?.meta.settings.screen ?? "light");
  if (status === "not-found") return <ConnProblem status={status} code={code} />;

  const poll = s ? activePoll(s) : undefined;
  // ?room=ID shows one room's questions, for events with a screen per room.
  const roomParam = params.get("room");
  const room = s?.meta.rooms.find((r) => r.id === roomParam);
  const mode = !s ? "code" : s.meta.presentMode === "auto" ? (poll ? "poll" : "qa") : s.meta.presentMode;
  const host = location.host;
  if (overlay && s) return <Overlay code={code} s={s} poll={poll} mode={mode} room={room?.id} clockOffset={state.clockOffset} floaters={floaters.layer} />;

  // The join screen fills the whole display: before an event starts, or when nothing is live.
  if (!s || mode === "code" || (mode === "poll" && !poll)) return <JoinHero code={code} host={host} s={s} floaters={floaters.layer} />;

  let stage = null;
  if (mode === "poll" && poll) {
    const results = resultsOf(s, poll.id);
    const options = poll.type === "survey" ? 0 : poll.options.length;
    const density = options > 8 ? "xdense" : options > 5 ? "dense" : "";
    stage = (
      <div class={`poll-stage ${density} ${poll.title.length > 110 ? "long-title" : ""}`}>
        <div class="stage-label">
          <span class="tag live">{poll.type === "quiz" ? t("Quiz") : t("Live poll")}</span>
          {poll.type !== "quiz" && <span>{TYPE_LABEL[poll.type]}</span>}
          <span class="grow" />
          <span class="stage-count num">{t("{responses} so far", { responses: plural(results.total, "response") })}</span>
        </div>
        <div class={poll.type === "quiz" && !poll.revealed ? "split" : undefined}>
          <h1>{poll.title}</h1>
          {poll.type === "quiz" && !poll.revealed && <Countdown poll={poll} clockOffset={state.clockOffset} big />}
        </div>
        {poll.type === "quiz" && poll.revealed && <QuizHeadline poll={poll} counts={results.counts ?? []} total={results.total} />}
        {poll.type === "quiz" && !poll.revealed ? (
          <QuizWaiting count={results.total} options={poll.options} />
        ) : poll.type === "survey" ? (
          <SurveyStage poll={poll} results={results} code={code} />
        ) : (
          <ResultsView poll={poll} results={results} code={code} big />
        )}
      </div>
    );
  } else if (s && mode === "leaderboard") {
    stage = (
      <>
        <Confetti fire={s.leaderboard.rounds ? `lb-${s.leaderboard.rounds}` : null} />
        <div class="stage-label">
          <Icon.trophy /> {t("{questions} played", { questions: plural(s.leaderboard.rounds, "question") })}
        </div>
        <h1>{t("Leaderboard")}</h1>
        {s.leaderboard.top.length && s.leaderboard.teams?.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr)", gap: "4vw", alignItems: "start", marginTop: "3vh" }}>
            <TeamBoard teams={s.leaderboard.teams} big />
            <div>
              <div class="stage-label">{t("Top players")}</div>
              <Board board={s.leaderboard} limit={8} teams={s.meta.teams} />
            </div>
          </div>
        ) : s.leaderboard.top.length && !podiumVisible(s.leaderboard) ? (
          <div style={{ maxWidth: "60vw" }}>
            <Board board={s.leaderboard} limit={8} />
          </div>
        ) : s.leaderboard.top.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: "4vw", alignItems: "end" }}>
            <Podium board={s.leaderboard} />
            <Board board={s.leaderboard} afterPodium />
          </div>
        ) : (
          <div class="feature muted">{t("Scores appear after the first answer is revealed.")}</div>
        )}
      </>
    );
  } else if (s && mode === "qa") {
    const qs = sortQuestions(
      s.questions.filter((q) => q.status === "live" && (!room || q.room === room.id)),
      "popular",
    );
    const hl = qs.find((q) => q.highlighted);
    const rest = qs.filter((q) => !q.highlighted).slice(0, hl ? 3 : 5);
    stage = (
      <>
        <div class="stage-label">
          {s.meta.title}
          {room && <span class="tag live">{room.name}</span>}
        </div>
        {hl && (
          <div class="now-answering" style={{ marginTop: "2vh" }}>
            <span class="tag hl">{t("Now answering")}</span>
            <div class="feature" style={{ fontSize: "clamp(1.8rem, 3.2vw, 3.8rem)", marginTop: "1.5vh" }}>
              {hl.text}
            </div>
            <div class="meta">
              {hl.name || t("Anonymous")}, {plural(hl.votes - hl.downs, "vote")}
            </div>
          </div>
        )}
        {!hl && <h1>{t("Questions")}</h1>}
        <div class="q-list">
          {rest.map((q) => (
            <div class="q" key={q.id}>
              <div class="vote static num">
                <Icon.up />
                <span>{q.votes - q.downs}</span>
              </div>
              <div class="body">
                <div class="text">{q.text}</div>
                <div class="meta">{q.name || t("Anonymous")}</div>
              </div>
            </div>
          ))}
        </div>
        {!rest.length && !hl && (
          <div class="feature muted" style={{ marginTop: "8vh", maxWidth: "18ch" }}>
            {t("Ask a question at {host}", { host })}
          </div>
        )}
      </>
    );
  }
  const announce = mode === "poll" && poll ? poll.title : mode === "leaderboard" ? t("Leaderboard") : t("Questions");

  return (
    <div class="present">
      <aside>
        <Brand logo={s?.meta.settings.logo} code={code} />
        <div>
          <div class="join-at">{t("Join at")}</div>
          <div class="join-host">{host}</div>
        </div>
        <div>
          <div class="join-at">{t("Code")}</div>
          <div class="big-code" aria-label={t("Event code {code}", { code: code.split("").join(" ") })}>
            {code}
          </div>
        </div>
        <QrCode url={joinUrl(code)} />
        <div class="people num">
          {t("{people} here", { people: plural(s?.online ?? 0, "person") })}
        </div>
      </aside>
      <main>
        <p class="sr-only" aria-live="polite">{announce}</p>
        {stage}
      </main>
      {floaters.layer}
    </div>
  );
}

/** Full-screen "how to join": big QR code, code and address. */
function JoinHero({ code, host, s, floaters }: { code: string; host: string; s: Snapshot | null; floaters: ComponentChildren }) {
  return (
    <div class="present hero-mode">
      <div class="hero-brand">
        <Brand logo={s?.meta.settings.logo} code={code} />
      </div>
      <div class="hero">
        <div class="hero-text">
          {s && <div class="stage-label">{s.meta.title}</div>}
          <div class="hero-step">{tj("Go to {host}", { host: <b>{host}</b> })}</div>
          <div class="hero-step">{t("and enter the code")}</div>
          <div class="hero-code" aria-label={t("Event code {code}", { code: code.split("").join(" ") })}>
            {code}
          </div>
          <div class="hero-people num">{t("{people} here", { people: plural(s?.online ?? 0, "person") })}</div>
        </div>
        <div class="hero-qr">
          <QrCode url={joinUrl(code)} />
          <p>{t("Or scan to join")}</p>
        </div>
      </div>
      {floaters}
    </div>
  );
}

/** "62% got it right" once a quiz answer is revealed. */
function QuizHeadline({ poll, counts, total }: { poll: Poll; counts: number[]; total: number }) {
  if (!total || !poll.correct?.length) return null;
  const right = poll.correct.length === 1 ? (counts[poll.correct[0]] ?? 0) : Math.min(...poll.correct.map((c) => counts[c] ?? 0));
  return <p class="quiz-headline">{t("{pct}% got it right", { pct: Math.round((right / total) * 100) })}</p>;
}

/** Surveys are long, so the big screen shows one question at a time, changing every 10 seconds. */
function SurveyStage({ poll, results, code }: { poll: Poll; results: ReturnType<typeof resultsOf>; code: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (poll.items.length < 2) return;
    const id = setInterval(() => setI((n) => (n + 1) % poll.items.length), 10_000);
    return () => clearInterval(id);
  }, [poll.items.length]);
  const idx = i % Math.max(1, poll.items.length);
  const it = poll.items[idx];
  if (!it) return null;
  return (
    <div class="survey-stage">
      <div class="stage-label">
        {t("Question {n} of {total}", { n: idx + 1, total: poll.items.length })}
        <span class="dots" aria-hidden="true">
          {poll.items.map((_, j) => (
            <i key={j} class={j === idx ? "on" : ""} />
          ))}
        </span>
      </div>
      <h2>{it.title}</h2>
      <ItemResults item={it} r={results.items?.[idx] ?? { total: 0 }} code={code} big />
    </div>
  );
}

function QuizWaiting({ count, options }: { count: number; options: string[] }) {
  return (
    <div class="stack">
      <div class="opts" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1.6vh 1.4vw" }}>
        {options.map((o, i) => (
          <div key={i} class={`opt tile q${i % 8}`} style={{ fontSize: "clamp(1.1rem, 1.8vw, 2.1rem)", minHeight: "11vh", cursor: "default" }}>
            <span class="tile-letter" aria-hidden="true">{String.fromCharCode(65 + i)}</span>
            {o}
          </div>
        ))}
      </div>
      <p class="muted" style={{ fontSize: "clamp(1rem, 1.5vw, 1.7rem)", marginTop: "3vh" }}>
        {t("{answers} so far", { answers: plural(count, "answer") })}
      </p>
    </div>
  );
}

/** Lower-third overlay for live streams: only what matters right now, on a see-through page. */
function Overlay({ code, s, poll, mode, room, clockOffset, floaters }: {
  code: string;
  s: Snapshot;
  poll: Poll | undefined;
  mode: string;
  room?: string;
  clockOffset: number;
  floaters: ComponentChildren;
}) {
  const side = new URLSearchParams(location.search).get("pos") === "right" ? "right" : "left";
  const hl = s.questions.find((q) => q.highlighted && q.status === "live" && (!room || q.room === room));
  let card = null;
  if (mode === "poll" && poll) {
    card = (
      <div class="ov-card">
        <div class="ov-kicker">
          <span class="tag live">{poll.type === "quiz" ? t("Quiz") : t("Live poll")}</span>
          {poll.type === "quiz" && !poll.revealed && <Countdown poll={poll} clockOffset={clockOffset} />}
        </div>
        <h2 class="ov-title">{poll.title}</h2>
        {poll.type === "quiz" && !poll.revealed ? (
          <p class="muted">{t("{answers} so far", { answers: plural(resultsOf(s, poll.id).total, "answer") })}</p>
        ) : (
          <ResultsView poll={poll} results={resultsOf(s, poll.id)} code={code} />
        )}
      </div>
    );
  } else if (mode === "leaderboard" && s.leaderboard.top.length) {
    card = (
      <div class="ov-card">
        <div class="ov-kicker">
          <Icon.trophy /> {t("Leaderboard")}
        </div>
        {s.leaderboard.teams?.length ? <TeamBoard teams={s.leaderboard.teams} limit={5} /> : <Board board={s.leaderboard} limit={5} />}
      </div>
    );
  } else if (mode === "qa" && hl) {
    card = (
      <div class="ov-card ov-question">
        <div class="ov-kicker">
          <span class="tag hl">{t("Question")}</span>
          <span class="muted small">
            {hl.name || t("Anonymous")} · {plural(hl.votes - hl.downs, "vote")}
          </span>
        </div>
        <div class="ov-title">{hl.text}</div>
      </div>
    );
  }
  return (
    <div class={`overlay ${side}`} aria-live="polite">
      {card}
      <div class="ov-join">
        {tj("Join at {host} · code {code}", { host: <b>{location.host}</b>, code: <b class="ov-code">{code}</b> })}
      </div>
      {floaters}
    </div>
  );
}
