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
- **Host accounts** are optional. Sign-in links work once and last 15 minutes. Each address can ask for at most 5 links in 15 minutes. Sessions are HttpOnly, SameSite=Lax cookies that last 30 days. The server only stores hashes of links and sessions. "Sign out on all devices" ends every session.
- Never set `AUTH_DEV_LINKS` or `WEBHOOK_ALLOW_PRIVATE` on a real server. They are for local development and tests. Development sign-in links are refused anywhere but `localhost` anyway.
- **API keys** are read-only but can see names and emails. Making a new key stops the old one working. Webhook deliveries are signed (HMAC-SHA256) and can only go to public `https://` addresses.

## Single sign-on, workspaces and payments

- Single sign-on uses the OpenID Connect authorization code flow with PKCE, a one-time state and nonce (kept in a 10-minute HttpOnly cookie), and full ID token checks (signature from the provider's keys, issuer, audience, expiry, nonce). Only verified email addresses are accepted, optionally limited to `OIDC_ALLOWED_DOMAINS`. After sign-in we only redirect to paths on this site.
- Plain-http identity providers are refused, except a provider on `127.0.0.1` when `AUTH_DEV_LINKS="1"` and the site itself is opened on localhost (tests only).
- Team workspace invites are single-use, expire after 7 days and only work for the email address they were sent to. Viewers never receive host links; the server reads analytics for them.
- Stripe webhooks are checked with `STRIPE_WEBHOOK_SECRET` (HMAC-SHA256, 5-minute tolerance, constant-time compare). Card details never reach this server.
- The PowerPoint add-in stores the host link in the presentation file. Treat that file like the host link.

