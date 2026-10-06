import { useState } from "preact/hooks";
import { CFG, fetchEvent, navigate, normCode, rememberHosted, store, toast, useTitle, type HostedEvent } from "../lib/util";
import { TopBar } from "../components/ui";

export function Home() {
  useTitle(CFG.name);
  const mine = store.get<HostedEvent[]>("rs.hosted", []);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const join = async (e: Event) => {
    e.preventDefault();
    const c = normCode(code);
    if (!c) return toast("Type the event code");
    if (!(await fetchEvent(c))) return toast("We couldn't find that event code");
    navigate(`/e/${c}`);
  };

  const create = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      rememberHosted({ code: d.code, key: d.hostKey, title: d.title, ts: Date.now() });
      navigate(`/host/${d.code}#${d.hostKey}`);
    } catch (err) {
      toast((err as Error).message || "Could not create event");
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar />
      <section class="hero">
        {CFG.heroKicker && (
          <div class="kicker" style={{ color: "var(--accent)" }}>
            {CFG.heroKicker}
          </div>
        )}
        <h1 style={{ marginTop: 10 }}>{CFG.heroTitle}</h1>
        {CFG.heroText && <p>{CFG.heroText}</p>}
      </section>
      <section class="home-cards">
        <form class="card stack" onSubmit={join}>
          <div class="kicker">Join a session</div>
          <h2>Enter your event code</h2>
          <input
            class="input code-input"
            maxLength={8}
            placeholder="ABC123"
            autoComplete="off"
            autoCapitalize="characters"
            aria-label="Event code"
            value={code}
            onInput={(e) => setCode(e.currentTarget.value)}
          />
          <button class="btn accent" style={{ width: "100%" }}>
            Join
          </button>
        </form>
        <form class="card stack" onSubmit={create}>
          <div class="kicker">Host a session</div>
          <h2>Start a new event</h2>
          <input
            class="input"
            maxLength={120}
            placeholder={CFG.titlePlaceholder}
            aria-label="Event title"
            value={title}
            onInput={(e) => setTitle(e.currentTarget.value)}
          />
          <button class="btn" style={{ width: "100%" }} disabled={busy}>
            Create event
          </button>
          {mine.length > 0 && (
            <div>
              <div class="muted small" style={{ margin: "8px 0 4px" }}>
                Your recent events
              </div>
              {mine.slice(0, 5).map((e) => (
                <div class="row" style={{ padding: "6px 0", borderTop: "1px solid var(--line)" }} key={e.code}>
                  <span class="grow">
                    {e.title} <span class="muted small">#{e.code}</span>
                  </span>
                  <a class="btn sm ghost" href={`/host/${e.code}#${e.key}`}>
                    Open
                  </a>
                </div>
              ))}
            </div>
          )}
        </form>
      </section>
    </>
  );
}
