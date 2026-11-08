# Integration guide: put your app on the network

Six steps from "I have an app" to "every user of my app is a logical node on Resonance". The code is plain JavaScript with `fetch` (Node 18+ on the server, any browser on the client); [`server/server.mjs`](../server/server.mjs) is all of it in one runnable file.

```js
const API = "https://net.narsill.io";
async function call(method, path, { body, headers = {} } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}
```

## 1. Run a physical node

Install the Resonance node on a machine you control and link it to your account (run `resonance`; it shows a QR to scan). Then:

```bash
resonance api-key     # rk_…  — your backend's secret
resonance status      # Node ID: rn_…
```

Put both in your backend's environment (`RESONANCE_NODE_KEY`, `RESONANCE_NODE_ID`). Keep the node online: the cluster's keys work only while the cluster has a physical node.

## 2. Create your app's cluster — once

```js
const NODE = { authorization: `Bearer ${process.env.RESONANCE_NODE_KEY}` };

const cluster = await call("POST", "/v1/clusters", { body: { label: "myapp-prod" }, headers: NODE });
// { id: "cl_…", ownerToken: "ot_…" }

await call("POST", `/v1/clusters/${cluster.id}/nodes`, {
  body: { nodeId: process.env.RESONANCE_NODE_ID },
  headers: { ...NODE, "x-resonance-owner": cluster.ownerToken },
});
```

Store `cluster.id` and `cluster.ownerToken` as configuration secrets. The owner token is shown only at creation.

## 3. Give each user a logical node — at sign-up

```js
const ln = await call("POST", "/v1/logical-nodes", {
  body: { clusterId: CLUSTER_ID, label: `user:${user.id}` },
  headers: { "x-resonance-owner": CLUSTER_OWNER_TOKEN },
});
// { id: "ln_…", ownerToken: "ot_…", … }
await db.users.update(user.id, { lnId: ln.id, lnOwnerToken: ln.ownerToken });
```

The label is yours — use something that maps back to your user without exposing personal data.

## 4. Hand out the user's key — at sign-in

```js
app.post("/api/resonance-key", requireSignedIn, async (req, res) => {
  const u = req.user;
  const { apiKey } = await call("GET", `/v1/logical-nodes/${u.lnId}/api-key`, {
    headers: { "x-resonance-owner": u.lnOwnerToken },
  });
  res.json({ apiKey });   // rk_s_<ln>.<cluster>.<expiry ms>.<signature>, valid 24 h
});
```

The expiry is the third dot-separated part of the key (milliseconds since 1970), so you can cache the key and mint a fresh one shortly before it expires. `apiKey` is `null` when the cluster has no physical node attached.

## 5. Call the network from the browser — with the user's key

```js
const { apiKey } = await (await fetch("/api/resonance-key", { method: "POST" })).json();

const res = await fetch("https://net.narsill.io/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model: "GLM-4.7-Flash",
    messages: [{ role: "user", content: "Summarize this ticket in one line: …" }],
    max_tokens: 200,
  }),
});
const { choices } = await res.json();
```

The API is OpenAI-compatible: `stream: true` returns Server-Sent Events, and `GET /v1/models` lists the models with their tags (`text-generation`, `coding`, `vision`, …). [`src/samples/api.js`](../src/samples/api.js) is a complete client in 150 lines — streaming, JSON replies, bounded parallelism and retries.

If your backend makes calls on a user's behalf (scheduled jobs, webhooks), it does the same with that user's key — or with a logical node of its own, so automation is metered apart from people.

## 6. Usage, budgets and offboarding

```js
// Requests and tokens per user (counted since the logical node was created).
const { requests, tokens } = await call("GET", `/v1/logical-nodes/${u.lnId}/usage`);

// Over budget: stop — the user's keys are refused until you start it again.
await call("POST", `/v1/logical-nodes/${u.lnId}/stop`, { body: {}, headers: { "x-resonance-owner": u.lnOwnerToken } });
await call("POST", `/v1/logical-nodes/${u.lnId}/start`, { body: {}, headers: { "x-resonance-owner": u.lnOwnerToken } });

// The user leaves: delete — every key they were given stops working at once.
await call("DELETE", `/v1/logical-nodes/${u.lnId}`, { headers: { "x-resonance-owner": u.lnOwnerToken } });
```

For a monthly cap, record each user's count at the start of the month and compare against it — `server/server.mjs` shows how.

## Checklist

- [ ] The node key and every owner token live only on your server.
- [ ] The browser gets only its own user's `rk_s_…` key, from an endpoint behind your sign-in.
- [ ] One cluster per app; a physical node attached and online.
- [ ] One logical node per thing you want to see and cap separately (person, automation, repository, product).
- [ ] Parallel calls go through a bounded pool, and the client retries `429`, `502`, `503` and `504` with backoff ([patterns](patterns.md)).
- [ ] What must be exact — numbers, policies, verdicts, quotes — is computed or checked in code, not left to the model.
- [ ] Usage is read per user, and stop / delete are wired to your budgets and offboarding.
