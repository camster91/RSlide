import { render } from "preact";
import "./styles.css";
import { navigate, normCode, useLocation, useToast } from "./lib/util";
import { Home } from "./views/Home";
import { Attendee } from "./views/Attendee";
import { Host } from "./views/Host";
import { Present } from "./views/Present";

function Router() {
  const path = useLocation();
  const [, a = "", b = ""] = path.split("/");
  const code = normCode(b);
  if (a === "e" && code) return <Attendee key={code} code={code} />;
  if (a === "host" && code) return <Host key={code} code={code} />;
  if (a === "present" && code) return <Present key={code} code={code} />;
  // Short links like yoursite.com/ABC123
  if (a && /^[A-Za-z0-9]{4,8}$/.test(a) && !b) {
    queueMicrotask(() => navigate(`/e/${a.toUpperCase()}`));
    return null;
  }
  return <Home />;
}

function Toast() {
  const msg = useToast();
  return (
    <div id="toast" role="status" class={msg ? "show" : ""}>
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
  history.pushState({}, "", url.pathname + url.hash);
  window.dispatchEvent(new Event("rs-nav"));
});

render(
  <>
    <Router />
    <Toast />
  </>,
  document.getElementById("app")!,
);
