import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Item, Label, Leaderboard, Poll, PollType, Question, Reaction, Reply, Results as ResultsData } from "../../shared/protocol";
import { POINTS_BUDGET } from "../../shared/protocol";
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
  points: "100 points",
  grid: "2×2 grid",
  pin: "Pin on image",
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
  points: "Share out points",
  grid: "Plot on two axes",
  pin: "Tap a picture",
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
  reply: () => svg(<path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />),
  tag: () => svg(<><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" /></>),
};

// ---------- chrome ----------

/** The app's brand, or the event's own logo when the host uploaded one. */
export function Brand({ logo, code }: { logo?: string | null; code?: string }) {
  if (logo && code)
    return (
      <a class="brand" href="/" aria-label={`${CFG.name} home`}>
        <img class="event-logo" src={mediaUrl(code, logo)} alt="Event logo" />
      </a>
    );
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

export function TopBar({ title, children, logo, code }: { title?: string; children?: ComponentChildren; logo?: string | null; code?: string }) {
  return (
    <header class="bar">
      <Brand logo={logo} code={code} />
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
  if (item.type === "points" && r.scores) {
    const order = item.options.map((o, i) => ({ o, i, s: r.scores![i] })).sort((a, b) => b.s - a.s);
    return (
      <>
        {order.map((x, pos) => (
          <Bar key={x.i} label={x.o} value={`${x.s} pts`} pct={(x.s / POINTS_BUDGET) * 100} img={img(x.i)} lead={pos === 0 && r.total > 0} />
        ))}
        <p class="muted tiny" style={{ marginTop: 8 }}>
          Average points given, out of {POINTS_BUDGET}.
        </p>
      </>
    );
  }
  if (item.type === "grid" && r.pairs) return <GridChart item={item} pairs={r.pairs} total={r.total} big={big} />;
  if (item.type === "pin" && r.pins) return item.image ? <PinMap src={mediaUrl(code, item.image)} pins={r.pins} big={big} /> : null;
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
      {poll.type !== "grid" && poll.type !== "pin" && (
        <p class="muted small" style={{ marginTop: 12 }}>
          {plural(results.total, "response")}
        </p>
      )}
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

// ---------- 2×2 grid and pin results ----------

/** Average position of each option on two axes. Names sit next to the dots, so colour isn't needed. */
export function GridChart({ item, pairs, total, big }: { item: Item; pairs: [number, number][]; total: number; big: boolean }) {
  const [ax, ay] = item.axes ?? ["X", "Y"];
  const min = item.range?.min ?? 1;
  const max = item.range?.max ?? 10;
  const W = 400;
  const pad = 34;
  const pos = (v: number) => pad + ((v - min) / Math.max(1, max - min)) * (W - pad * 2);
  const [hover, setHover] = useState<number | null>(null);
  if (!total) return <Empty>Dots appear here as people answer.</Empty>;
  return (
    <figure class={`grid-chart ${big ? "big" : ""}`} aria-label={`${ax} versus ${ay}`}>
      <svg viewBox={`0 0 ${W} ${W}`} role="img">
        <rect x={pad} y={pad} width={W - pad * 2} height={W - pad * 2} class="g-frame" />
        <line x1={W / 2} y1={pad} x2={W / 2} y2={W - pad} class="g-mid" />
        <line x1={pad} y1={W / 2} x2={W - pad} y2={W / 2} class="g-mid" />
        <text x={W / 2} y={W - 8} class="g-axis" text-anchor="middle">
          {ax} →
        </text>
        <text x={12} y={W / 2} class="g-axis" text-anchor="middle" transform={`rotate(-90 12 ${W / 2})`}>
          {ay} →
        </text>
        {pairs.map(([x, y], i) => {
          const cx = pos(x);
          const cy = W - pos(y);
          const right = cx < W - 120;
          return (
            <g key={i} class={`g-pt ${hover === i ? "on" : ""}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} tabIndex={0} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
              <circle cx={cx} cy={cy} r={16} class="g-hit" />
              <circle cx={cx} cy={cy} r={7} class="g-dot" />
              <text x={right ? cx + 12 : cx - 12} y={cy + 4} text-anchor={right ? "start" : "end"} class="g-label">
                {item.options[i]}
              </text>
              {hover === i && (
                <text x={right ? cx + 12 : cx - 12} y={cy + 20} text-anchor={right ? "start" : "end"} class="g-val">
                  {ax} {x}, {ay} {y}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption class="muted tiny">
        Average of {plural(total, "answer")}, on a {min}–{max} scale.
      </figcaption>
    </figure>
  );
}

/** Where people tapped on the picture. Dots are see-through, so busy spots look darker. */
export function PinMap({ src, pins, big, mine }: { src: string; pins: [number, number][]; big: boolean; mine?: [number, number] | null }) {
  return (
    <figure class={`pin-map ${big ? "big" : ""}`}>
      <div class="pin-wrap">
        <img src={src} alt="" />
        {pins.map(([x, y], i) => (
          <i key={i} class="pin-dot" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} />
        ))}
        {mine && <i class="pin-dot mine" style={{ left: `${mine[0] * 100}%`, top: `${mine[1] * 100}%` }} aria-label="Your pin" />}
      </div>
      <figcaption class="muted tiny">{plural(pins.length, "pin")}</figcaption>
    </figure>
  );
}

// ---------- labels and replies ----------

export function LabelChip({ label, onClick, on }: { label: Label; onClick?: () => void; on?: boolean }) {
  const cls = `label-chip c-${label.color} ${on === false ? "off" : ""}`;
  return onClick ? (
    <button type="button" class={cls} aria-pressed={on} onClick={onClick}>
      {label.name}
    </button>
  ) : (
    <span class={cls}>{label.name}</span>
  );
}

export function QuestionLabels({ q, labels }: { q: Question; labels: Label[] }) {
  const mine = labels.filter((l) => q.labels.includes(l.id));
  if (!mine.length) return null;
  return (
    <div class="labels">
      {mine.map((l) => (
        <LabelChip key={l.id} label={l} />
      ))}
    </div>
  );
}

export function Replies({ replies, canDelete, onDelete }: { replies: Reply[]; canDelete?: (r: Reply) => boolean; onDelete?: (r: Reply) => void }) {
  if (!replies.length) return null;
  return (
    <ul class="replies">
      {replies.map((r) => (
        <li key={r.id} class={r.official ? "official" : ""}>
          <div class="reply-meta">
            <b>{r.name || "Anonymous"}</b>
            {r.official && <span class="tag answered">Official reply</span>}
            <span>{ago(r.ts)}</span>
            {canDelete?.(r) && (
              <button class="btn sm quiet" onClick={() => onDelete?.(r)} aria-label="Delete reply">
                Delete
              </button>
            )}
          </div>
          <div class="text">{r.text}</div>
        </li>
      ))}
    </ul>
  );
}

/** "Opens at 2:30 PM" for times today, otherwise with the date. */
export function whenText(ts: number): string {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
