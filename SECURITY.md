# Security policy

## Reporting a problem

Please **do not** open a public issue for security problems.

Instead, use GitHub's private reporting: go to the **Security** tab of this repository and choose **Report a vulnerability**. We'll reply as soon as we can and keep you updated until it's fixed.

## What's in scope

- The RSlide code in this repository (Worker, event room and web app).
- Ways to read or change an event without the host link.
- Ways to see data the host has hidden (pending questions, hidden results, quiz answers).
- Ways to crash or overload an event room.

## Notes for self-hosters

- The **host link** (the part after `#`) is the only key to an event. Treat it like a password.
- Set `EVENT_TTL_HOURS` in `wrangler.jsonc` if you want events deleted automatically.
- Set `MAX_PARTICIPANTS` to cap how many attendees can join one event.
