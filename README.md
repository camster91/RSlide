# RSlide

**Open-source live Q&A and polling.** A self-hosted alternative to tools like Slido, for classes, meetings, conferences and town halls.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/camster91/RSlide)
[![CI](https://github.com/camster91/RSlide/actions/workflows/ci.yml/badge.svg)](https://github.com/camster91/RSlide/actions/workflows/ci.yml)

- No accounts for attendees — join with a short code, a link or a QR code
- Real-time updates over WebSockets, tested with 2,000 attendees in one event
- Runs on Cloudflare Workers + Durable Objects: one tiny "room" per event, no database server to manage
- Small and fast: the attendee app is under 20 KB zipped
- Easy to white-label: one config file, plus brand colours and fonts per event or per team
- Installable on phones and computers (it's a web app: no app store needed)
- **iPhone and Android apps** (optional) with QR scanning to join, app links and haptics: see [docs/MOBILE.md](docs/MOBILE.md)

> RSlide is an independent project. It is not affiliated with or endorsed by Slido or Cisco.

## Features

**Attendees** — `/e/CODE` (no account, ever)
- Ask questions, named or anonymous; upvote (and optionally downvote) others
- Edit or withdraw your own questions; reply to others (when the host allows)
- **"Already asked?"** — while you type, similar questions pop up so you can upvote instead of repeating
- Pick a Q&A room when an event has several (e.g. one per session)
- Answer 11 kinds of polls: multiple choice, quiz, rating, scale, ranking, word cloud, open text, 100 points, 2×2 grid, pin on image and multi-question surveys. Any question can carry a picture
- **Self-paced mode**: go through all the open polls in your own time (like a survey), with your progress shown; quizzes show you your result right away
- Quiz mode with a countdown, points for speed and a live leaderboard
- **Team quizzes**: pick a team (or "Pick for me" to balance them); teams are ranked by average points so size doesn't matter
- Send emoji reactions that float up the big screen
- Works in light and dark mode, sized for one-handed phone use
- **English, French and Spanish**: the app follows each phone's language, with a menu to switch

**Hosts** — `/host/CODE#hostkey` (private link, given when you create an event)
- Optional **host accounts**: sign in with an emailed link (no password) or **single sign-on** (Microsoft Entra ID, Google Workspace, Okta… any OpenID Connect provider) to see all your events on any device. Hosting without an account still works
- **Team workspaces**: a shared event list with **owner, editor and viewer** roles, email invites, and a team look (colours and font) for new events. Viewers see analytics and recaps but never get host links
- **Insights**: compare all your events (or your team's) over time: people, questions, upvotes, poll answers; download as CSV
- Q&A moderation: review first, show on screen, mark answered, archive, delete, reply, label, move between rooms
- **Repeat-question hints**: similar questions are flagged, and one click merges them (votes and replies move over). Optional AI help catches repeats worded differently or in another language
- **Phone remote** (`/remote/CODE`): scan a QR code and run polls and pick questions from the stage
- A separate **moderator link** for helpers who handle questions but can't touch polls or settings
- Word filter (hide bad words, or send them to review) with your own word list; hide names from the audience
- Open and close questions on a schedule; delete the whole event automatically on a set date
- Start from 7 ready-made templates (class check-in, all-hands, retro, feedback, icebreakers, trivia, brainstorm) or copy one of your own events
- Event logo, plus a live **analytics** page: who joined, peak attendance, activity over time, poll response rates, top questions
- **Paste to polls**: paste a list of questions (options on the lines below, `*` for the quiz answer) and see them as polls before adding. With AI set up, messy notes work too
- **Recap page** (`/recap/CODE`): share a summary, the top questions with your replies and the poll results. Write the summary yourself or draft it with AI
- Build polls ahead of time, with images on options; launch, close, reorder, duplicate, clear answers
- Quiz: set a timer (or none), reveal the answer, show the leaderboard on the big screen
- Event passcode, and ask people for their name or name + email before they join
- Six colour themes per event, or **your own brand**: main and highlight colours (kept readable automatically), headline font, and the option to hide the RSlide name; light or dark big screen
- **API and webhooks**: a read-only API key per event, and signed webhooks for new questions, poll launches, reveals and more. See [docs/API.md](docs/API.md)
- Export everything to Excel (questions, results, every answer, leaderboard, participants), CSV, or a printable report you can save as PDF

**Slides and meeting apps**
- **Join slide**: download a 1920×1080 picture with your code and QR for any deck (PowerPoint, Google Slides, Keynote, Canva)
- **PowerPoint add-in**: live results, Q&A or the join code on a slide; it can start "its" poll when the slide comes up
- **Your own slides with live polls on top**: paste a Google Slides link (or a PowerPoint for the web / Canva embed link) and the big screen shows your deck with polls and questions over it
- **Microsoft Teams app**: a tab and meeting side panel where people ask and vote, and live results on the meeting stage
- Setup steps for each, plus Zoom and Keynote tips: [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)

**Big screen** — `/present/CODE`
- Giant join code, URL and QR code always visible
- Live results for every poll type, quiz countdown and answer reveal
- Podium leaderboard with confetti, floating reactions, highlighted question
- One screen per room with `?room=` links
- **Stream overlay** (`?overlay=1`): a see-through lower third for OBS, vMix or StreamYard
- Links that pin a screen to one thing: `?poll=ID` (one poll), `?show=code|qa|leaderboard`

**Your website** — paste two lines to embed the audience view (or live results) in any page:

```html
<div data-rslide="ABC123"></div>
<script src="https://your-rslide-site/embed.js" async></script>
```

## Quick start

Use Node.js 22.12 or newer on 22.x, or Node.js 24.x. The package engine range matches the locked build/test tools; CI checks dependency engines on 22.12.0, current 22.x and 24.x.

```bash
git clone https://github.com/camster91/RSlide.git
cd RSlide
npm install
npm run dev          # http://localhost:5173
```

## Deploy to Cloudflare

Works on the Cloudflare Workers free plan.

**One click:** use the **Deploy to Cloudflare** button at the top of this page.

**From your computer:**

```bash
npx wrangler login
npm run deploy
```

You'll get a `*.workers.dev` URL. To use your own domain, add it under the Worker's **Settings → Domains & Routes** in the Cloudflare dashboard.

### Settings

Set these under `vars` in `wrangler.jsonc` (or in the Cloudflare dashboard):

| Setting | What it does | Default |
| --- | --- | --- |
| `EVENT_TTL_HOURS` | Delete each event this many hours after it's created. Good for public demos. | empty (keep forever) |
| `MAX_PARTICIPANTS` | Most attendees allowed in one event at the same time. | `0` (no limit) |
| `MEDIA` (R2 bucket) | Stores images on poll options. Remove the `r2_buckets` block to turn image uploads off. | `rslide-media` |
| `AI` (Workers AI binding) | Optional. Turns on AI help: catching repeat questions (multilingual), notes-to-polls and recap summaries. Add `"ai": { "binding": "AI" }` to `wrangler.jsonc`. Local dev then needs `wrangler login`. | off |
| `EMAIL_FROM` | Sender address for sign-in emails, on a domain you've verified. Host accounts switch on once this and one email option below are set. | empty (accounts off) |
| `send_email` binding | Send sign-in emails with Cloudflare Email Service (Workers paid plan). Uncomment it in `wrangler.jsonc`. | off |
| `RESEND_API_KEY` | Or send them with [Resend](https://resend.com). Set it as a secret: `npx wrangler secret put RESEND_API_KEY`. | empty |
| `APP_NAME` | Name used in sign-in emails. | `RSlide` |
| `AI_ACCOUNT_ID` + `AI_API_TOKEN` | Optional. The same AI help, using a Workers AI API token instead of a binding. Set them as secrets. | empty |
| `OIDC_ISSUER` + `OIDC_CLIENT_ID` | Optional **single sign-on**. Your identity provider's issuer URL and app ID. Also set the secret `OIDC_CLIENT_SECRET`. See [Single sign-on](#single-sign-on). | empty (off) |
| `OIDC_NAME` | Button label: "Sign in with …" | `SSO` |
| `OIDC_ALLOWED_DOMAINS` | Only these email domains may sign in with SSO, e.g. `acme.com, acme.ca`. | empty (any) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` | Optional **paid plans** for team workspaces (secrets). Point a Stripe webhook at `/api/billing/webhook`. | empty (off) |
| `FREE_MAX_PARTICIPANTS` / `PRO_MAX_PARTICIPANTS` | Attendees at once per event on each plan. Empty = `MAX_PARTICIPANTS`. | empty |

Team workspaces need host accounts (email or SSO). The `WORKSPACES` Durable Object is already in `wrangler.jsonc`.

### Single sign-on

1. In your identity provider, create a web app ("OpenID Connect"). Set the redirect URL to `https://YOUR-SITE/api/auth/sso/callback`.
2. Copy its issuer URL and client ID into `OIDC_ISSUER` and `OIDC_CLIENT_ID`, and run `npx wrangler secret put OIDC_CLIENT_SECRET`.
   - Microsoft Entra ID: `https://login.microsoftonline.com/<tenant-id>/v2.0`
   - Google Workspace: `https://accounts.google.com`
   - Okta: `https://<your-org>.okta.com`
3. Optional: limit it to your company with `OIDC_ALLOWED_DOMAINS`.

The sign-in page then shows "Sign in with …". It uses the authorization code flow with PKCE and checks the ID token's signature, issuer, audience, expiry and nonce. Only verified email addresses are accepted.

Repeat-question hints and paste-to-polls work without any AI. They run on your own server and send nothing elsewhere. AI repeat-checking is off for every event until the host turns it on. AI polls and AI summaries only run when the host presses the button, and the host checks the result before anyone sees it.

## Make it yours

| What | Where |
| --- | --- |
| App name, logo, home-page text, site-wide brand colours | `public/config.js` (no rebuild needed) |
| Who runs the site (privacy, terms, help pages) | `operator` and `contactEmail` in `public/config.js` |
| Colours | Theme presets at the top of `src/web/styles.css` (hosts pick one per event) |
| Fonts | Google Fonts link in `index.html` |
| Favicon | `public/favicon.svg` |

## How it works

```
Browser ──HTTP──▶ Worker (src/worker/index.ts) ──▶ web app (Preact, built by Vite)
   │
   └──WebSocket──▶ EventRoom Durable Object (one per event code)
                    • SQLite tables for questions, votes, polls, responses
                    • checks who may see and do what (host, big screen, attendee)
                    • sends small batched updates (~every 80 ms) instead of the whole event
```

- Each event code maps to its own Durable Object, so events never share state and scale independently.
- Attendees are identified by a random ID stored in their browser (one vote per question, one answer per poll).
- The host key lives in the URL fragment (`#…`), so it never appears in page requests or referrer headers.

## Tests

```bash
npm run typecheck
npm test                     # unit tests
npm run preview              # start the built app on http://localhost:8787, then in a second terminal:
npm run test:e2e             # 450+ end-to-end checks
```

For the full set, create a `.dev.vars` file (it's git-ignored) **before** `npm run build`:

```
WEBHOOK_ALLOW_PRIVATE="1"   # webhook tests deliver to a receiver on your machine
AUTH_DEV_LINKS="1"          # sign-in links come back in the response instead of by email (only ever works on localhost)
OIDC_ISSUER="http://127.0.0.1:9911"   # single sign-on tests run a fake identity provider on your machine
OIDC_CLIENT_ID="rslide-test"
OIDC_CLIENT_SECRET="test-secret"
OIDC_NAME="Test SSO"
OIDC_ALLOWED_DOMAINS="example.com"
```

```bash
npm run test:load -- 2000    # 2,000 simulated attendees: poll, upvotes and a quiz reveal
```

Point `BASE_URL` at a deployed copy to test real performance: `BASE_URL=https://your-app.workers.dev npm run test:load -- 2000`.

## Project layout

```
src/shared/    Message types and state reducer (shared by server, browser and tests)
src/worker/    Cloudflare Worker and the EventRoom Durable Object
src/web/       Preact web app: views, components, styles
public/        Static files, including config.js for branding
tests/         Unit, end-to-end and load tests
docs/          Roadmap and product plan
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for a deeper tour.

## Roadmap

See the full product plan in **[docs/ROADMAP.md](docs/ROADMAP.md)** — Slido Pro feature parity, design direction, architecture and release phases.

Done: Slido Pro-level Q&A, polls, quizzes, moderation, analytics and exports (v0.1–v0.3); repeat-question merging, phone remote, stream overlay and website embed (v0.4); paste-to-polls and recap pages (v0.5); translations, team quizzes, API and webhooks, host accounts (v0.6–v0.9); and in v1.0: team workspaces with roles, single sign-on, insights across events, custom branding, self-paced mode, pictures on questions, the PowerPoint add-in, the Teams app, your own slides with live polls on top, an installable app, trust pages and optional paid plans.
Next up: a native Zoom app (see the roadmap).

Contributions welcome — read [CONTRIBUTING.md](CONTRIBUTING.md), pick any unchecked item and open an issue.

## License

[MIT](LICENSE)
