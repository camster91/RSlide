# RSlide API and webhooks

Every event can have a **read-only API** and one **webhook**. Turn them on in the host console: **Settings → API and webhooks**.

- The API lets other tools (dashboards, LMSs, spreadsheets, bots) read questions, polls, results and the leaderboard.
- The webhook tells your server when something happens, like a new question or a poll launch.

Nothing is on until the host turns it on. Attendees never see API keys or webhook setup.

## API

Base address: `https://YOUR-RSLIDE-SITE/api/v1/events/CODE`

Send the event's API key in a header:

```bash
curl -H "Authorization: Bearer rs_your_key" https://your-rslide-site/api/v1/events/ABC123/questions
```

For a quick look in a browser you can also add `?key=rs_your_key`. Don't use that from code, because the key ends up in logs. The host link's key works too, but it gives full control of the event. Use the read-only API key whenever you can.

The API is read-only and only answers `GET`. Any website can call it (CORS is open), so keep the key on your server.

| Endpoint | What you get |
| --- | --- |
| `GET /api/v1/events/CODE` | Title, live poll, Q&A open or closed, rooms, labels, teams, counts |
| `GET /api/v1/events/CODE/questions` | Every question with votes, status, labels, room and replies. Filter with `?status=pending\|live\|answered\|archived` and `?room=ID` |
| `GET /api/v1/events/CODE/polls` | Every poll with its results |
| `GET /api/v1/events/CODE/polls/POLL_ID` | One poll with its results. Add `?responses=1` for every single answer |
| `GET /api/v1/events/CODE/leaderboard` | Quiz rankings for every player, plus team standings |
| `GET /api/v1/events/CODE/participants` | Everyone who gave a name, email or team |

Errors come back as JSON `{ "error": "…" }`:

- `401` means no key was sent.
- `403` means the key is wrong.
- `404` means the event or poll doesn't exist.
- `405` means you used something other than `GET`.

Making a new key in Settings stops the old one working right away.

## Webhooks

RSlide sends a `POST` with a JSON body to your address. Events that happen close together are grouped into one delivery, about once a second:

```json
{
  "event": "ABC123",
  "sentAt": 1760000000000,
  "events": [
    { "type": "question.created", "at": 1760000000000, "data": { "question": { "id": "…", "text": "…", "votes": 0, "status": "live" } } }
  ]
}
```

| Event | `data` |
| --- | --- |
| `question.created` | `{ question }` |
| `question.updated` | `{ question }`, sent when it's approved, answered, archived, highlighted, labelled, moved or edited |
| `question.deleted` | `{ id }`, plus `mergedInto` when it was merged into another question |
| `reply.created` | `{ questionId, reply }` |
| `poll.launched` | `{ poll, results }` |
| `poll.closed` | `{ poll, results }` |
| `poll.revealed` | `{ poll, results }`, sent when a quiz answer is revealed |
| `response.created` | `{ pollId, participant, name, value, at }`. This one is off by default because busy events send a lot |
| `ping` | Sent by the **Send a test** button |

### Checking a delivery is real

Each delivery has these headers:

- `X-RSlide-Event`: the event code
- `X-RSlide-Timestamp`: when it was sent (ms)
- `X-RSlide-Signature`: `sha256=` plus the HMAC-SHA256 of `TIMESTAMP.BODY`, using your webhook secret

Node.js example:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function isFromRSlide(req, rawBody, secret) {
  const ts = req.headers["x-rslide-timestamp"];
  const expected = "sha256=" + createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const got = req.headers["x-rslide-signature"] ?? "";
  const fresh = Math.abs(Date.now() - Number(ts)) < 5 * 60_000; // ignore old replays
  return fresh && got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
```

### Delivery rules

- Answer with any `2xx` status within 8 seconds.
- A failed delivery is retried once, 5 seconds later. The host console shows whether the last delivery worked.
- Delivery is best effort. If your server is down for a while, use the API to catch up.
- Addresses must be public `https://` URLs. Local and private network addresses are refused. For local development only, you can allow them with `WEBHOOK_ALLOW_PRIVATE="1"` in `.dev.vars`.
