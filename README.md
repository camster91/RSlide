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
- Edit or withdraw your own questions
- Answer 8 kinds of polls: multiple choice, quiz, rating, scale, ranking, word cloud, open text and multi-question surveys
- Quiz mode with a countdown, points for speed and a live leaderboard
- Send emoji reactions that float up the big screen
- Works in light and dark mode, sized for one-handed phone use

**Hosts** — `/host/CODE#hostkey` (private link, given when you create an event)
- Q&A moderation: review first, show on screen, mark answered, archive, delete
- Build polls ahead of time, with images on options; launch, close, reorder, duplicate, clear answers
- Quiz: set a timer (or none), reveal the answer, show the leaderboard on the big screen
- Event passcode, and ask people for their name or name + email before they join
- Six colour themes per event; light or dark big screen
- Export everything to Excel (questions, results, every answer, leaderboard, participants), CSV, or a printable report you can save as PDF

**Big screen** — `/present/CODE`
- Giant join code, URL and QR code always visible
- Live results for every poll type, quiz countdown and answer reveal
- Podium leaderboard with confetti, floating reactions, highlighted question

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
npm run test:e2e             # 100+ end-to-end checks with a host, attendees and a big screen
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

Next up (v0.2): design refresh with dark mode, quiz mode with timer and leaderboard, ranking polls, surveys, images in polls, reactions wall, event passcodes, and Excel/PDF export.

Contributions welcome — read [CONTRIBUTING.md](CONTRIBUTING.md), pick any unchecked item and open an issue.

## License

[MIT](LICENSE)
