# RSlide Product Plan

**Goal:** Everything Slido's Pro plan does, plus the things it doesn't — free, open source (MIT), and deployable in one command.

Last updated: October 2026 · Phases 0 and 1 done (v0.2), except the public demo

---

## 1. Why RSlide wins

| | Slido Pro | Mentimeter Pro | Claper (open source) | **RSlide** |
| --- | --- | --- | --- | --- |
| Price | ~$900/yr, 2 hosts | ~$300/yr per presenter | Free | **Free** |
| Audience cap | 1,000 per event | Unlimited | Depends on your server | **Unlimited (goal: 5,000+ tested)** |
| License | Closed | Closed | AGPL-3.0 | **MIT** (use it anywhere, even commercially) |
| Hosting | Their cloud | Their cloud | Your server + PostgreSQL | **Cloudflare free plan, one command** |
| Your data | On their servers | On their servers | Yours | **Yours** |

**Our pitch in one line:** *"Slido Pro features. Free. Deploy in 60 seconds."*

The two real advantages to protect:
1. **Zero ops.** No server, no database to run. `npm run deploy` and you're live.
2. **MIT license.** Schools, companies and agencies can white-label it with no legal worry. Claper's AGPL scares off many companies.

---

## 2. Product principles

1. **Join in 5 seconds.** Code, link or QR. No app, no account for attendees, ever.
2. **The big screen is the hero.** It must look great on a projector from the back of the room.
3. **The host stays in control.** Every audience-facing thing can be paused, hidden or moderated.
4. **Works on bad Wi-Fi.** Auto-reconnect, tiny pages, no heavy downloads.
5. **Private by default.** No tracking, no ads, data auto-deletes on a schedule the host picks.
6. **Accessible.** Keyboard, screen reader and high-contrast friendly (WCAG 2.1 AA).
7. **Free to run.** Every feature must work on Cloudflare's free plan for normal use.

---

## 3. Feature parity checklist

✅ done · 🔜 planned (phase number) · ➕ RSlide extra (not in Slido)

### Audience Q&A
| Feature | Slido tier | RSlide |
| --- | --- | --- |
| Ask questions, upvote | Free | ✅ |
| Anonymous or named | Free | ✅ |
| Sort by popular / recent | Free | ✅ |
| Host highlights a question on screen | Free | ✅ |
| Mark answered, archive | Free | ✅ |
| Moderation (review before publish) | **Pro** | ✅ |
| 300-character questions | **Pro** | ✅ |
| Replies to questions (host and audience) | **Pro** | 🔜 P2 |
| Labels / tags (e.g. "Finance", "Follow-up") | **Pro** | 🔜 P2 |
| Multiple Q&A rooms in one event | **Pro** | 🔜 P2 |
| Edit / withdraw your own question | Free | ✅ |
| Downvotes (optional) | Free | ✅ |
| "Similar question already asked" while typing | — | ➕ P3 |
| AI merges duplicate questions | — | ➕ P3 |
| Profanity / keyword filter | Pro | 🔜 P2 |

### Polls and quizzes
| Feature | Slido tier | RSlide |
| --- | --- | --- |
| Multiple choice (single / multi) | Free | ✅ |
| Word cloud | Free | ✅ |
| Rating (stars) | Free | ✅ |
| Open text | Free | ✅ |
| Quiz with correct answer | Free | ✅ |
| Ranking poll | Free | ✅ |
| Unlimited polls | Engage | ✅ |
| Images in poll options | Engage | ✅ |
| Surveys (several questions in a row) | Engage | ✅ |
| Quiz timer + points for speed | Free/Pro | ✅ |
| Live leaderboard + podium | **Pro** | ✅ |
| Team quiz mode | — | ➕ P3 |
| 2×2 grid, 100-points, pin-on-image (Mentimeter types) | — | ➕ P2 |
| Scale / slider poll | — | ✅ ➕ |
| Emoji reactions that float up on the big screen | — | ✅ ➕ |

