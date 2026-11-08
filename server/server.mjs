// The session server: the one backend piece an app needs to put every user on the Resonance
// network as a logical node with their own key. No dependencies — Node 18 or newer.
//
//   RESONANCE_NODE_KEY=rk_… RESONANCE_NODE_ID=rn_… node server/server.mjs
//
// What it does, all through the public control-plane API:
//   - the first time an app is used, it creates that app's cluster ("<app>-prod") and attaches
//     your physical node to it, so the cluster can mint keys;
//   - the first time a user signs in to an app, it creates their logical node in that cluster;
//   - on every sign-in, it returns that user's key: a cluster-scoped token, valid 24 hours,
//     cached here until an hour before it expires;
//   - it reports per-user usage, enforces a monthly cap by stopping the logical node, and
//     deletes a user's logical node on offboarding (every key they had stops working).
//
// The owner tokens it receives are capabilities: whoever holds one can manage that cluster or
// logical node. They stay in state.json on this machine and are never sent to a browser.
// Replace the "who is signed in" part with your own authentication before using it for real.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const API = (process.env.RESONANCE_API || 'https://net.narsill.io').replace(/\/$/, '');
const NODE_KEY = process.env.RESONANCE_NODE_KEY || '';
const NODE_ID = process.env.RESONANCE_NODE_ID || '';
const PORT = Number(process.env.PORT || 8787);
const CAP = Number(process.env.MONTHLY_CAP || 0); // requests per user; 0 = no cap
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',');
const STATE = path.join(DIR, 'state.json');

if (!NODE_KEY || !NODE_ID) {
  console.error('Set RESONANCE_NODE_KEY (`resonance api-key`) and RESONANCE_NODE_ID (`resonance status`).');
  process.exit(1);
}

// { apps: { [app]: { clusterId, ownerToken } }, users: { ["app/user"]: { lnId, ownerToken, key?, exp? } } }
let state = { apps: {}, users: {} };
try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { /* first run */ }
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 });

async function cp(method, p, { body, headers = {} } = {}) {
  const r = await fetch(API + p, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw Object.assign(new Error(`${method} ${p} → ${r.status} ${text.slice(0, 200)}`), { status: r.status });
  return text ? JSON.parse(text) : {};
}

// One cluster per app, backed by your physical node.
async function clusterFor(app) {
  if (state.apps[app]) return state.apps[app];
  const c = await cp('POST', '/v1/clusters', { body: { label: `${app}-prod` }, headers: { authorization: `Bearer ${NODE_KEY}` } });
  await cp('POST', `/v1/clusters/${c.id}/nodes`, { body: { nodeId: NODE_ID }, headers: { authorization: `Bearer ${NODE_KEY}`, 'x-resonance-owner': c.ownerToken } });
  state.apps[app] = { clusterId: c.id, ownerToken: c.ownerToken };
  save();
  console.log(`created cluster ${c.id} for ${app}`);
  return state.apps[app];
}

// One logical node per user of an app.
async function logicalNodeFor(app, user) {
  const id = `${app}/${user}`;
  if (state.users[id]) return state.users[id];
  const c = await clusterFor(app);
  const ln = await cp('POST', '/v1/logical-nodes', { body: { clusterId: c.clusterId, label: `user:${user}` }, headers: { 'x-resonance-owner': c.ownerToken } });
  state.users[id] = { lnId: ln.id, ownerToken: ln.ownerToken };
  save();
  console.log(`created logical node ${ln.id} for ${id}`);
  return state.users[id];
}

// Today's key for a user: cached until an hour before it expires.
async function keyFor(app, user) {
  const u = await logicalNodeFor(app, user);
  if (u.key && u.exp - Date.now() > 3600_000) return u;
  if (CAP) {
    // The network counts a logical node's requests since it was created; this month's share is
    // the count now minus the count when the month began (recorded here).
    const use = await cp('GET', `/v1/logical-nodes/${u.lnId}/usage`);
    const month = new Date().toISOString().slice(0, 7);
    if (!u.base || u.base.month !== month) { u.base = { month, requests: use.requests || 0 }; save(); }
    const used = (use.requests || 0) - u.base.requests;
    if (used >= CAP) {
      if (!u.stopped) { await cp('POST', `/v1/logical-nodes/${u.lnId}/stop`, { body: {}, headers: { 'x-resonance-owner': u.ownerToken } }); u.stopped = true; save(); }
      throw Object.assign(new Error(`${user} has used ${used} of ${CAP} requests this month`), { status: 402 });
    }
    // A new month: a user stopped for going over budget is started again.
    if (u.stopped) { await cp('POST', `/v1/logical-nodes/${u.lnId}/start`, { body: {}, headers: { 'x-resonance-owner': u.ownerToken } }); u.stopped = false; save(); }
  }
  const { apiKey } = await cp('GET', `/v1/logical-nodes/${u.lnId}/api-key`, { headers: { 'x-resonance-owner': u.ownerToken } });
  if (!apiKey) throw new Error('the cluster has no physical node to back its keys — is your node online?');
  // rk_s_<logical node>.<cluster>.<expiry ms>.<signature>
  u.key = apiKey;
  u.exp = Number(apiKey.split('.')[2]) || Date.now() + 23 * 3600_000;
  save();
  return u;
}

const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });
const clean = (s) => String(s || '').trim().slice(0, 80).replace(/[^\p{L}\p{N} ._·-]/gu, '');

http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (ORIGINS.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  try {
    const url = new URL(req.url, 'http://x');
    // POST /session { app, user } → that user's key. In a real app the user comes from your
    // own sign-in (a session cookie, a JWT), never from the request body.
    if (req.method === 'POST' && url.pathname === '/session') {
      const { app, user } = await readBody(req);
      const a = clean(app); const who = clean(user);
      if (!a || !who) return send(400, { error: 'app and user are required' });
      const u = await keyFor(a, who);
      return send(200, { apiKey: u.key, expiresAt: new Date(u.exp).toISOString(), logicalNode: u.lnId });
    }
    // GET /usage → requests and tokens per user, for budgets and billing.
    if (req.method === 'GET' && url.pathname === '/usage') {
      const rows = await Promise.all(Object.entries(state.users).map(async ([id, u]) => ({ user: id, logicalNode: u.lnId, ...(await cp('GET', `/v1/logical-nodes/${u.lnId}/usage`).catch((e) => ({ error: e.message }))) })));
      return send(200, rows);
    }
    // POST /offboard { app, user } → delete the logical node: every key it had stops working.
    if (req.method === 'POST' && url.pathname === '/offboard') {
      const { app, user } = await readBody(req);
      const id = `${clean(app)}/${clean(user)}`;
      const u = state.users[id];
      if (!u) return send(404, { error: 'no such user' });
      await cp('DELETE', `/v1/logical-nodes/${u.lnId}`, { headers: { 'x-resonance-owner': u.ownerToken } });
      delete state.users[id];
      save();
      return send(200, { deleted: u.lnId });
    }
    send(404, { error: 'POST /session, GET /usage, POST /offboard' });
  } catch (e) {
    send(e.status === 402 ? 402 : 502, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`session server on http://127.0.0.1:${PORT} → ${API}`));
