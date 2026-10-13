import { useEffect } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { Poll, Snapshot } from "../../shared/protocol";
import { activePoll, resultsOf, sortQuestions } from "../../shared/store";
import { useRoom } from "../lib/room";
import { t, tj } from "../lib/i18n";
import { CFG, joinUrl, plural, useTheme, useTitle } from "../lib/util";
import { Board, Brand, ConnProblem, Confetti, Countdown, Icon, Podium, QrCode, TeamBoard, ResultsView, TYPE_LABEL, useFloaters } from "../components/ui";

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

  let stage = null;
  if (s && mode === "poll") {
    stage = poll ? (
      <>
        <div class="stage-label">
          <span class="tag live">{poll.type === "quiz" ? t("Quiz") : t("Live poll")}</span>
          {poll.type !== "quiz" && <span>{TYPE_LABEL[poll.type]}</span>}
        </div>
        <div class={poll.type === "quiz" && !poll.revealed ? "split" : undefined}>
          <h1>{poll.title}</h1>
          {poll.type === "quiz" && !poll.revealed && <Countdown poll={poll} clockOffset={state.clockOffset} big />}
        </div>
        {poll.type === "quiz" && !poll.revealed ? (
          <QuizWaiting count={resultsOf(s, poll.id).total} options={poll.options} />
        ) : (
          <ResultsView poll={poll} results={resultsOf(s, poll.id)} code={code} big />
        )}
      </>
    ) : (
      <div class="feature" style={{ marginTop: "18vh" }}>
        {t("No poll running right now.")}
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
        ) : s.leaderboard.top.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: "4vw", alignItems: "end" }}>
            <Podium board={s.leaderboard} />
            <Board board={s.leaderboard} from={3} />
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
    const rest = qs.filter((q) => !q.highlighted).slice(0, hl ? 3 : 6);
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
  } else {
    stage = (
      <div style={{ marginTop: "16vh" }}>
        <div class="stage-label">{s?.meta.title}</div>
        <div class="feature" style={{ marginTop: "2vh", maxWidth: "16ch" }}>
          {tj("Join at {host} and enter {code}", { host, code: <span style={{ color: "var(--brand)" }}>{code}</span> })}
        </div>
      </div>
    );
  }

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
      <main aria-live="polite">{stage}</main>
      {floaters.layer}
    </div>
  );
}

function QuizWaiting({ count, options }: { count: number; options: string[] }) {
  return (
    <div class="stack">
      <div class="opts" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1.6vh 1.4vw" }}>
        {options.map((o, i) => (
          <div key={i} class={`opt tile q${i % 8}`} style={{ fontSize: "clamp(1.1rem, 1.8vw, 2.1rem)", minHeight: "11vh", cursor: "default" }}>
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