### Hosting and control
| Feature | Slido tier | RSlide |
| --- | --- | --- |
| Big-screen present mode with QR | Free | ✅ |
| Show/hide results from audience | Free | ✅ |
| CSV export | Engage | ✅ |
| Excel + PDF export | Engage | ✅ |
| Host accounts + event dashboard | Free | 🔜 P2 |
| Co-hosts and moderators | Engage/Pro | 🔜 P2 |
| Duplicate an event / reuse polls | Free | ◐ duplicate polls ✅, events P2 |
| Templates (icebreakers, retros, NPS…) | Free | 🔜 P2 |
| Event dates, auto-open, auto-close | Free | 🔜 P2 |
| Presenter remote (control from your phone) | — | ➕ P3 |
| Stream overlay for OBS / Zoom (transparent background) | — | ➕ P3 |

### Branding and privacy
| Feature | Slido tier | RSlide |
| --- | --- | --- |
| Custom branding (logo, colours) — whole app | **Pro** | ✅ (config file) |
| Custom branding per event | **Pro** | ◐ theme per event ✅, logo P2 |
| Event passcode | Pro | ✅ |
| Require name or email to join ("verified participants") | Engage | ✅ |
| Hide participant names from other attendees | **Pro** | 🔜 P2 |
| Data retention / auto-delete | Enterprise | 🔜 P2 (free for us) |
| SSO for hosts and participants | Enterprise | 🔜 P4 |

### Analytics and integrations
| Feature | Slido tier | RSlide |
| --- | --- | --- |
| Event analytics (joins, votes, top questions) | Free/Pro | 🔜 P2 |
| Organization analytics | **Pro** | 🔜 P2 |
| AI recap of the event | — | ➕ P3 |
| Shareable recap page | — | ➕ P3 |
| PowerPoint add-in | Free | 🔜 P3 |
| Google Slides add-on | Free | 🔜 P4 |
| Zoom / Teams / Webex apps | Free | 🔜 P4 |
| Embed on any website | — | ➕ P3 |
| Public API + webhooks | Enterprise | ➕ P3 |
| LMS (Canvas, Moodle, Brightspace via LTI 1.3) | — | ➕ P4 |
| Translations (UI in many languages) | Free | 🔜 P3 |

---

## 4. Our best ideas (beyond Slido)

These are the features that make people choose RSlide even if price didn't matter.

1. **Reactions wall.** Audience taps 👏 🔥 😂 ❤️ 🤯 and they float up the big screen. Cheap to build, huge "wow" in a room. Optional applause meter.
2. **Smart Q&A (opt-in AI).** Uses Cloudflare Workers AI, which runs on the same free account — no extra API key.
   - "Someone already asked this" while you type.
   - Merge duplicate questions so votes aren't split.
   - Translate questions to the presenter's language.
   - Flag rude questions for review.
3. **One-click recap.** After the event, a shareable page: top questions, poll results, word clouds, and an AI summary. Great for sending to people who missed it.
4. **Presenter remote.** The host opens a phone-sized control page: next poll, highlight a question, show results. No laptop juggling on stage.
5. **Stream overlay.** `/present/CODE?overlay=1` gives a transparent background for OBS, Zoom backgrounds and live streams.
6. **Paste-to-polls (opt-in AI).** Paste your slide notes or an agenda, get draft polls and quiz questions.
7. **Template gallery.** Ready-made sets: class check-in, all-hands, retro, NPS, icebreakers, trivia night. One click to copy into an event.
8. **Embed anywhere.** One `<script>` tag puts live Q&A or a poll on any website, WordPress page or LMS.
9. **Deploy button.** A "Deploy to Cloudflare" button in the README — non-developers can run their own copy without touching a terminal.
10. **Data that leaves when you say.** Each event can auto-delete after 7, 30 or 90 days. Built in, not an enterprise upsell.

---

## 5. Design plan

### Direction (from Dribbble research)
Current poll, quiz and survey designs share a clear style:
- **Soft violet / lavender palettes** with one bright accent.
- **Big rounded cards** (20px+ corners) and soft shadows.
- **Pill-shaped tabs and buttons.**
- **Stat tiles** with a big number and a small progress ring.
- **Gamified quiz screens:** 1-2-3 podium, avatars, streaks, "you beat 60% of players".
- **Floating bottom nav** on phones.
- **Dark mode**, which also suits projectors in dark rooms.

RSlide's indigo + amber palette already fits. The refresh makes it feel more modern and more fun, without losing the clean, trustworthy feel schools and companies need.

