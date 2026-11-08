# API reference

Every endpoint the sample apps and the session server use. Base URL: `https://net.narsill.io`. Request and response bodies are JSON. Full documentation: [docs-resonance.narsill.com](https://docs-resonance.narsill.com).

## Authentication

| Header | Value | Used for |
|---|---|---|
| `Authorization: Bearer rk_…` | a physical node's key (`resonance api-key`) | creating clusters, attaching the node; inference |
| `Authorization: Bearer rk_s_…` | a logical node's scoped key (24 h) | inference, from a user's browser |
| `x-resonance-owner: ot_…` | the owner token of the cluster or logical node being managed | creating logical nodes, minting keys, stop / start / delete |

## Inference

### `POST /v1/chat/completions`

OpenAI-compatible. Callable from any web origin.

```json
{
  "model": "GLM-4.7-Flash",
  "messages": [{ "role": "system", "content": "…" }, { "role": "user", "content": "…" }],
  "max_tokens": 600,
  "temperature": 0.4,
  "stream": false,
  "tier": "free"
}
```

- `messages[].content` may be an array of parts for vision models: `{ "type": "text", "text": "…" }` and `{ "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,…" } }` (Tally sends receipt photos this way).
- `stream: true` returns Server-Sent Events: `data: {"choices":[{"delta":{"content":"…"}}]}` lines, ending with `data: [DONE]`.
- `tier`: `free` (the open network), `auto` (paid nodes when your wallet covers it), `paid` (verified paid nodes only).
- Reply: `{ "choices": [{ "message": { "role": "assistant", "content": "…" } }], "usage": { … } }`.

| Status | Meaning | What to do |
|---|---|---|
| `401` | missing, invalid, expired or revoked key | mint a new key |
| `403` | the logical node is stopped, or its cluster has no physical node | start it / attach a node |
| `404` | unknown model | pick one from `/v1/models` |
| `429` | rate limited | retry with backoff |
| `502`, `504` | the request failed on its way or on the serving node | retry with backoff |
| `503` | every node that could run it stayed busy | retry with backoff |

### `GET /v1/models`

The models the network serves, public: `[{ "model_id": "GLM-4.7-Flash", "tags": ["text-generation"], … }]`. Tags: `text-generation`, `coding`, `vision`, `speech`, `decision`. The samples list only chat models (they skip `speech` and `decision`, which take other inputs).

## Clusters

### `POST /v1/clusters`

`Authorization: Bearer rk_…` (your node). Body: `{ "label": "myapp-prod" }`. Returns `{ "id": "cl_…", "ownerToken": "ot_…" }`.

### `POST /v1/clusters/:id/nodes`

Attach your physical node: `Authorization: Bearer rk_…` and `x-resonance-owner: <cluster owner token>`. Body: `{ "nodeId": "rn_…" }`. A cluster mints working keys only while it has a physical node.

### `GET /v1/clusters/:id/status` · `GET /v1/clusters/:id/metrics`

The cluster's state and aggregate usage.

## Logical nodes

### `POST /v1/logical-nodes`

`x-resonance-owner: <cluster owner token>`. Body: `{ "clusterId": "cl_…", "label": "user:42" }`. Returns the logical node with `"id": "ln_…"` and its `"ownerToken"`.

### `GET /v1/logical-nodes/:id/api-key`

`x-resonance-owner: <logical node owner token>`. Returns `{ "apiKey": "rk_s_<ln>.<cluster>.<expiry ms>.<signature>" }`, valid 24 hours — or `null` when the cluster has no physical node.

### `GET /v1/logical-nodes/:id/usage`

`{ "requests": 1234, "tokens": 567890 }`, counted since the logical node was created.

### `POST /v1/logical-nodes/:id/stop` · `/start`

`x-resonance-owner: <logical node owner token>`. While stopped, its keys are refused with `403`.

### `DELETE /v1/logical-nodes/:id`

`x-resonance-owner: <logical node owner token>`. Every key it was given stops working.

## The session server

[`server/server.mjs`](../server/server.mjs) wraps the calls above for the samples:

| Endpoint | Body | Returns |
|---|---|---|
| `POST /session` | `{ "app": "crm", "user": "Marta" }` | `{ "apiKey", "expiresAt", "logicalNode" }` |
| `GET /usage` | — | `[{ "user", "logicalNode", "requests", "tokens" }]` |
| `POST /offboard` | `{ "app", "user" }` | `{ "deleted": "ln_…" }` |
