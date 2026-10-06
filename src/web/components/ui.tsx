import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Item, Leaderboard, Poll, PollType, Question, Reaction, Results as ResultsData } from "../../shared/protocol";
import { secondsLeft } from "../../shared/store";
import type { ConnStatus } from "../lib/room";
import { ago, CFG, mediaUrl, plural } from "../lib/util";

export const TYPE_LABEL: Record<PollType, string> = {
  multiple: "Multiple choice",
  quiz: "Quiz",
  rating: "Rating",
  scale: "Scale",
  ranking: "Ranking",
  wordcloud: "Word cloud",
  open: "Open text",
  survey: "Survey",
};

export const TYPE_HINT: Record<PollType, string> = {
  multiple: "Pick one or more",
  quiz: "Timer and points",
  rating: "1 to 5 stars",
  scale: "Number scale",
  ranking: "Put in order",
  wordcloud: "Short words",
  open: "Free text",
  survey: "Several questions",
};

// ---------- icons (inline so there's nothing extra to load) ----------
const svg = (d: ComponentChildren, label?: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden={label ? undefined : "true"} aria-label={label}>
    {d}
  </svg>
);
export const Icon = {
  up: () => svg(<path d="M12 19V5M5 12l7-7 7 7" />),
  down: () => svg(<path d="M12 5v14M5 12l7 7 7-7" />),
  chat: () => svg(<path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z" />),
  chart: () => svg(<path d="M5 20V10M12 20V4M19 20v-7" />),
  trophy: () => svg(<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 6h3v2a3 3 0 0 1-3 3M7 6H4v2a3 3 0 0 0 3 3" />),
  gear: () => svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>),
  image: () => svg(<><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>),
  x: () => svg(<path d="M18 6 6 18M6 6l12 12" />),
  smile: () => svg(<><circle cx="12" cy="12" r="9" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" /></>),
};

// ---------- chrome ----------

export function Brand() {
  return (
    <a class="brand" href="/" aria-label={`${CFG.name} home`}>
      {CFG.logoUrl ? (
        <img src={CFG.logoUrl} alt={CFG.name} style={{ height: 28 }} />
      ) : (
        <>
          <span class="brand-mark" aria-hidden="true" />
          <b>{CFG.name}</b>
        </>
      )}
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
    <span class="chip" title={on ? "Connected" : "Reconnecting…"} aria-label={on ? "Connected" : "Reconnecting"}>
      <span class={`dot ${on ? "" : "off"}`} />
    </span>
  );
}

export function Empty({ title, children }: { title?: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      {title && <b>{title}</b>}
      {children}
    </div>
  );
}

export function Message({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <>
      <TopBar />
      <div class="gate">
        <div class="panel stack">
          <h1>{title}</h1>
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
          There's no event with code <b>{code}</b>. Check the code, or ask the host if it has ended.
        </p>
      </Message>
    );
  if (status === "full")
    return (
      <Message title="This event is full">
        <p class="muted">The host's participant limit has been reached. Try again in a few minutes.</p>
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

// ---------- time ----------

/** Re-renders every `ms` while `active`. */
export function useTick(active: boolean, ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [active, ms]);
}

export function Countdown({ poll, clockOffset, big = false }: { poll: Poll; clockOffset: number; big?: boolean }) {
  const left = secondsLeft(poll, clockOffset);
  useTick(left !== null && left > 0);
  if (left === null) return null;
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = poll.timeLimit ? left / poll.timeLimit : 0;
  return (
    <div class={`countdown ${big ? "big" : ""} ${left <= 5 ? "low" : ""}`} role="timer" aria-label={`${left} seconds left`}>
      <svg viewBox="0 0 60 60">
        <circle class="bg" cx="30" cy="30" r={r} />
        <circle class="fg" cx="30" cy="30" r={r} stroke-dasharray={c} stroke-dashoffset={c * (1 - frac)} />
      </svg>
      <b>{left}</b>
    </div>
  );
}

// ---------- results ----------

const CLOUD_COLORS = ["var(--brand)", "var(--text)", "color-mix(in srgb, var(--brand) 60%, var(--accent))", "var(--muted)"];

function Bar({ label, value, pct, img, lead, correct }: { label: ComponentChildren; value: string; pct: number; img?: string | null; lead?: boolean; correct?: boolean }) {
  return (
    <div class={`res ${lead ? "lead" : ""} ${correct ? "correct" : ""}`}>
      <div class="lbl">
        <span>
          {img && <img class="thumb" src={img} alt="" />}
          {label}
        </span>
        <b>{value}</b>
      </div>
      <div class="track">
        <div class="fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
}

function ItemResults({ item, r, code, big, correct }: { item: Item; r: ResultsData; code: string; big: boolean; correct?: number[] }) {
  const img = (i: number) => (item.images?.[i] ? mediaUrl(code, item.images[i]!) : null);
  if ((item.type === "multiple" || item.type === "quiz") && r.counts) {
    const denom = Math.max(1, r.total);
    const max = Math.max(...r.counts);
    return (
      <>
        {item.options.map((o, i) => {
          const pct = Math.round((r.counts![i] / denom) * 100);
          return <Bar key={i} label={o} value={`${pct}%`} pct={pct} img={img(i)} lead={!correct && max > 0 && r.counts![i] === max} correct={correct?.includes(i)} />;
        })}
      </>
    );
  }
  if (item.type === "ranking" && r.scores) {
    const max = Math.max(item.options.length - 1, 1);
    const order = item.options.map((o, i) => ({ o, i, s: r.scores![i] })).sort((a, b) => b.s - a.s);
    return (
      <>
        {order.map((x, pos) => (
          <Bar key={x.i} label={`${pos + 1}. ${x.o}`} value={x.s.toFixed(1)} pct={(x.s / max) * 100} img={img(x.i)} lead={pos === 0 && r.total > 0} />
        ))}
        <p class="muted tiny" style={{ marginTop: 8 }}>
          Score = average points (top place = {max}).
        </p>
      </>
    );
  }
  if ((item.type === "rating" || item.type === "scale") && r.counts) {
    const max = Math.max(1, ...r.counts);
    const min = item.type === "rating" ? 1 : (item.range?.min ?? 1);
    const top = item.type === "rating" ? item.scale || 5 : (item.range?.max ?? 10);
    return (
      <>
        {r.total ? (
          <div class="avg num">
            {r.avg}
            <small> / {top}</small>
          </div>
        ) : (
          <p class="avg-empty">No answers yet</p>
        )}
        <div class="hist" aria-label="Spread of answers">
          {r.counts.map((c, i) => (
            <div key={i} title={`${min + i}: ${c}`}>
              <span>{c || ""}</span>
              <i style={{ height: `${(c / max) * 100}%` }} />
              <span>{item.type === "rating" ? `${min + i}★` : min + i}</span>
            </div>
          ))}
        </div>
        {item.type === "scale" && (item.range?.minLabel || item.range?.maxLabel) && (
          <div class="scale-ends">
            <span>{item.range?.minLabel}</span>
            <span>{item.range?.maxLabel}</span>
          </div>
        )}
      </>
    );
  }
  if (item.type === "wordcloud" && r.words) {
    if (!r.words.length) return <Empty>Words will appear here as people send them.</Empty>;
    const max = Math.max(1, ...r.words.map((w) => w[1]));
    const base = big ? 22 : 15;
    const span = big ? 78 : 34;
    return (
      <div class="cloud">
        {r.words.map(([w, c], i) => (
          <span key={w} title={plural(c, "vote")} style={{ fontSize: base + Math.sqrt(c / max) * span, color: CLOUD_COLORS[i % CLOUD_COLORS.length] }}>
            {w}
          </span>
        ))}
      </div>
    );
  }
  if (item.type === "open" && r.answers) {
    if (!r.answers.length) return <Empty>Answers will appear here as people send them.</Empty>;
    return (
      <ul class="answers">
        {r.answers.slice(0, big ? 10 : 50).map((a, i) => (
          <li key={i}>{a}</li>
        ))}
      </ul>
    );
  }
  return null;
}

export function ResultsView({ poll, results, code, big = false }: { poll: Poll; results: ResultsData; code: string; big?: boolean }) {
  if (results.hidden)
    return (
      <p class="muted">
        {plural(results.total, "response")} so far.{" "}
        {poll.type === "quiz" ? "Results show when the answer is revealed." : "The host is keeping results hidden for now."}
      </p>
    );
  if (poll.type === "survey")
    return (
      <div class="survey-res">
        {poll.items.map((it, i) => (
          <div key={i}>
            <h3 style={{ marginBottom: 10 }}>{it.title}</h3>
            <ItemResults item={it} r={results.items?.[i] ?? { total: 0 }} code={code} big={big} />
            <p class="muted tiny" style={{ marginTop: 8 }}>
              {plural(results.items?.[i]?.total ?? 0, "answer")}
            </p>
          </div>
        ))}
        <p class="muted small">
          {results.total} {results.total === 1 ? "person" : "people"} took part
        </p>
      </div>
    );
  return (
    <>
      <ItemResults item={poll as unknown as Item} r={results} code={code} big={big} correct={poll.type === "quiz" ? poll.correct : undefined} />
      <p class="muted small" style={{ marginTop: 12 }}>
        {plural(results.total, "response")}
      </p>
    </>
  );
}

// ---------- questions ----------

export function QuestionMeta({ q, mine }: { q: Question; mine?: boolean }) {
  return (
    <div class="meta">
      <span>{mine ? "You" : q.name || "Anonymous"}</span>
      <span>{ago(q.ts)}</span>
      {q.edited && <span>edited</span>}
      {q.status === "pending" && <span class="tag pending">Waiting for approval</span>}
      {q.status === "answered" && <span class="tag answered">Answered</span>}
      {q.status === "archived" && <span class="tag archived">Archived</span>}
    </div>
  );
}

export function VoteCount({ q }: { q: Question }) {
  const s = q.votes - q.downs;
  return (
    <div class="vote static num" aria-label={`Score ${s}: ${plural(q.votes, "upvote")}, ${plural(q.downs, "downvote")}`} title={q.downs ? `${q.votes} up, ${q.downs} down` : undefined}>
      <Icon.up />
      <span>{s}</span>
    </div>
  );
}

// ---------- leaderboard ----------

export function Podium({ board }: { board: Leaderboard }) {
  const [a, b, c] = board.top;
  const step = (e: Leaderboard["top"][number] | undefined, place: 1 | 2 | 3) => (
    <div class={`step p${place}`}>
      {e ? (
        <>
          <div class="who">{e.name}</div>
          <div class="pts num">{e.points.toLocaleString()} pts</div>
        </>
      ) : (
        <div class="pts">—</div>
      )}
      <div class="block" aria-label={`Place ${place}`}>
        {place}
      </div>
    </div>
  );
  return (
    <div class="podium">
      {step(b, 2)}
      {step(a, 1)}
      {step(c, 3)}
    </div>
  );
}

export function Board({ board, from = 0, limit = 10 }: { board: Leaderboard; from?: number; limit?: number }) {
  const rows = board.top.slice(from, limit);
  if (!rows.length) return null;
  return (
    <ol class="board" start={from + 1}>
      {rows.map((e, i) => (
        <li key={i}>
          <span class="rank">{from + i + 1}</span>
          <span class="grow">{e.name}</span>
          <span class="muted small">{plural(e.correct, "correct answer")}</span>
          <span class="pts">{e.points.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}

// ---------- motion ----------

/** Emoji that float up the screen. Returns a layer to render and a function to add reactions. */
export function useFloaters(maxPerBatch = 24) {
  const [items, setItems] = useState<{ id: number; e: string; left: number; drift: number; size: number; dur: number }[]>([]);
  const next = useRef(0);
  const add = (counts: Partial<Record<Reaction, number>>) => {
    const batch: typeof items = [];
    for (const [e, n] of Object.entries(counts)) {
      for (let i = 0; i < Math.min(n ?? 0, maxPerBatch); i++)
        batch.push({ id: next.current++, e, left: 55 + Math.random() * 40, drift: (Math.random() - 0.5) * 160, size: 32 + Math.random() * 28, dur: 2.6 + Math.random() * 1.6 });
    }
    if (!batch.length) return;
    setItems((cur) => [...cur.slice(-80), ...batch]);
    const ids = new Set(batch.map((b) => b.id));
    setTimeout(() => setItems((cur) => cur.filter((x) => !ids.has(x.id))), 4500);
  };
  const layer = (
    <div class="float-layer" aria-hidden="true">
      {items.map((x) => (
        <span key={x.id} style={{ left: `${x.left}%`, "--drift": `${x.drift}px`, "--size": `${x.size}px`, "--dur": `${x.dur}s` }}>
          {x.e}
        </span>
      ))}
    </div>
  );
  return { layer, add };
}

const CONFETTI_COLORS = ["var(--brand)", "var(--accent)", "#e0475b", "#1a9e6a", "#7b4fd8", "#0b8bb5"];

/** A short burst of confetti whenever `fire` changes to a new truthy value. */
export function Confetti({ fire }: { fire: unknown }) {
  const [pieces, setPieces] = useState<{ id: number; left: number; color: string; dur: number; delay: number; drift: number; spin: number }[]>([]);
  useEffect(() => {
    if (!fire) return;
    const p = Array.from({ length: 90 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      dur: 2.2 + Math.random() * 1.8,
      delay: Math.random() * 0.6,
      drift: (Math.random() - 0.5) * 200,
      spin: (Math.random() - 0.5) * 1440,
    }));
    setPieces(p);
    const t = setTimeout(() => setPieces([]), 4800);
    return () => clearTimeout(t);
  }, [fire]);
  if (!pieces.length) return null;
  return (
    <div class="confetti" aria-hidden="true">
      {pieces.map((p) => (
        <i key={p.id} style={{ left: `${p.left}%`, background: p.color, "--dur": `${p.dur}s`, "--delay": `${p.delay}s`, "--drift": `${p.drift}px`, "--spin": `${p.spin}deg` }} />
      ))}
    </div>
  );
}