### Design tokens (theme system)
- Colours: `brand`, `brand-ink`, `accent`, `surface`, `line`, `success`, `danger` — light and dark sets.
- Radius scale: 8 / 12 / 20 / 28px.
- Type: Inter for UI, a display serif for big-screen headlines (swappable).
- Motion: bars grow, numbers count up, confetti on quiz wins. All motion respects "reduce motion" settings.
- **Per-event themes:** host picks a preset (Indigo, Ocean, Forest, Sunset, Mono, High-contrast) or sets their own colours and logo.

### Screens to design
| Screen | Key changes |
| --- | --- |
| Home / join | Big code input, recent events, "Host an event" CTA |
| Attendee (phone) | Bottom nav: Q&A · Polls · Reactions. Sticky ask box. Big tap targets |
| Attendee quiz | Countdown ring, coloured answer tiles, "correct!" moment, rank after each question |
| Host dashboard | Event list with stats tiles, templates, search |
| Host live console | 3 columns on desktop: Q&A · Run of show (polls in order) · Live preview of the big screen |
| Presenter remote | One-handed phone layout, giant Next button |
| Big screen | Light/dark, presets, animated results, podium, reactions layer, join banner |
| Recap page | Clean, printable, shareable |
| Analytics | Stat tiles, participation over time, top questions |

### Accessibility checklist
Colour contrast ≥ 4.5:1, focus rings, all actions keyboard-reachable, live regions for new questions, labels on every control, text scales to 200%.

---

## 6. Technical plan

### Keep
- **Cloudflare Workers + one Durable Object per event.** This is our superpower: real-time, no database server, scales by event.
- Plain web standards, small bundle, fast on phones.

### Change
| Area | Today | Plan |
| --- | --- | --- |
| Language | ~~Plain JS~~ | ✅ **TypeScript** |
| Front end | ~~One 500-line file~~ | ✅ **Vite + Preact** components |
| Live state storage | ~~One JSON blob per event~~ | ✅ **SQLite tables inside each Durable Object** |
| Updates to clients | ~~Full state on every change~~ | ✅ **Small patches**, batched every ~80 ms |
| Accounts + event list | None (host link only) | **Cloudflare D1** (serverless SQLite) for hosts, orgs, event index, analytics |
| Images and logos | None | **Cloudflare R2** (file storage) |
| Login | Secret host link | **Email magic link** (Cloudflare Email Service). Later: Google / Microsoft / SAML SSO |
| Abuse protection | ✅ Rate limits per person, participant cap | + **Cloudflare Turnstile** (free captcha) on public events |
| AI | None | **Workers AI**, opt-in, off by default |

### Scale target
- 5,000 people in one event with votes arriving at the same time.
- One Durable Object runs on a single thread, so for very large events we add a **fan-out layer** (several relay objects that each serve ~1,000 connections).
- Load test in CI before each release.

### Quality
- GitHub Actions: lint, type-check, unit tests, WebSocket end-to-end tests, Playwright browser tests.
- Preview deploy for every pull request.
- Load test script (2,000+ simulated attendees).

---

## 7. Roadmap

Time estimates assume one main developer with AI help. Each phase ends with a tagged release and a demo update.

### Phase 0 — Foundations (week 1)
- [ ] Live demo at a public URL (auto-deletes events after 24 h) — *code ready (`EVENT_TTL_HOURS`, `MAX_PARTICIPANTS`); needs a Cloudflare account to deploy*
- [x] "Deploy to Cloudflare" button — *works once the repo is public*
- [x] CI pipeline, CONTRIBUTING.md, Code of Conduct, issue and PR templates
- [x] Move to TypeScript + Vite + Preact
- [x] SQLite tables in the Durable Object + patch-based updates
- [x] Load test: 2,000 attendees — *passes locally: poll reaches all 2,000 in < 0.8 s, all votes counted*

### Phase 1 — Engage parity + design refresh (weeks 2–4) → **v0.2** ✅
- [x] New design system, dark mode, theme presets (6 themes, light/dark big screen)
- [x] Ranking poll, scale poll
- [x] Surveys (multi-question, skippable, editable answers)
- [x] Images in poll options (R2, auto-shrunk on upload)
- [x] **Quiz mode:** timer, speed points (500–1,000), leaderboard, podium, confetti
- [x] Reactions wall
- [x] Edit/withdraw own question, optional downvotes
- [x] Event passcode; require name or name + email
- [x] Excel export + printable report (save as PDF)

