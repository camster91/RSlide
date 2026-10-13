import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Analytics as Data } from "../../shared/protocol";
import { CFG, plural, useTheme, useTitle } from "../lib/util";
import { Brand, Empty, Message, TYPE_LABEL } from "../components/ui";
import { t, pluralWord, lang } from "../lib/i18n";

type Bucket = Data["timeline"][number];

/** Joins empty minutes and groups long events into bigger buckets, so the chart stays readable. */
function buckets(timeline: Bucket[]): { size: number; rows: Bucket[] } {
  if (!timeline.length) return { size: 1, rows: [] };
  const first = timeline[0].t;
  const last = timeline[timeline.length - 1].t;
  const minutes = Math.round((last - first) / 60_000) + 1;
  const size = [1, 2, 5, 10, 15, 30, 60, 120, 240, 1440].find((m) => minutes / m <= 90) ?? 1440;
  const step = size * 60_000;
  const start = Math.floor(first / step) * step;
  const rows: Bucket[] = [];
  for (let t = start; t <= last; t += step) rows.push({ t, joins: 0, questions: 0, votes: 0, answers: 0, reactions: 0 });
  for (const b of timeline) {
    const r = rows[Math.floor((b.t - start) / step)];
    if (!r) continue;
    r.joins += b.joins;
    r.questions += b.questions;
    r.votes += b.votes;
    r.answers += b.answers;
    r.reactions += b.reactions;
  }
  return { size, rows };
}
const total = (b: Bucket) => b.joins + b.questions + b.votes + b.answers + b.reactions;
const time = (t: number) => new Date(t).toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit" });

