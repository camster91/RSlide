# Contributing to RSlide

Thanks for helping! RSlide aims to be the best free, open-source alternative to paid audience-engagement tools. Every contribution counts — code, design, docs, translations and bug reports.

## Find something to work on

- The plan lives in [docs/ROADMAP.md](docs/ROADMAP.md). Unchecked items are fair game.
- Issues labelled **good first issue** are small and well-scoped.
- Have an idea that isn't on the roadmap? Open a feature request first so we can talk it through.

## Set up

You need Node.js 20 or newer.

```bash
git clone https://github.com/camster91/RSlide.git
cd RSlide
npm install
npm run dev        # http://localhost:5173 — hot reload for the web app and the Worker
```

## Project layout

```
src/shared/     Message types and the client-side state reducer (used by server, browser and tests)
src/worker/     Cloudflare Worker + EventRoom Durable Object (one per event)
  index.ts      HTTP routes
  room.ts       Real-time event room: SQLite storage, permissions, batched patches
  logic.ts      Pure helpers: validation, tallies, quiz points, rate limiting (unit-tested)
  xlsx.ts       Tiny Excel writer used by exports
src/web/        Preact front end
  views/        Home, Attendee, Host, Present (big screen), Report
  components/   Shared UI pieces: results for every poll type, countdown, podium, reactions
  styles.css    Design tokens, 6 theme presets (light + dark) and all styles
  lib/          WebSocket hook, routing, storage helpers
public/         Static files. config.js holds branding.
tests/unit/     Vitest unit tests
tests/e2e/      End-to-end and load tests against a running server
```

### How real-time works

1. Each event code maps to one **EventRoom** Durable Object with its own SQLite database.
2. A browser connects by WebSocket and gets a full **hello** snapshot, filtered for its role (host, big screen or attendee).
3. Every change marks items as dirty. About every 80 ms the room sends one small **patch** per role, plus a **me** message to people whose own votes or answers changed.
4. The browser applies patches with the same reducer the tests use (`src/shared/store.ts`).

Keep this model when adding features: store in SQLite, mark dirty, let `flush()` send.

## Before you open a pull request

```bash
npm run typecheck
npm test
npm run preview            # in one terminal
npm run test:e2e           # in another
npm run test:load -- 500   # optional, for changes to the room
```

- Keep pull requests focused on one thing.
- Add or update tests for new behavior.
- For UI changes, include screenshots of the attendee, host and big-screen views (light and phone width).
- Use plain, friendly words in the UI. Short sentences. No jargon.

## Design rules

- Attendees never need an account.
- Every audience-facing feature needs a host control (pause, hide or moderate).
- Must work on a phone with a weak connection.
- Must meet WCAG 2.1 AA (contrast, keyboard, labels).
- Must stay within Cloudflare's free plan for normal-sized events.

## Code of conduct

By taking part you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree your work is released under the [MIT License](LICENSE).