### Phase 2 — Pro parity (weeks 5–8) → **v0.5**
- [ ] Host accounts (magic link) + dashboard of events
- [ ] Co-hosts and moderators
- [ ] Duplicate events, template gallery
- [ ] Q&A replies, labels, multiple rooms
- [ ] Per-event branding (logo, colours, theme)
- [ ] Hide names, data auto-delete, profanity filter
- [ ] Event schedule: auto-open / auto-close
- [ ] Event + organization analytics
- [ ] Mentimeter-style types: 2×2 grid, 100 points, pin on image

### Phase 3 — Beyond Slido (weeks 9–12) → **v1.0**
- [ ] Smart Q&A (AI dedupe, similar-question hints, translate, moderation assist)
- [ ] Paste-to-polls (AI)
- [ ] Recap pages + AI summary
- [ ] Presenter remote
- [ ] Stream overlay mode
- [ ] Embed script for any website
- [ ] Public API + webhooks
- [ ] PowerPoint web add-in
- [ ] Translations (start: English, French, Spanish)
- [ ] Team quiz mode

### Phase 4 — Enterprise-ready (after v1.0)
- [ ] SSO (OIDC + SAML) and SCIM user provisioning
- [ ] Audit log
- [ ] LTI 1.3 for Canvas / Moodle / Brightspace
- [ ] Google Slides add-on, Zoom / Teams apps
- [ ] Self-host outside Cloudflare (Docker image)
- [ ] Third-party accessibility audit and security review
- [ ] 5,000+ attendee load test with fan-out

---

## 8. Launch and community plan

**Before v0.2**
- Clean README with a GIF of the big screen, live demo link and Deploy button.
- Comparison page: RSlide vs Slido vs Mentimeter vs Claper (honest, factual).

**At v0.2 launch**
- Show HN, r/selfhosted, r/opensource, r/Teachers, Product Hunt.
- Submit to awesome-selfhosted and alternativeTo (as a Slido / Mentimeter alternative).
- Short demo video (30 s): join with QR → vote → results animate.

**Ongoing**
- Label 10+ "good first issue" tickets per phase.
- GitHub Discussions for ideas; public roadmap = this file.
- GitHub Sponsors.

**Optional ways to make money (keeps the code fully MIT):**
- Paid hosted version for people who don't want to deploy.
- Setup, branding and SSO integration services for schools and companies (a natural fit for an agency).
- Sponsored features (an org pays to fast-track a roadmap item).

---

## 9. How we measure success

| Metric | v0.2 | v1.0 |
| --- | --- | --- |
| GitHub stars | 250 | 2,000 |
| Self-hosted deploys (opt-in ping, off by default) | 25 | 300 |
| Largest tested event | 2,000 | 5,000 |
| Vote → big screen delay (95th percentile) | < 500 ms | < 300 ms |
| Attendee page size | < 60 KB | < 80 KB |
| Lighthouse accessibility score | 95 | 100 |

---

## 10. Risks

| Risk | Plan |
| --- | --- |
| Trademark trouble | Never use "Slido" in our name, logo or domain. Factual comparisons only. |
| Spam on the public demo | Turnstile, rate limits, 24 h auto-delete, small participant cap on demo. |
| Free-plan limits on Cloudflare | Document limits clearly; keep features within free usage for normal events. |
| Very large events on one Durable Object | Fan-out relay layer (Phase 4), load tests every release. |
| Privacy laws (GDPR, FERPA, PIPEDA) | No tracking, data auto-delete, export + delete tools for hosts, clear privacy doc. |
| AI costs or accuracy | Opt-in only, off by default, host always reviews AI output. |
| Scope creep | Each phase ships before the next starts. Parity first, extras second. |

---

## 11. Open decisions

1. **Front-end stack:** Vite + Preact (recommended — small and familiar) vs staying build-free vanilla JS.
2. **Live demo domain:** a free `*.workers.dev` URL vs a custom domain (e.g. `rslide.app`).
3. **Hosted paid version:** plan for it now (affects account/billing design) or later.
4. **First AI feature:** duplicate-question merging (recommended — most useful in big rooms) vs paste-to-polls.