function ActivityChart({ timeline }: { timeline: Bucket[] }) {
  const { size, rows } = useMemo(() => buckets(timeline), [timeline]);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  if (!rows.length) return <Empty>{t("Activity shows here once people join.")}</Empty>;
  const W = 720;
  const H = 220;
  const padL = 36;
  const padB = 24;
  const padT = 12;
  const max = Math.max(1, ...rows.map(total));
  const nice = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / nice) * nice;
  const bw = (W - padL) / rows.length;
  const y = (v: number) => padT + (H - padB - padT) * (1 - v / top);
  const ticks = [0, top / 2, top];
  const labelEvery = Math.ceil(rows.length / 6);
  const h = hover !== null ? rows[hover] : null;
  return (
    <div class="chart" ref={box} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={size === 1 ? t("Actions per minute") : t("Actions per {n} minutes", { n: size })}>
        {ticks.map((v) => (
          <g key={v}>
            <line class="gridline" x1={padL} x2={W} y1={y(v)} y2={y(v)} />
            <text class="axis-text" x={padL - 6} y={y(v) + 4} text-anchor="end">
              {Math.round(v).toLocaleString(lang)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const v = total(r);
          const x = padL + i * bw;
          const bh = (H - padB) - y(v);
          // Keep bars slim even when there are only a few of them.
          const w = Math.max(1, Math.min(bw - 2, 44));
          const bx = x + (bw - w) / 2;
          return (
            <g key={r.t}>
              {v > 0 && <path class={`bar-mark ${hover !== null && hover !== i ? "dim" : ""}`} d={`M${bx},${H - padB} v${-Math.max(0, bh - 4)} q0,-4 4,-4 h${Math.max(0, w - 8)} q4,0 4,4 v${Math.max(0, bh - 4)} z`} />}
              <rect class="hit" x={x} y={0} width={bw} height={H - padB} onMouseEnter={() => setHover(i)} />
              {i % labelEvery === 0 && (
                <text class="axis-text" x={x + bw / 2} y={H - 6} text-anchor="middle">
                  {time(r.t)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {h && hover !== null && (
        <div class="chart-tip" style={{ left: `${((padL + (hover + 0.5) * bw) / W) * 100}%`, top: `${(y(total(h)) / H) * 100}%` }}>
          <b>{time(h.t)}</b>
          <br />
          {(
            [
              ["joined", h.joins, t("{n} joined", { n: h.joins })],
              ["question", h.questions, plural(h.questions, "question")],
              ["vote", h.votes, plural(h.votes, "vote")],
              ["answer", h.answers, plural(h.answers, "answer")],
              ["reaction", h.reactions, plural(h.reactions, "reaction")],
            ] as [string, number, string][]
          )
            .filter(([, n]) => n)
            .map(([l, , text]) => (
              <div key={l}>{text}</div>
            ))}
          {!total(h) && <div>{t("No activity")}</div>}
        </div>
      )}
      <table class="sr-table">
        <caption>{t("Activity over time")}</caption>
        <thead>
          <tr>
            <th>{t("Time")}</th>
            <th>{t("Joined")}</th>
            <th>{t("Questions")}</th>
            <th>{t("Votes")}</th>
            <th>{t("Answers")}</th>
            <th>{t("Reactions")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.t}>
              <td>{time(r.t)}</td>
              <td>{r.joins}</td>
              <td>{r.questions}</td>
              <td>{r.votes}</td>
              <td>{r.answers}</td>
              <td>{r.reactions}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted tiny" style={{ marginTop: 6 }}>
        {size === 1 ? t("Everything people did, per minute. Hover a bar for the breakdown.") : t("Everything people did, per {n} minutes. Hover a bar for the breakdown.", { n: size })}
      </p>
    </div>
  );
}

function HBar({ label, value, pct, note }: { label: string; value: string; pct: number; note?: string }) {
  return (
    <div class="res">
      <div class="lbl">
        <span>
          {label}
          {note && <span class="muted small">{note}</span>}
        </span>
        <b>{value}</b>
      </div>
      <div class="track">
        <div class="fill" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

/** One event's analytics. From a team workspace (`team`), viewers can see it without the host link. */
export function Analytics({ code, team }: { code: string; team?: string }) {
  const key = team ? "" : decodeURIComponent(location.hash.slice(1));
  const [data, setData] = useState<Data | null | "forbidden">(null);
  useTitle(data && data !== "forbidden" ? t("Analytics: {title}", { title: data.title }) : CFG.name);
  useTheme(undefined);
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch(team ? `/api/workspaces/${team}/events/${code}/analytics` : `/api/events/${code}/analytics?key=${encodeURIComponent(key)}`)
        .then((r) => (r.status === 403 || r.status === 404 ? "forbidden" : r.json()))
        .then((d) => !stop && setData(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [code, key]);

  if (data === "forbidden" || (!key && !team)) return <Message title={t("Host link needed")}>{t("Open analytics from the host console of your event.")}</Message>;
  if (!data) return <div class="report muted">{t("Loading…")}</div>;
  const p = Math.max(1, data.participants);
  const answered = data.polls.reduce((n, x) => n + x.responses, 0);

  return (
    <main class="report">
      <div class="spread" style={{ marginBottom: 24 }}>
        <Brand />
        {team ? (
          <a class="btn ghost sm" href={`/teams/${team}`}>
            {t("Back to workspace")}
          </a>
        ) : (
          <a class="btn ghost sm" href={`/host/${code}#${key}`}>
            {t("Back to host console")}
          </a>
        )}
      </div>
      <p class="muted">{t("Analytics, code {code}. Updates every 30 seconds.", { code })}</p>
      <h1>{data.title}</h1>

      <section class="stats-row" style={{ marginTop: 20 }}>
        <div class="stat">
          <b>{data.participants}</b>
          <span>{t("people joined")}</span>
        </div>
        <div class="stat">
          <b>{data.peakOnline}</b>
          <span>{data.peakAt ? t("most online at once, at {time}", { time: time(data.peakAt) }) : t("most online at once")}</span>
        </div>
        <div class="stat">
          <b>{data.questions}</b>
          <span>
            {t("{questions} from {people} ({pct}% of people)", { questions: pluralWord(data.questions, "question"), people: plural(data.askers, "person"), pct: Math.round((data.askers / p) * 100) })}
          </span>
        </div>
        <div class="stat">
          <b>{answered}</b>
          <span>{t("poll answers")}</span>
        </div>
        <div class="stat">
          <b>{data.votes}</b>
          <span>{t("votes on questions")}</span>
        </div>
        <div class="stat">
          <b>{data.reactions}</b>
          <span>{t("reactions")}</span>
        </div>
      </section>

      <section>
        <h2>{t("Activity over time")}</h2>
        <div style={{ marginTop: 14 }}>
          <ActivityChart timeline={data.timeline} />
        </div>
      </section>

      <section>
        <h2>{t("Poll response rate")}</h2>
        <p class="muted small" style={{ margin: "4px 0 14px" }}>
          {t("Share of everyone who joined that answered each poll.")}
        </p>
        {data.polls.length ? (
          data.polls.map((x) => <HBar key={x.id} label={x.title} note={` · ${TYPE_LABEL[x.type]}`} value={`${Math.round((x.responses / p) * 100)}% (${x.responses})`} pct={(x.responses / p) * 100} />)
        ) : (
          <Empty>{t("No polls have been launched yet.")}</Empty>
        )}
      </section>

      <section>
        <h2>{t("Top questions")}</h2>
        {data.topQuestions.length ? (
          <ol style={{ paddingLeft: 22 }}>
            {data.topQuestions.map((q, i) => (
              <li key={i} style={{ margin: "10px 0" }}>
                {q.text}
                <div class="muted small">
                  {t("Score {score}", { score: q.score })}
                  {q.status === "answered" ? t(", answered") : ""}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <Empty>{t("No questions yet.")}</Empty>
        )}
      </section>

      {data.rooms.length > 1 && (
        <section>
          <h2>{t("Questions by room")}</h2>
          <div style={{ marginTop: 14 }}>
            {data.rooms.map((r) => (
              <HBar key={r.name} label={r.name} value={String(r.questions)} pct={(r.questions / Math.max(1, data.questions)) * 100} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
