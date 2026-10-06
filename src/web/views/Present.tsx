import { useEffect, useState } from "preact/hooks";
import { activePoll, resultsOf, sortQuestions } from "../../shared/store";
import { useRoom } from "../lib/room";
import { CFG, joinUrl, plural, useTheme, useTitle } from "../lib/util";
import { Board, Brand, ConnProblem, Confetti, Countdown, Icon, Podium, ResultsView, TYPE_LABEL, useFloaters } from "../components/ui";

function QrCode({ url }: { url: string }) {
  const [svg, setSvg] = useState("");
  // Loaded only on the big screen, so attendees' phones don't download it.
  useEffect(() => {
    import("qrcode-generator")
      .then(({ default: qrcode }) => {
        const qr = qrcode(0, "M");
        qr.addData(url);
        qr.make();
        setSvg(qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true }));
      })
      .catch(() => setSvg(""));
  }, [url]);
  return svg ? <div class="qr" dangerouslySetInnerHTML={{ __html: svg }} aria-label={`QR code for ${url}`} role="img" /> : null;
}

export function Present({ code }: { code: string }) {
  const key = decodeURIComponent(location.hash.slice(1));
  const floaters = useFloaters();
  const { state, status } = useRoom(code, "present", { key: key || undefined, onReactions: floaters.add });
  const s = state.snapshot;
  useTitle(s ? `${s.meta.title} · ${CFG.name}` : CFG.name);
  useTheme(s?.meta.settings.theme, s?.meta.settings.screen ?? "light");
  if (status === "not-found") return <ConnProblem status={status} code={code} />;

  const poll = s ? activePoll(s) : undefined;
  const mode = !s ? "code" : s.meta.presentMode === "auto" ? (poll ? "poll" : "qa") : s.meta.presentMode;
  const host = location.host;

  let stage = null;
  if (s && mode === "poll") {
    stage = poll ? (
      <>
        <div class="stage-label">
          <span class="tag live">{poll.type === "quiz" ? "Quiz" : "Live poll"}</span>
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
        No poll running right now.
      </div>
    );
  } else if (s && mode === "leaderboard") {
    stage = (
      <>
        <Confetti fire={s.leaderboard.rounds ? `lb-${s.leaderboard.rounds}` : null} />
        <div class="stage-label">
          <Icon.trophy /> {plural(s.leaderboard.rounds, "question")} played
        </div>
        <h1>Leaderboard</h1>
        {s.leaderboard.top.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1fr)", gap: "4vw", alignItems: "end" }}>
            <Podium board={s.leaderboard} />
            <Board board={s.leaderboard} from={3} />
          </div>
        ) : (
          <div class="feature muted">Scores appear after the first answer is revealed.</div>
        )}
      </>
    );
  } else if (s && mode === "qa") {
    const qs = sortQuestions(
      s.questions.filter((q) => q.status === "live"),
      "popular",
    );
    const hl = qs.find((q) => q.highlighted);
    const rest = qs.filter((q) => !q.highlighted).slice(0, hl ? 3 : 6);
    stage = (
      <>
        <div class="stage-label">{s.meta.title}</div>
        {hl && (
          <div class="now-answering" style={{ marginTop: "2vh" }}>
            <span class="tag hl">Now answering</span>
            <div class="feature" style={{ fontSize: "clamp(1.8rem, 3.2vw, 3.8rem)", marginTop: "1.5vh" }}>
              {hl.text}
            </div>
            <div class="meta">
              {hl.name || "Anonymous"}, {plural(hl.votes - hl.downs, "vote")}
            </div>
          </div>
        )}
        {!hl && <h1>Questions</h1>}
        <div class="q-list">
          {rest.map((q) => (
            <div class="q" key={q.id}>
              <div class="vote static num">
                <Icon.up />
                <span>{q.votes - q.downs}</span>
              </div>
              <div class="body">
                <div class="text">{q.text}</div>
                <div class="meta">{q.name || "Anonymous"}</div>
              </div>
            </div>
          ))}
        </div>
        {!rest.length && !hl && (
          <div class="feature muted" style={{ marginTop: "8vh", maxWidth: "18ch" }}>
            Ask a question at {host}
          </div>
        )}
      </>
    );
  } else {
    stage = (
      <div style={{ marginTop: "16vh" }}>
        <div class="stage-label">{s?.meta.title}</div>
        <div class="feature" style={{ marginTop: "2vh", maxWidth: "16ch" }}>
          Join at {host} and enter <span style={{ color: "var(--brand)" }}>{code}</span>
        </div>
      </div>
    );
  }

  return (
    <div class="present">
      <aside>
        <Brand />
        <div>
          <div class="join-at">Join at</div>
          <div class="join-host">{host}</div>
        </div>
        <div>
          <div class="join-at">Code</div>
          <div class="big-code" aria-label={`Event code ${code.split("").join(" ")}`}>
            {code}
          </div>
        </div>
        <QrCode url={joinUrl(code)} />
        <div class="people num">
          {s?.online ?? 0} {(s?.online ?? 0) === 1 ? "person" : "people"} here
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
        {plural(count, "answer")} so far
      </p>
    </div>
  );
}
