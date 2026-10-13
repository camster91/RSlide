import { useState } from "preact/hooks";
import { CFG, fetchEvent, navigate, normCode, rememberHosted, store, toast, useTheme, useTitle, type HostedEvent } from "../lib/util";
import { Brand, Icon, LangPicker } from "../components/ui";
import { useInstall } from "../lib/install";
import { canScan, scanForCode } from "../lib/native";
import { TEMPLATES } from "../../shared/templates";
import { t } from "../lib/i18n";
import { useAccount } from "../lib/account";

export function Home() {
  useTitle(CFG.name);
  useTheme("indigo");
  const acct = useAccount();
  const app = useInstall();
  // Signed in: the account's events. Otherwise: events hosted on this device.
  const mine: HostedEvent[] = acct.email ? acct.events.map((e) => ({ code: e.code, key: e.hostKey, title: e.title, ts: e.addedAt })) : store.get<HostedEvent[]>("rs.hosted", []);
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [template, setTemplate] = useState("");
  const teams = acct.workspaces.filter((w) => w.role !== "viewer");
  const [team, setTeam] = useState(() => store.get("rs.team", ""));
  const teamId = teams.some((w) => w.id === team) ? team : "";

  const join = async (e: Event) => {
    e.preventDefault();
    const c = normCode(code);
    if (!c) return toast(t("Type the event code"));
    if (!(await fetchEvent(c))) return toast(t("No event found with code {code}", { code: c }));
    navigate(`/e/${c}`);
  };

  const scan = async () => {
    try {
      const c = await scanForCode();
      if (c) navigate(`/e/${c}`);
      else if (c === null) toast(t("That QR code isn't an event code"));
    } catch (e) {
      if (!/cancel/i.test(String((e as Error).message))) toast(t("Couldn't open the camera"));
    }
  };

  const create = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, ...(template ? { template } : {}), ...(teamId ? { workspace: teamId } : {}) }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      rememberHosted({ code: d.code, key: d.hostKey, title: d.title, ts: Date.now() });
      try {
        sessionStorage.setItem("rs.new", d.code);
      } catch {}
      navigate(`/host/${d.code}#${d.hostKey}`);
    } catch (err) {
      toast((err as Error).message || t("Could not create the event. Try again."));
      setBusy(false);
    }
  };

  return (
    <div class="home">
      <header class="bar" style={{ background: "transparent", borderBottom: 0, position: "static" }}>
        <Brand />
        <span class="grow" />
        {app.kind === "prompt" && (
          <button class="btn sm ghost" onClick={app.install}>
            <Icon.download /> {t("Install app")}
          </button>
        )}
        {acct.on &&
          (acct.email ? (
            <a class="btn sm ghost" href="/events">
              {t("My events")}
            </a>
          ) : (
            <a class="btn sm ghost" href="/signin">
              {t("Sign in")}
            </a>
          ))}
      </header>
      <main class="home-main">
        <section>
          {CFG.heroKicker && <p class="muted" style={{ fontWeight: 600, marginBottom: 14 }}>{CFG.heroKicker}</p>}
          <h1>{CFG.heroTitle}</h1>
          {CFG.heroText && <p class="home-lede">{CFG.heroText}</p>}
        </section>

        <section>
          <form class="join-card" onSubmit={join}>
            <h2>{t("Join with a code")}</h2>
            <label class="sr-only" for="code">
              {t("Event code")}
            </label>
            <input
              id="code"
              class="code-input"
              maxLength={8}
              placeholder="ABC123"
              autoComplete="off"
              autoCapitalize="characters"
              inputMode="text"
              autoFocus={new URLSearchParams(location.search).has("join")}
              value={code}
              onInput={(e) => setCode(e.currentTarget.value)}
            />
            <button class="btn accent lg block" style={{ marginTop: 12 }}>
              {t("Join event")}
            </button>
            {canScan() && (
              <button type="button" class="btn lg block scan-btn" style={{ marginTop: 10 }} onClick={scan}>
                {t("Scan QR code")}
              </button>
            )}
          </form>

          <form class="panel host-card stack" onSubmit={create}>
            <h2>{t("Host an event")}</h2>
            <label class="label" for="title">
              {t("Event name")}
            </label>
            <input id="title" class="input" maxLength={120} placeholder={CFG.titlePlaceholder} value={title} onInput={(e) => setTitle(e.currentTarget.value)} style={{ marginTop: 0 }} />
            <label class="label" for="tpl">
              {t("Start with")}
            </label>
            <select id="tpl" class="input" value={template} onChange={(e) => setTemplate(e.currentTarget.value)} style={{ marginTop: 0 }}>
              <option value="">{t("A blank event")}</option>
              {TEMPLATES.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}: {tpl.polls.length === 1 ? t("1 ready-made poll") : t("{n} ready-made polls", { n: tpl.polls.length })}
                </option>
              ))}
            </select>
            {template && <p class="muted tiny">{TEMPLATES.find((tpl) => tpl.id === template)?.description}</p>}
            {teams.length > 0 && (
              <>
                <label class="label" for="team">
                  {t("Save it to")}
                </label>
                <select
                  id="team"
                  class="input"
                  value={teamId}
                  onChange={(e) => {
                    setTeam(e.currentTarget.value);
                    store.set("rs.team", e.currentTarget.value);
                  }}
                  style={{ marginTop: 0 }}
                >
                  <option value="">{t("Just my account")}</option>
                  {teams.map((w) => (
                    <option key={w.id} value={w.id}>
                      {t("Workspace: {name}", { name: w.name })}
                    </option>
                  ))}
                </select>
              </>
            )}
            <button class="btn block" disabled={busy}>
              {busy ? t("Creating…") : t("Create event")}
            </button>
            {mine.length > 0 && (
              <div class="recent">
                <p class="muted small" style={{ marginTop: 6 }}>
                  {acct.email ? t("Your events") : t("Your recent events on this device")}
                </p>
                <ul>
                  {mine.slice(0, 5).map((e) => (
                    <li key={e.code}>
                      <span class="grow">{e.title}</span>
                      <span class="chip code">{e.code}</span>
                      <a class="btn sm ghost" href={`/host/${e.code}#${e.key}`}>
                        {t("Open")}
                      </a>
                    </li>
                  ))}
                </ul>
                {acct.email && mine.length > 5 && (
                  <a class="small" href="/events">
                    {t("See all your events")}
                  </a>
                )}
              </div>
            )}
          </form>
        </section>
      </main>
      <footer class="home-foot">
        {t("Free and open source under the MIT license.")}{" "}
        <a href="https://github.com/camster91/RSlide" target="_blank" rel="noopener">
          {t("Get the code")}
        </a>
        <LangPicker label />
        <nav class="home-links" aria-label={t("About this site")}>
          <a href="/privacy">{t("Privacy")}</a>
          <a href="/terms">{t("Terms")}</a>
          <a href="/security">{t("Security")}</a>
          <a href="/accessibility">{t("Accessibility")}</a>
          <a href="/status">{t("Status")}</a>
          <a href="/help">{t("Help")}</a>
        </nav>
        {app.kind === "ios" && <p class="tiny muted install-tip">{t("Add it to your home screen: tap Share, then “Add to Home Screen”.")}</p>}
      </footer>
    </div>
  );
}
