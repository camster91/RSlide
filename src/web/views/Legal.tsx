// Trust pages: privacy, terms, security, accessibility, status and help.
// Written for the software as it is. The person running this site fills in their name and contact
// in public/config.js (operator, contactEmail). These pages are in English.
import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { lang, t } from "../lib/i18n";
import { CFG, useTheme, useTitle } from "../lib/util";
import { Brand, LangPicker } from "../components/ui";

export const LEGAL_PAGES = ["privacy", "terms", "security", "accessibility", "status", "help"] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];

const who = () => CFG.operator || `the people who run ${location.host}`;
const contact = () =>
  CFG.contactEmail ? (
    <a href={`mailto:${CFG.contactEmail}`}>{CFG.contactEmail}</a>
  ) : (
    <span>the contact listed by {who()}</span>
  );

function Page({ title, children }: { title: string; children: ComponentChildren }) {
  useTheme("indigo");
  useTitle(`${title} · ${CFG.name}`);
  return (
    <div class="legal">
      <header class="bar" style={{ position: "static" }}>
        <Brand />
        <span class="grow" />
        <LangPicker />
      </header>
      <main class="wrap legal-body">
        <h1>{title}</h1>
        {lang !== "en" && <p class="notice small">{t("This page is in English.")}</p>}
        {children}
      </main>
      <LegalFooter />
    </div>
  );
}

export function LegalFooter() {
  return (
    <footer class="legal-foot">
      <nav aria-label={t("About this site")}>
        <a href="/privacy">{t("Privacy")}</a>
        <a href="/terms">{t("Terms")}</a>
        <a href="/security">{t("Security")}</a>
        <a href="/accessibility">{t("Accessibility")}</a>
        <a href="/status">{t("Status")}</a>
        <a href="/help">{t("Help")}</a>
      </nav>
    </footer>
  );
}

export function Legal({ page }: { page: LegalPage }) {
  if (page === "privacy") return <Privacy />;
  if (page === "terms") return <Terms />;
  if (page === "security") return <Security />;
  if (page === "accessibility") return <Accessibility />;
  if (page === "status") return <Status />;
  return <Help />;
}

