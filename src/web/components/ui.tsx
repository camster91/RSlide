import type { ComponentChildren } from "preact";
import type { Poll, Question, Results as ResultsData } from "../../shared/protocol";
import { ago, CFG, plural } from "../lib/util";
import type { ConnStatus } from "../lib/room";

export const TYPE_LABEL: Record<Poll["type"], string> = {
  multiple: "Multiple choice",
  quiz: "Quiz",
  rating: "Rating",
  wordcloud: "Word cloud",
  open: "Open text",
};

export function Brand() {
  return (
    <a class="brand" href="/">
      {CFG.logoUrl ? <img src={CFG.logoUrl} alt={CFG.name} style={{ height: 28, display: "block" }} /> : <b>{CFG.name}</b>}
    </a>
  );
}

export function TopBar({ title, children }: { title?: string; children?: ComponentChildren }) {
  return (
    <header class="bar">
      <Brand />
      <div class="title">{title}</div>
      {children}
    </header>
  );
}

export function ConnDot({ status }: { status: ConnStatus }) {
  const on = status === "online";
  return (
    <span class="chip" title={on ? "Connected" : "Reconnecting…"}>
      <span class={`dot ${on ? "" : "off"}`} />
    </span>
  );
}

export function UpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

export function Empty({ children }: { children: ComponentChildren }) {
  return <div class="empty">{children}</div>;
}

export function Message({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <>
      <TopBar />
      <div class="wrap">
        <div class="card stack">
          <h2>{title}</h2>
          {children}
          <a class="btn" href="/">
            Back to start
          </a>
        </div>
      </div>
    </>
  );
}

/** Screens for a connection that can't continue. Returns null when all is fine. */
export function ConnProblem({ status, code }: { status: ConnStatus; code: string }) {
  if (status === "not-found")
    return (
      <Message title="Event not found">
        <p class="muted">
          We couldn't find an event with code <b>{code}</b>. It may have ended.
        </p>
      </Message>
    );
  if (status === "full")
    return (
      <Message title="This event is full">
        <p class="muted">The host's participant limit has been reached. Try again in a bit.</p>
      </Message>
    );
  if (status === "forbidden")
    return (
      <Message title="Host link needed">
        <p class="muted">Open this event from the private host link you got when you created it.</p>
      </Message>
    );
  return null;
}

// ---------- poll results ----------

const CLOUD_COLORS = ["var(--brand)", "var(--link)", "#8a5b00", "var(--brand-2)", "#1f8a5b"];

export function ResultsView({ poll, results, big = false }: { poll: Poll; results: ResultsData; big?: boolean }) {
  if (results.hidden) return <p class="muted small">{plural(results.total, "response")} so far. Results are hidden by the host.</p>;
  const total = results.total;
  let body: ComponentChildren = null;

  if ((poll.type === "multiple" || poll.type === "quiz") && results.counts) {
    const denom = Math.max(1, total);
    body = poll.options.map((o, i) => {
      const pct = Math.round(((results.counts![i] ?? 0) / denom) * 100);
      const ok = poll.correct?.includes(i);
      return (
        <div class={`res ${ok ? "correct" : ""}`} key={i}>
          <div class="lbl">
            <span>
              {ok ? "✓ " : ""}
              {o}
            </span>
            <b>{pct}%</b>
          </div>
          <div class="track">
            <div class="fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      );
    });
  } else if (poll.type === "rating" && results.counts) {
    const max = Math.max(1, ...results.counts);
    body = (
      <>
        <div class="feature" style={{ textAlign: "center", fontSize: big ? 72 : 40 }}>
          {results.avg || "–"}
          <span class="muted" style={{ fontSize: "0.4em" }}>
            {" "}
            / {poll.scale || 5}
          </span>
        </div>
        {results.counts
          .map((c, i) => (
            <div class="res" key={i}>
              <div class="lbl">
                <span>{"★".repeat(i + 1)}</span>
                <b>{c}</b>
              </div>
              <div class="track">
                <div class="fill" style={{ width: `${(c / max) * 100}%`, background: "var(--accent)" }} />
              </div>
            </div>
          ))
          .reverse()}
      </>
    );
  } else if (poll.type === "wordcloud" && results.words) {
    const max = Math.max(1, ...results.words.map((w) => w[1]));
    const base = big ? 20 : 14;
    const span = big ? 64 : 30;
    body = results.words.length ? (
      <div class="cloud">
        {results.words.map(([w, c], i) => (
          <span key={w} title={String(c)} style={{ fontSize: base + (c / max) * span, color: CLOUD_COLORS[i % CLOUD_COLORS.length] }}>
            {w}
          </span>
        ))}
      </div>
    ) : (
      <Empty>Words will appear here</Empty>
    );
  } else if (poll.type === "open" && results.answers) {
    body = results.answers.length ? (
      <ul class="answers">
        {results.answers.slice(0, big ? 12 : 50).map((a, i) => (
          <li key={i}>{a}</li>
        ))}
      </ul>
    ) : (
      <Empty>Answers will appear here</Empty>
    );
  }

  return (
    <>
      {body}
      <p class="muted small" style={{ marginTop: 10 }}>
        {plural(total, "response")}
      </p>
    </>
  );
}

// ---------- questions ----------

export function QuestionMeta({ q }: { q: Question }) {
  return (
    <div class="meta">
      <span>{q.name || "Anonymous"}</span>
      <span>·</span>
      <span>{ago(q.ts)}</span>
      {q.status === "pending" && <span class="tag pending">Waiting for approval</span>}
      {q.status === "answered" && <span class="tag answered">Answered</span>}
    </div>
  );
}

export function VoteCount({ votes }: { votes: number }) {
  return (
    <div class="vote" style={{ cursor: "default" }} aria-label={plural(votes, "vote")}>
      <UpIcon />
      <span>{votes}</span>
    </div>
  );
}
