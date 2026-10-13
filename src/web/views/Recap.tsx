import { useEffect, useState } from "preact/hooks";
import type { Recap as RecapData } from "../../shared/protocol";
import { CFG, plural, useTheme, useTitle } from "../lib/util";
import { Board, Brand, Empty, LangPicker, Message, Podium, ResultsView, TeamBoard, TYPE_LABEL } from "../components/ui";
import { t, tj, lang } from "../lib/i18n";

/** Public recap of an event, shared by the host after it ends. */
export function Recap({ code }: { code: string }) {
  const [data, setData] = useState<RecapData | null | "missing">(null);
  useEffect(() => {
    fetch(`/api/events/${code}/recap`)
      .then((r) => (r.ok ? r.json() : "missing"))
      .then(setData)
      .catch(() => setData("missing"));
  }, [code]);
  const d = data && data !== "missing" ? data : null;
  useTitle(d ? t("{title} recap", { title: d.title }) : CFG.name);
  useTheme(d?.theme, "light");

  if (data === "missing")
    return (
      <Message title={t("No recap here yet")}>
        <p class="muted">{t("The host hasn't shared a recap for event {code}. Check back later.", { code })}</p>
      </Message>
    );
  if (!d) return <div class="report muted">{t("Loading…")}</div>;

  const { stats } = d;
  return (
    <main class="report recap">
      <div class="spread no-print" style={{ marginBottom: 24 }}>
        <Brand logo={d.logo} code={code} />
        <button class="btn sm ghost" onClick={() => print()}>
          {t("Print or save as PDF")}
        </button>
      </div>
      <p class="muted">{t("Event recap · {date}", { date: new Date(d.createdAt).toLocaleDateString(lang, { dateStyle: "long" }) })}</p>
      <h1>{d.title}</h1>
      {d.summary && (
        <div class="recap-summary">
          {d.summary.split(/\n{2,}/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      )}
      <div class="stats">
        {(
          [
            [stats.participants, t("people took part")],
            [stats.questions, t("questions asked")],
            [stats.votes, t("votes on questions")],
            [stats.answers, t("poll answers")],
          ] as const
        ).map(([n, label]) => (
          <div key={label}>
            <b class="num">{n.toLocaleString(lang)}</b>
            <span class="muted">{label}</span>
          </div>
        ))}
      </div>

      <section>
        <h2>{t("Top questions")}</h2>
        {d.questions.length ? (
          <ol class="recap-qs">
            {d.questions.map((q, i) => (
              <li key={i}>
                <div class="recap-q-head">
                  <span class="text">{q.text}</span>
                  {q.answered && <span class="tag answered">{t("Answered")}</span>}
                </div>
                <div class="muted small">
                  {q.name || t("Anonymous")} · {plural(q.score, "vote")}
                </div>
                {q.replies.map((r) => (
                  <div key={r.id} class="recap-reply">
                    <b>{r.name === "Host" ? t("Host") : r.name === "Moderator" ? t("Moderator") : r.name}:</b> {r.text}
                  </div>
                ))}
              </li>
            ))}
          </ol>
        ) : (
          <Empty>{t("No questions were asked.")}</Empty>
        )}
      </section>

      {d.polls.length > 0 && (
        <section>
          <h2>{t("Polls")}</h2>
          {d.polls.map(({ poll, results }) => (
            <div class="r-poll" key={poll.id}>
              <p class="muted small">{TYPE_LABEL[poll.type]}</p>
              <h3 style={{ margin: "4px 0 14px" }}>{poll.title}</h3>
              <ResultsView poll={{ ...poll, revealed: true }} results={results} code={code} />
            </div>
          ))}
        </section>
      )}

      {d.leaderboard && (
        <section>
          <h2>{t("Quiz leaderboard")}</h2>
          <p class="muted small" style={{ marginBottom: 16 }}>
            {plural(d.leaderboard.players, "player")}, {plural(d.leaderboard.rounds, "question")}
          </p>
          {d.leaderboard.teams && d.leaderboard.teams.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <TeamBoard teams={d.leaderboard.teams} />
            </div>
          )}
          <Podium board={d.leaderboard} />
          <Board board={d.leaderboard} afterPodium />
        </section>
      )}

      <p class="muted tiny recap-foot">
        {tj("Made with {name}, free and open source.", {
          name: (
            <a href="https://github.com/camster91/RSlide" target="_blank" rel="noopener">
              {CFG.name}
            </a>
          ),
        })}
      </p>
      <div class="no-print" style={{ textAlign: "center", marginTop: 8 }}>
        <LangPicker label />
      </div>
    </main>
  );
}