function Privacy() {
  return (
    <Page title="Privacy">
      <p class="lede">
        {CFG.name} is run by {who()}. We collect as little as we can. Attendees never need an account, and we don't track you or sell anything about you.
      </p>
      <h2>What we keep, and why</h2>
      <ul>
        <li>
          <b>What you send in an event:</b> questions, replies, votes, poll answers and reactions. The host and the people in the event see them. That's the point of the app.
        </li>
        <li>
          <b>Your name or email, only if the host asks for it.</b> By default you can take part without either. If the host turns on names or emails, they can see and download them.
        </li>
        <li>
          <b>A random ID on your device</b> (in your browser's storage), so you can upvote once and edit your own questions. It isn't linked to who you are.
        </li>
        <li>
          <b>Host accounts (optional):</b> your email address, the events you saved, and the team workspaces you're in. A sign-in cookie keeps you signed in for 30 days.
        </li>
        <li>
          <b>Pictures hosts upload</b> for polls and logos.
        </li>
      </ul>
      <h2>What we don't do</h2>
      <ul>
        <li>No advertising, no tracking pixels, no analytics companies.</li>
        <li>We don't store your IP address with your answers.</li>
        <li>We don't sell or share your data. The host of each event controls that event's data.</li>
      </ul>
      <h2>How long we keep it</h2>
      <p>
        Hosts can delete an event at any time, or set it to delete itself on a date. Deleting an event removes everything in it: questions, answers, names and pictures.
        {CFG.retention ? ` ${CFG.retention}` : ""}
      </p>
      <p>You can delete your host account from the My events page. Your events keep working through their host links until they're deleted.</p>
      <h2>Where it's stored</h2>
      <p>On Cloudflare's network (Durable Objects and R2 storage). Sign-in emails are sent through the email service this site uses. Paid plans, if offered, are handled by Stripe; we never see card numbers.</p>
      <h2>Your rights</h2>
      <p>You can ask to see, fix or delete your data. Write to {contact()}. For answers you gave in an event, you can also ask the event's host.</p>
    </Page>
  );
}

function Terms() {
  return (
    <Page title="Terms of use">
      <p class="lede">
        {CFG.name} is open-source software (MIT license). This site is run by {who()}.
      </p>
      <h2>Using the service</h2>
      <ul>
        <li>Be kind. Don't post anything illegal, hateful, or that breaks someone else's rights.</li>
        <li>Hosts are responsible for their events and for telling their audience how answers will be used.</li>
        <li>Keep host links private. Anyone with a host link can control that event.</li>
        <li>Don't try to break, overload or misuse the service.</li>
      </ul>
      <h2>Your content</h2>
      <p>What you post stays yours. You let the event's host and audience see it, and the host download it, as part of running the event.</p>
      <h2>No warranty</h2>
      <p>The software is provided "as is", without warranty of any kind, as the MIT license says. We do our best to keep things running, but we can't promise the service will always be available.</p>
      <h2>Changes and contact</h2>
      <p>We may update these terms. The date of the latest version is below. Questions: {contact()}.</p>
      <p class="muted small">Last updated: {CFG.termsDate || "see the site's announcements"}</p>
    </Page>
  );
}

function Security() {
  return (
    <Page title="Security">
      <ul>
        <li>All traffic is encrypted (HTTPS and secure WebSockets).</li>
        <li>Each event has a long random host link; it's checked in constant time, and attendees can never see it.</li>
        <li>Host sign-in uses one-time email links (15 minutes) or single sign-on with your company's identity provider. There are no passwords to steal.</li>
        <li>Sign-in links and sessions are stored only as hashes. Sign-in requests are rate limited.</li>
        <li>Team workspaces have owner, editor and viewer roles. Viewers never receive host links.</li>
        <li>Webhooks are signed (HMAC-SHA256) and only sent to public HTTPS addresses.</li>
        <li>Questions are checked for length, spam and (if the host wants) bad words. Uploads are limited to images under 2 MB.</li>
        <li>The code is public, so anyone can review it.</li>
      </ul>
      <h2>Found a problem?</h2>
      <p>
        Please tell us privately: {contact()}, or open a private report on{" "}
        <a href="https://github.com/camster91/RSlide/security" target="_blank" rel="noopener">
          GitHub
        </a>
        . Please don't post it publicly until it's fixed.
      </p>
    </Page>
  );
}

function Accessibility() {
  return (
    <Page title="Accessibility">
      <p class="lede">We want everyone to be able to ask, vote and present. We aim for WCAG 2.2 level AA.</p>
      <h2>What we do</h2>
      <ul>
        <li>Everything works with a keyboard, with visible focus.</li>
        <li>Screen reader labels on buttons, charts and live updates. Charts also have data tables.</li>
        <li>Text and controls meet contrast rules, including custom brand colours (we adjust them if needed).</li>
        <li>Large tap targets on phones. Works when zoomed to 200% and on small screens.</li>
        <li>Respects "reduce motion".</li>
        <li>A high-contrast theme, and dark mode.</li>
        <li>English, French and Spanish.</li>
      </ul>
      <h2>Known gaps</h2>
      <ul>
        <li>"Pin on image" polls depend on seeing the picture. Hosts should describe the picture in the question, or use another poll type.</li>
        <li>Slides shown from other services (Google Slides, PowerPoint for the web, Canva) follow those services' accessibility.</li>
      </ul>
      <h2>Tell us</h2>
      <p>If something gets in your way, write to {contact()}. We'll try to fix it, and help you take part in the meantime.</p>
    </Page>
  );
}

function Status() {
  const [s, setS] = useState<{ ok: boolean; ms: number; version?: string } | null>(null);
  const check = () => {
    const t0 = performance.now();
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setS({ ok: !!d.ok, ms: Math.round(performance.now() - t0), version: d.version }))
      .catch(() => setS({ ok: false, ms: 0 }));
  };
  useEffect(() => {
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <Page title="Status">
      {!s ? (
        <p class="muted">{t("Checking…")}</p>
      ) : (
        <div class={`status-box ${s.ok ? "ok" : "bad"}`} role="status">
          <b>{s.ok ? "All systems working" : "We can't reach the service right now"}</b>
          {s.ok && (
            <span class="muted small">
              Answered in {s.ms} ms{s.version ? ` · version ${s.version}` : ""}. Checks again every 30 seconds.
            </span>
          )}
        </div>
      )}
      {CFG.statusUrl && (
        <p>
          History and incident reports: <a href={CFG.statusUrl}>{CFG.statusUrl}</a>
        </p>
      )}
    </Page>
  );
}

function Help() {
  return (
    <Page title="Help">
      <h2>Joining</h2>
      <p>Go to {location.host} and type the code on the screen, or scan the QR code. No account or app needed.</p>
      <h2>Hosting</h2>
      <ol>
        <li>Make an event on the home page. Keep the host link private: it controls the event.</li>
        <li>Open the big screen on the projector. Add polls, or start from a template.</li>
        <li>Use the remote on your phone to launch polls and show questions while you present.</li>
      </ol>
      <h2>Slides, Teams and streams</h2>
      <p>
        In your event's settings, under "Slides and apps": a join slide picture, the PowerPoint add-in, the Microsoft Teams app, and your own slides with live polls on top. The{" "}
        <a href="https://github.com/camster91/RSlide/blob/main/docs/INTEGRATIONS.md" target="_blank" rel="noopener">
          setup guide
        </a>{" "}
        has step-by-step instructions.
      </p>
      <h2>Still stuck?</h2>
      <p>Write to {contact()}.</p>
    </Page>
  );
}
