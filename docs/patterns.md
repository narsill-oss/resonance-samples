# Patterns

The eight apps look nothing alike, but they are built from the same few techniques. Each is a small function in [`src/samples/api.js`](../src/samples/api.js) or a few lines in an app.

## Fan-out with bounded concurrency

The network serves requests side by side on different nodes, so the fastest way to do many things is to send them at once — but not all at once without limit. `pool(tasks, limit)` runs at most `limit` in flight and returns every result, successes and failures alike:

```js
const results = await pool(deals.map((d) => () => chatJson({ ...net.call, messages: score(d) })), 4);
const failed = results.filter((r) => !r.ok);
```

| App | One request per… | Limit |
|---|---|---|
| Kestrel | deal | 4 |
| Relay | ticket | 5 |
| Folio | handbook page | 6 |
| Tally | receipt photo (vision) | 5 |
| Lintel | file — two reviewers each | 6 |
| Parlance | language | 8 |
| Quarry | analysis lens | 6 |
| Shortlist | CV | 5 |

The Requests tab shows the result: bars that overlap ran at the same time, and the speed-up over running them one by one.

## Map → reduce

Many requests each answer about one item; one more request reads all their answers. Relay triages every ticket (map), then one call groups tickets with the same cause into incidents (reduce). Lintel reviews each file, then one call decides the verdict. Quarry runs six analyses, then one call writes the briefing. The reduce step sees only the map step's small JSON results, never the raw inputs again — it is cheap and fast.

## JSON in, JSON out — then check it

Ask for JSON in the system prompt ("Reply ONLY with JSON: {…}"), parse it with `chatJson` (which finds the object even when a model wraps it in prose or a code fence), and then **check it in code**:

- Shortlist keeps a score only if its quote is really in the CV; Folio keeps an audit flag only if its sentence is really on the page; Parlance keeps a glossary term only if it appears in your strings.
- Lintel drops findings on lines that aren't in the diff.
- Shortlist rescales rubric weights so they add up to exactly 100, whatever the model returned.

A model's reply is a draft. Code decides what is valid.

## What never to leave to a model

- **Numbers** — Quarry's model writes a query *plan*; a small engine in the page computes every number on every row. Tally converts currencies and applies hotel caps in JavaScript.
- **Rules** — Tally's expense policy, Parlance's placeholder and length checks, Shortlist's must-have knockouts are code.
- **Personal data** — Shortlist removes names, contacts, age and pronouns *before* anything is sent. Quarry never sends rows, only the schema, five example rows and computed results.

## Streaming

For prose a person reads as it arrives — a follow-up email, a reply, a briefing — use `stream: true`. `chat({ …, onDelta })` reads the Server-Sent Events and calls `onDelta(piece, soFar)` for each piece; pass an `AbortController`'s `signal` to stop it half-way.

## Retries

The client in `api.js` retries a request up to four times when the network answers `429`, `502`, `503` or `504`, or when the connection drops before an answer — with a pause that doubles each time plus random jitter, so a burst of parallel calls doesn't come back in lockstep. Only the response headers are awaited before deciding, so a stream that has started is never sent twice. Anything else (a bad request, an expired key) fails at once.

When every node that could run a request is busy, the network itself waits for a free one; retries cover the rest.

## Per-user calls

Every call carries the key of the user it is for. In the samples, `setSeat(name)` tags each request with the user the app acts for, and the Architecture tab counts calls per user. With the session server, the tag becomes a real per-user key. In your app, the browser simply uses the key your backend gave it at sign-in.

## Keep work in the browser

The samples keep everything — deals, tickets, results — in `localStorage` (`useStored`), so they work without a backend of their own, survive reloads and send nothing anywhere but the network. In your app, that is your database.
