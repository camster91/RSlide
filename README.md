# RSlide

**Open-source live Q&A and polling.** A self-hosted alternative to tools like Slido, for classes, meetings, conferences and town halls.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/camster91/RSlide)
[![CI](https://github.com/camster91/RSlide/actions/workflows/ci.yml/badge.svg)](https://github.com/camster91/RSlide/actions/workflows/ci.yml)

- No accounts for attendees — join with a short code, a link or a QR code
- Real-time updates over WebSockets, tested with 2,000 attendees in one event
- Runs on Cloudflare Workers + Durable Objects: one tiny "room" per event, no database server to manage
- Small and fast: the attendee app is under 20 KB zipped
- Easy to white-label: one config file and a handful of colour tokens

> RSlide is an independent project. It is not affiliated with or endorsed by Slido or Cisco.

## Features

**Attendees** — `/e/CODE` (no account, ever)
- Ask questions, named or anonymous; upvote (and optionally downvote) others
- Edit or withdraw your own questions; reply to others (when the host allows)
- **"Already asked?"** — while you type, similar questions pop up so you can upvote instead of repeating
- Pick a Q&A room when an event has several (e.g. one per session)
- Answer 11 kinds of polls: multiple choice, quiz, rating, scale, ranking, word cloud, open text, 100 points, 2×2 grid, pin on image and multi-question surveys
- Quiz mode with a countdown, points for speed and a live leaderboard
- **Team quizzes**: pick a team (or "Pick for me" to balance them); teams are ranked by average points so size doesn't matter
- Send emoji reactions that float up the big screen
- Works in light and dark mode, sized for one-handed phone use
- **English, French and Spanish**: the app follows each phone's language, with a menu to switch

**Hosts** — `/host/CODE#hostkey` (private link, given when you create an event)
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
- Six colour themes per event; light or dark big screen
- Export everything to Excel (questions, results, every answer, leaderboard, participants), CSV, or a printable report you can save as PDF

**Big screen** — `/present/CODE`
- Giant join code, URL and QR code always visible
- Live results for every poll type, quiz countdown and answer reveal
- Podium leaderboard with confetti, floating reactions, highlighted question
- One screen per room with `?room=` links
- **Stream overlay** (`?overlay=1`): a see-through lower third for OBS, vMix or StreamYard

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
| `AI_ACCOUNT_ID` + `AI_API_TOKEN` | Optional. The same AI help, using a Workers AI API token instead of a binding. Set them as secrets. | empty |

Repeat-question hints and paste-to-polls work without any AI. They run on your own server and send nothing elsewhere. AI repeat-checking is off for every event until the host turns it on. AI polls and AI summaries only run when the host presses the button, and the host checks the result before anyone sees it.

## Make it yours

| What | Where |
| --- | --- |
| App name, logo, home-page text | `public/config.js` (no rebuild needed) |
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
npm run test:e2e             # 240+ end-to-end checks with hosts, moderators, attendees and a big screen
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

Done: Slido Pro-level Q&A, polls, quizzes, moderation, analytics and exports (v0.1–v0.3), plus repeat-question merging, phone remote, stream overlay and website embed (v0.4), and paste-to-polls and recap pages (v0.5).
Next up: public API and webhooks, host accounts.

Contributions welcome — read [CONTRIBUTING.md](CONTRIBUTING.md), pick any unchecked item and open an issue.

## License

[MIT](LICENSE)
