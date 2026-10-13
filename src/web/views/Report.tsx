import { useEffect } from "preact/hooks";
import { resultsOf, sortQuestions } from "../../shared/store";
import { useRoom } from "../lib/room";
import { CFG, plural, useTheme, useTitle } from "../lib/util";
import { Board, Brand, ConnProblem, Empty, Podium, ResultsView, TYPE_LABEL } from "../components/ui";
import { t, lang } from "../lib/i18n";

/** A clean summary of the event. Print it or "Save as PDF" from the browser. */
export function Report({ code }: { code: string }) {
  const key = decodeURIComponent(location.hash.slice(1));
  const { state, status } = useRoom(code, "host", { key });
  const s = state.snapshot;
  useTitle(s ? t("{title} report", { title: s.meta.title }) : CFG.name);
  useTheme(s?.meta.settings.theme, "light", s?.meta.settings.brand);
  useEffect(() => {
    if (new URLSearchParams(location.search).has("print") && s) setTimeout(() => print(), 600);
  }, [!!s]);

  if (!key || status === "forbidden") return <ConnProblem status="forbidden" code={code} />;
  if (status === "not-found") return <ConnProblem status={status} code={code} />;
  if (!s) return <div class="report muted">{t("Loading…")}</div>;

  const questions = sortQuestions(
    s.questions.filter((q) => q.status !== "pending"),
    "popular",
  );
  const polls = s.polls.filter((p) => p.status !== "draft");
  const responses = polls.reduce((n, p) => n + resultsOf(s, p.id).total, 0);
  const votes = s.questions.reduce((n, q) => n + q.votes + q.downs, 0);

  return (
    <main class="report">
      <div class="spread no-print" style={{ marginBottom: 24 }}>
        <Brand />
        <button class="btn" onClick={() => print()}>
          {t("Print or save as PDF")}
        </button>
      </div>
      <p class="muted">{t("Event report, code {code}", { code })}</p>
      <h1>{s.meta.title}</h1>
      <p class="muted" style={{ marginTop: 6 }}>
        {t("Made {date}", { date: new Date().toLocaleString(lang) })}
      </p>
      <div class="stats">
        <div>
          <b class="num">{s.questions.length}</b>
          <span class="muted">{t("questions asked")}</span>
        </div>
        <div>
          <b class="num">{votes}</b>
          <span class="muted">{t("votes on questions")}</span>
        </div>
        <div>
          <b class="num">{polls.length}</b>
          <span class="muted">{t("polls run")}</span>
        </div>
        <div>
          <b class="num">{responses}</b>
          <span class="muted">{t("poll answers")}</span>
        </div>
      </div>

      <section>
        <h2>{t("Questions")}</h2>
        {questions.length ? (
          <ol style={{ paddingLeft: 22 }}>
            {questions.map((q) => (
              <li key={q.id} style={{ margin: "10px 0" }}>
                <div>{q.text}</div>
                <div class="muted small">
                  {t("{name}, score {score}", { name: q.name || t("Anonymous"), score: q.votes - q.downs })}
                  {q.status === "answered" ? t(", answered") : q.status === "archived" ? t(", archived") : ""}
                </div>
                {q.replies.map((r) => (
                  <div key={r.id} class="small" style={{ margin: "4px 0 0 12px" }}>
                    ↳ <b>{r.name || t("Anonymous")}:</b> {r.text}
                  </div>
                ))}
              </li>
            ))}
          </ol>
        ) : (
          <Empty>{t("No questions were asked.")}</Empty>
        )}
      </section>

      <section>
        <h2>{t("Polls")}</h2>
        {polls.length ? (
          polls.map((p) => (
            <div class="r-poll" key={p.id}>
              <p class="muted small">{TYPE_LABEL[p.type]}</p>
              <h3 style={{ margin: "4px 0 14px" }}>{p.title}</h3>
              <ResultsView poll={{ ...p, revealed: true }} results={resultsOf(s, p.id)} code={code} />
            </div>
          ))
        ) : (
          <Empty>{t("No polls were run.")}</Empty>
        )}
      </section>

      {s.leaderboard.rounds > 0 && (
        <section>
          <h2>{t("Quiz leaderboard")}</h2>
          <p class="muted small" style={{ marginBottom: 16 }}>
            {plural(s.leaderboard.players, "player")}, {plural(s.leaderboard.rounds, "question")}
          </p>
          <Podium board={s.leaderboard} />
          <Board board={s.leaderboard} afterPodium />
        </section>
      )}
    </main>
  );
}
