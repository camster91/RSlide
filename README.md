# RSlide

**Open-source live Q&A and polling.** A self-hosted alternative to tools like Slido, for classes, meetings, conferences and town halls.

- No accounts for attendees — join with a short code, a link or a QR code
- Real-time updates over WebSockets
- Runs on Cloudflare Workers + Durable Objects: one tiny "room" per event, no database to manage, no build step
- Easy to white-label: one config file and a handful of colour tokens

> RSlide is an independent project. It is not affiliated with or endorsed by Slido or Cisco.

## Features

**Attendees** — `/e/CODE`
- Ask questions, named or anonymous; upvote other questions
- Sort by popular or recent
- Answer live polls and see results (when the host allows)

**Hosts** — `/host/CODE#hostkey` (private link, given when you create an event)
- Q&A moderation: review before publishing, highlight ("Now answering"), mark answered, archive, delete
- Open/close questions; allow or block anonymous questions
- Five poll types: multiple choice (single or multi-select), quiz (with answer reveal), rating (1–5 stars), word cloud, open text
- Prepare polls ahead of time, launch one at a time, close/reopen, reset, reorder, hide results from the audience
- Choose what the big screen shows: auto, Q&A, poll, or join code
- Export all questions and poll results to CSV

**Big screen** — `/present/CODE`
- Join URL, event code and QR code always visible
- Live poll results, the highlighted question, and the top-voted questions

## Quick start

```bash
git clone https://github.com/camster91/RSlide.git
cd RSlide
npm install
npm run dev          # http://localhost:8787
```

Run the end-to-end tests against the dev server (in a second terminal):

```bash
npm test
```

## Deploy to Cloudflare

Works on the Cloudflare Workers free plan.

```bash
npx wrangler login
npm run deploy
```

You'll get a `*.workers.dev` URL. To use your own domain, add it under the Worker's **Settings → Domains & Routes** in the Cloudflare dashboard.

## Make it yours

| What | Where |
| --- | --- |
| App name, logo, home-page text | `public/config.js` |
| Colours | `:root` block at the top of `public/app.css` |
| Fonts | Google Fonts link in `public/index.html` |
| Favicon | `public/favicon.svg` |

## How it works

```
Browser ──HTTP──▶ Worker (src/index.js) ──▶ static files in /public
   │
   └──WebSocket──▶ EventRoom Durable Object (one per event code)
                    • holds questions, votes, polls, responses
                    • saves state to its built-in storage
                    • pushes updates to every connected screen
```

- Each event code maps to its own Durable Object, so events never share state and scale independently.
- Attendees are identified by a random ID stored in their browser (used for one vote per question and one answer per poll).
- The host key is a random secret in the URL fragment (`#…`), so it isn't sent to servers in logs or referrers.

## Project layout

```
src/index.js       Worker + EventRoom Durable Object (all server logic)
public/index.html  App shell
public/config.js   Branding config
public/app.js      Home, attendee, host and big-screen views (vanilla JS)
public/app.css     Theme and layout
tests/e2e.mjs      End-to-end tests (host + attendees over WebSockets)
wrangler.jsonc     Cloudflare config
```

## Roadmap

See the full product plan in **[docs/ROADMAP.md](docs/ROADMAP.md)** — Slido Pro feature parity, design direction, architecture and release phases.

Next up (v0.2): design refresh with dark mode, quiz mode with timer and leaderboard, ranking polls, surveys, images in polls, reactions wall, event passcodes, and Excel/PDF export.

Contributions welcome — pick any unchecked item and open an issue.

## License

[MIT](LICENSE)
