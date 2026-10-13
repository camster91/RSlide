import { render, type ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import { navigate, normCode, useLocation, useToast } from "./lib/util";
import { Home } from "./views/Home";
import { Attendee } from "./views/Attendee";

/** Loads a screen's code only when it's opened, so attendees' phones download less. */
function lazy<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  let cached: ComponentType<P> | null = null;
  return (props: P) => {
    const [C, setC] = useState<ComponentType<P> | null>(() => cached);
    useEffect(() => {
      if (!C) load().then((c) => setC(() => (cached = c)));
    }, []);
    return C ? <C {...props} /> : null;
  };
}
const Host = lazy(() => import("./views/Host").then((m) => m.Host));
const Present = lazy(() => import("./views/Present").then((m) => m.Present));
const Report = lazy(() => import("./views/Report").then((m) => m.Report));
const Analytics = lazy(() => import("./views/Analytics").then((m) => m.Analytics));
const Remote = lazy(() => import("./views/Remote").then((m) => m.Remote));
const Recap = lazy(() => import("./views/Recap").then((m) => m.Recap));
const SignIn = lazy(() => import("./views/Account").then((m) => m.SignIn));
const MyEvents = lazy(() => import("./views/Account").then((m) => m.MyEvents));
const TeamPage = lazy(() => import("./views/Teams").then((m) => m.TeamPage));
const JoinTeam = lazy(() => import("./views/Teams").then((m) => m.JoinTeam));
const Legal = lazy(() => import("./views/Legal").then((m) => m.Legal));
const Insights = lazy(() => import("./views/Teams").then((m) => m.Insights));

function Router() {
  const path = useLocation();
  const [, a = "", b = "", c = "", d = ""] = path.split("/");
  const code = normCode(b);
  if (a === "e" && code) return <Attendee key={code} code={code} />;
  if (a === "host" && code) return <Host key={code} code={code} />;
  if (a === "mod" && code) return <Host key={`mod-${code}`} code={code} moderator />;
  if (a === "analytics" && code) return <Analytics key={code} code={code} />;
  if (a === "present" && code) return <Present key={code} code={code} />;
  if (a === "report" && code) return <Report key={code} code={code} />;
  if (a === "remote" && code) return <Remote key={code} code={code} />;
  if (a === "recap" && code) return <Recap key={code} code={code} />;
  if (a === "signin") return <SignIn />;
  if (a === "events" && !b) return <MyEvents />;
  if (a === "insights" && !b) return <Insights />;
  if (!b && ["privacy", "terms", "security", "accessibility", "status", "help"].includes(a)) return <Legal key={a} page={a as "privacy"} />;
  if (a === "join-team") return <JoinTeam />;
  if (a === "teams" && /^[0-9a-f]{16}$/.test(b)) {
    if (c === "analytics" && normCode(d)) return <Analytics key={d} code={normCode(d)} team={b} />;
    return <TeamPage key={b} id={b} />;
  }
  // Short links like yoursite.com/ABC123
  if (a && /^[A-Za-z0-9]{4,8}$/.test(a) && !b) {
    queueMicrotask(() => navigate(`/e/${a.toUpperCase()}`));
    return null;
  }
  return <Home />;
}

function Toast() {
  const { msg, show } = useToast();
  return (
    <div id="toast" role="status" class={show ? "show" : ""} aria-hidden={!show}>
      {msg}
    </div>
  );
}

// Keep in-app links inside the single-page app (no full reload).
document.addEventListener("click", (e) => {
  const a = (e.target as Element).closest?.("a");
  if (!a || a.target || a.hasAttribute("download") || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.preventDefault();
  history.pushState({}, "", url.pathname + url.search + url.hash);
  window.dispatchEvent(new Event("rs-nav"));
});

render(
  <>
    <Router />
    <Toast />
  </>,
  document.getElementById("app")!,
);
