# The session server

The one backend piece an app needs to put each of its users on the Resonance network as a logical node with their own key. One file, no dependencies, Node 18 or newer: [`server.mjs`](server.mjs).

## Run it

```bash
export RESONANCE_NODE_KEY=rk_…    # resonance api-key   (on your node's machine)
export RESONANCE_NODE_ID=rn_…     # resonance status
npm run server                    # → http://127.0.0.1:8787
```

Then start the apps pointed at it:

```bash
VITE_SESSION_URL=http://127.0.0.1:8787/session npm run dev
```

Open any app, then **Runs on Resonance → Architecture**, and switch **Signed in as**. Each switch asks the server for that user's key.

| Setting | Default | |
|---|---|---|
| `RESONANCE_NODE_KEY` | — | your physical node's key; required |
| `RESONANCE_NODE_ID` | — | your physical node's id; required |
| `RESONANCE_API` | `https://net.narsill.io` | the network |
| `PORT` | `8787` | listens on 127.0.0.1 only |
| `MONTHLY_CAP` | `0` (none) | requests per user per month |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | which pages may call it |

## What it does

For `POST /session { app, user }`:

1. **First use of an app** — creates the app's cluster (`<app>-prod`) with your node's key and attaches your physical node to it, so the cluster can mint keys.
2. **First sign-in of a user** — creates their logical node in that cluster (`user:<name>`).
3. **Every sign-in** — returns that user's key, minted for 24 hours and cached until an hour before it expires.
4. **With `MONTHLY_CAP`** — compares the user's requests this month (the count now minus the count at the start of the month) with the cap; over it, it stops their logical node and answers `402`. The next month it starts it again.

`GET /usage` lists every user's requests and tokens; `POST /offboard { app, user }` deletes a user's logical node, and every key they had stops working.

What it creates is kept in `state.json` next to it, readable by your user only: the clusters' and logical nodes' ids and owner tokens. The owner tokens are capabilities — whoever holds one can manage that cluster or logical node — so treat the file like a secret. Delete it to start over (the clusters and logical nodes it created stay on the network until you delete them).

## Before using it for real

This is a teaching server. In your app:

- the user comes from **your sign-in** (a session cookie, a JWT) — never from the request body as here;
- the ids and owner tokens go in **your database**, next to each user;
- the endpoint that returns a key sits **behind your authentication**, and returns only the signed-in user's own key.

The calls themselves don't change. The [integration guide](../docs/integration-guide.md) walks through them one by one.
