import { useState } from "preact/hooks";
import { CFG, fetchEvent, navigate, normCode, rememberHosted, store, toast, useTheme, useTitle, type HostedEvent } from "../lib/util";
import { Brand } from "../components/ui";

export function Home() {
  useTitle(CFG.name);
  useTheme("indigo");
  const mine = store.get<HostedEvent[]>("rs.hosted", []);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const join = async (e: Event) => {
    e.preventDefault();
    const c = normCode(code);
    if (!c) return toast("Type the event code");
    if (!(await fetchEvent(c))) return toast(`No event found with code ${c}`);
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
      toast((err as Error).message || "Could not create the event. Try again.");
      setBusy(false);
    }
  };

  return (
    <div class="home">
      <header class="bar" style={{ background: "transparent", borderBottom: 0, position: "static" }}>
        <Brand />
      </header>
      <main class="home-main">
        <section>
          {CFG.heroKicker && <p class="muted" style={{ fontWeight: 600, marginBottom: 14 }}>{CFG.heroKicker}</p>}
          <h1>{CFG.heroTitle}</h1>
          {CFG.heroText && <p class="home-lede">{CFG.heroText}</p>}
        </section>

        <section>
          <form class="join-card" onSubmit={join}>
            <h2>Join with a code</h2>
            <label class="sr-only" for="code">
              Event code
            </label>
            <input
              id="code"
              class="code-input"
              maxLength={8}
              placeholder="ABC123"
              autoComplete="off"
              autoCapitalize="characters"
              inputMode="text"
              value={code}
              onInput={(e) => setCode(e.currentTarget.value)}
            />
            <button class="btn accent lg block" style={{ marginTop: 12 }}>
              Join event
            </button>
          </form>

          <form class="panel host-card stack" onSubmit={create}>
            <h2>Host an event</h2>
            <label class="label" for="title">
              Event name
            </label>
            <input id="title" class="input" maxLength={120} placeholder={CFG.titlePlaceholder} value={title} onInput={(e) => setTitle(e.currentTarget.value)} style={{ marginTop: 0 }} />
            <button class="btn block" disabled={busy}>
              {busy ? "Creating…" : "Create event"}
            </button>
            {mine.length > 0 && (
              <div class="recent">
                <p class="muted small" style={{ marginTop: 6 }}>
                  Your recent events on this device
                </p>
                <ul>
                  {mine.slice(0, 5).map((e) => (
                    <li key={e.code}>
                      <span class="grow">{e.title}</span>
                      <span class="chip code">{e.code}</span>
                      <a class="btn sm ghost" href={`/host/${e.code}#${e.key}`}>
                        Open
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </form>
        </section>
      </main>
      <footer class="home-foot">
        Free and open source under the MIT license.{" "}
        <a href="https://github.com/camster91/RSlide" target="_blank" rel="noopener">
          Get the code
        </a>
      </footer>
    </div>
  );
}
