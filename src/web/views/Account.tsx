import { useEffect, useState } from "preact/hooks";
import { claimDeviceEvents, postJson, useAccount } from "../lib/account";
import { lang, t, tj } from "../lib/i18n";
import type { WorkspaceRole } from "../../shared/protocol";
import { CFG, navigate, toast, useTheme, useTitle } from "../lib/util";
import { Empty, Message, TopBar } from "../components/ui";

/** Where to go after signing in: only paths on this site. */
const safeReturn = (p: string | null) => (p && /^\/(?![/\\])/.test(p) ? p : "/events");

/** Sign in with an emailed link or single sign-on. Also finishes sign-in when opened from the email. */
export function SignIn() {
  useTitle(t("Sign in · {name}", { name: CFG.name }));
  useTheme("indigo");
  const params = new URLSearchParams(location.search);
  const a = params.get("a");
  const tok = params.get("t");
  const returnTo = safeReturn(params.get("r") ?? params.get("return"));
  const acct = useAccount();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ devLink?: string } | null>(null);
  const [error, setError] = useState(() => (params.get("error") ? t(params.get("error")!) : ""));

  // Opened from the email: trade the link for a session.
  useEffect(() => {
    if (!a || !tok) return;
    history.replaceState({}, "", "/signin"); // don't leave the one-time link in the address bar
    postJson("/api/auth/finish", { a, t: tok })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        await claimDeviceEvents();
        toast(t("You're signed in"));
        navigate(returnTo);
      })
      .catch((e) => setError(t((e as Error).message) || t("Something went wrong. Try again.")));
  }, []);

  if (!acct.loading && !acct.on)
    return (
      <Message title={t("Accounts aren't set up here")}>
        <p class="muted">{t("This server doesn't have email sign-in turned on. You can still host events with your private host link.")}</p>
      </Message>
    );
  if (a && tok && !error)
    return (
      <>
        <TopBar />
        <main class="gate">
          <div class="panel stack">
            <h1>{t("Signing you in…")}</h1>
          </div>
        </main>
      </>
    );

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await postJson("/api/auth/start", { email, lang, return: returnTo });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSent(d);
    } catch (err) {
      setError(t((err as Error).message) || t("Something went wrong. Try again."));
    }
    setBusy(false);
  };

  return (
    <>
      <TopBar />
      <main class="gate">
        <div class="panel stack">
          {sent ? (
            <>
              <h1>{t("Check your email")}</h1>
              <p>{tj("We sent a sign-in link to {email}. It works once, for 15 minutes.", { email: <b>{email}</b> })}</p>
              {sent.devLink && (
                <p class="notice small">
                  {t("Development mode: email isn't set up, so here's the link.")}{" "}
                  <a href={sent.devLink} onClick={(e) => (e.preventDefault(), location.assign(sent.devLink!))}>
                    {t("Sign in now")}
                  </a>
                </p>
              )}
              <button class="btn ghost" onClick={() => setSent(null)}>
                {t("Use a different email")}
              </button>
            </>
          ) : (
            <div class="stack">
              <h1>{t("Sign in")}</h1>
              <p class="muted">{t("Keep all the events you host in one place, on any device, and share them with your team.")}</p>
              {error && <p class="notice bad small" role="alert">{error}</p>}
              {acct.sso && (
                <a class="btn lg block sso-btn" href={`/api/auth/sso/start?return=${encodeURIComponent(returnTo)}`} onClick={(e) => (e.preventDefault(), location.assign((e.currentTarget as HTMLAnchorElement).href))}>
                  {t("Sign in with {name}", { name: acct.sso })}
                </a>
              )}
              {acct.sso && acct.emailSignIn && <p class="or-line muted small">{t("or")}</p>}
              {acct.emailSignIn && (
                <form class="stack" onSubmit={submit}>
                  <label class="label" for="email">
                    {t("Email")}
                  </label>
                  <input id="email" class="input" type="email" autoComplete="email" required maxLength={120} value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
                  <button class="btn accent lg block" disabled={busy}>
                    {busy ? t("Sending…") : t("Email me a sign-in link")}
                  </button>
                  <p class="muted tiny">{t("No password: we email you a link.")}</p>
                </form>
              )}
              <p class="muted tiny">{t("Attendees never need an account. Hosting without one works too.")}</p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

/** All the events saved to the signed-in host's account. */
export function MyEvents() {
  useTitle(t("My events · {name}", { name: CFG.name }));
  useTheme("indigo");
  const acct = useAccount();
  useEffect(() => {
    // Anything hosted on this device gets added too.
    if (acct.email) void claimDeviceEvents();
  }, [acct.email]);

  if (acct.loading) return <TopBar title={t("Loading…")} />;
  if (!acct.on || !acct.email) {
    queueMicrotask(() => navigate("/signin"));
    return null;
  }

  const remove = async (code: string, title: string) => {
    if (!confirm(t("Remove \"{title}\" from your list? The event itself isn't deleted.", { title }))) return;
    await postJson(`/api/me/events/${code}`, {}, "DELETE");
    await acct.refresh();
  };
  const signOut = async (everywhere: boolean) => {
    await postJson("/api/auth/signout", { everywhere });
    await acct.refresh();
    navigate("/");
  };
  const deleteAccount = async () => {
    if (!confirm(t("Delete your account? Your events keep working with their host links, but they won't be listed here any more."))) return;
    await postJson("/api/me", {}, "DELETE");
    await acct.refresh();
    navigate("/");
  };

  return (
    <>
      <TopBar title={t("My events")} />
      <main class="wrap stack" style={{ maxWidth: 820 }}>
        <div class="spread">
          <p class="muted small">{tj("Signed in as {email}", { email: <b>{acct.email}</b> })}</p>
          <a class="btn sm accent" href="/">
            {t("New event")}
          </a>
        </div>
        <Workspaces />
        <div class="spread">
          <h2>{t("Your events")}</h2>
          <a class="btn sm ghost" href="/insights">
            {t("Insights")}
          </a>
        </div>
        {acct.events.length ? (
          <ul class="my-events">
            {acct.events.map((e) => (
              <li key={e.code} class="panel">
                <div class="grow" style={{ minWidth: 0 }}>
                  <b class="my-title">{e.title}</b>
                  <div class="muted small">
                    <span class="chip code">{e.code}</span> {t("Added {date}", { date: new Date(e.addedAt).toLocaleDateString(lang, { dateStyle: "medium" }) })}
                  </div>
                </div>
                <div class="row">
                  <a class="btn sm" href={`/host/${e.code}#${e.hostKey}`}>
                    {t("Open")}
                  </a>
                  <a class="btn sm ghost" href={`/present/${e.code}#${e.hostKey}`} target="_blank" rel="noopener">
                    {t("Big screen")}
                  </a>
                  <a class="btn sm ghost" href={`/analytics/${e.code}#${e.hostKey}`}>
                    {t("Analytics")}
                  </a>
                  <button class="btn sm quiet" onClick={() => remove(e.code, e.title)} aria-label={t("Remove {title} from your list", { title: e.title })}>
                    {t("Remove from list")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div class="panel">
            <Empty title={t("No events yet")}>{t("Events you create while signed in show up here. So do events you open with a host link.")}</Empty>
          </div>
        )}
        <div class="row" style={{ justifyContent: "center", marginTop: 24 }}>
          <button class="btn sm ghost" onClick={() => signOut(false)}>
            {t("Sign out")}
          </button>
          <button class="btn sm ghost" onClick={() => signOut(true)}>
            {t("Sign out on all devices")}
          </button>
          <button class="btn sm quiet danger" onClick={deleteAccount}>
            {t("Delete account")}
          </button>
        </div>
      </main>
    </>
  );
}

/** The team workspaces you're in, and a form to start a new one. */
function Workspaces() {
  const acct = useAccount();
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const roles: Record<WorkspaceRole, string> = { owner: t("Owner"), editor: t("Editor"), viewer: t("Viewer") };
  const create = async (e: Event) => {
    e.preventDefault();
    const r = await postJson("/api/workspaces", { name });
    const d = await r.json();
    if (!r.ok) return toast(t(d.error));
    await acct.refresh();
    navigate(`/teams/${d.id}#people`);
  };
  return (
    <section class="stack">
      <div class="spread">
        <h2>{t("Team workspaces")}</h2>
        {!open && (
          <button class="btn sm ghost" onClick={() => setOpen(true)}>
            {t("New workspace")}
          </button>
        )}
      </div>
      {open && (
        <form class="panel row" style={{ flexWrap: "nowrap" }} onSubmit={create}>
          <label class="sr-only" for="new-ws">
            {t("Workspace name")}
          </label>
          <input id="new-ws" class="input" autoFocus required maxLength={60} placeholder={t("e.g. Marketing team")} value={name} onInput={(e) => setName(e.currentTarget.value)} />
          <button class="btn accent">{t("Create")}</button>
          <button type="button" class="btn quiet" onClick={() => setOpen(false)}>
            {t("Cancel")}
          </button>
        </form>
      )}
      {acct.workspaces.length ? (
        <ul class="ws-list">
          {acct.workspaces.map((w) => (
            <li key={w.id}>
              <a class="panel ws-card" href={`/teams/${w.id}`}>
                <b>{w.name}</b>
                <span class="chip">{roles[w.role]}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        !open && <p class="muted small">{t("Share events with your team. Everyone sees the same list, with their own role.")}</p>
      )}
    </section>
  );
}
