import React, { useMemo, useState } from 'react';
import { REPO } from './archs';

// The developer panel's Architecture tab: how this app sits on the network — its users as
// logical nodes with their own short-lived keys, the backend that mints them, the cluster and
// the physical node behind it, and the nodes that serve each call — drawn live (the "signed in
// as" user is highlighted, running calls light up network nodes), with per-user usage from
// this session and the code for each step.

const W = 424;
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function Diagram({ a, seat, running }) {
  const xs = [0, 148, 296];
  const lit = Math.min(8, running);
  return (
    <svg className="arc-svg" viewBox={`0 0 ${W} 302`} role="img" aria-label={`${a.app} on the Resonance network`}>
      <defs>
        <marker id="arc-h" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#8A8A8A" /></marker>
        <marker id="arc-ha" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#FF4A1C" /></marker>
      </defs>
      <text x="0" y="11" className="arc-cap">{`YOUR USERS — ONE LOGICAL NODE EACH (${a.user.toUpperCase()})`}</text>
      {a.seats.map((s, i) => (
        <g key={s} className={i === seat ? 'arc-on' : ''}>
          <rect x={xs[i]} y="20" width="128" height="46" className="arc-box" />
          <text x={xs[i] + 8} y="38" className="arc-t">{short(s, 19)}</text>
          <text x={xs[i] + 8} y="56" className="arc-m">{`ln_${a.cluster.slice(0, 3)}${i + 1}… · key 24 h`}</text>
          <path d={`M${xs[i] + 64} 66 V82`} className="arc-l" />
        </g>
      ))}
      <path d="M64 82 H360" className="arc-l" />
      <path d="M98 82 V116" className="arc-l dash" markerEnd="url(#arc-h)" />
      <text x="104" y="102" className="arc-m">{'① sign in → today\'s key'}</text>
      <path d="M326 82 V116" className={`arc-l ${running ? 'acc' : ''}`} markerEnd={running ? 'url(#arc-ha)' : 'url(#arc-h)'} />
      <text x="320" y="102" className="arc-m" textAnchor="end">{'② calls with own key'}</text>

      <rect x="0" y="118" width="196" height="56" className="arc-box" />
      <text x="8" y="136" className="arc-t">{short(a.backend, 24)}</text>
      <text x="8" y="152" className="arc-m">{'holds the cluster owner token'}</text>
      <text x="8" y="166" className="arc-m">{'mints each user\'s 24 h key'}</text>

      <rect x="228" y="118" width="196" height="56" className="arc-box acc" />
      <text x="236" y="136" className="arc-t">{'Resonance control plane'}</text>
      <text x="236" y="152" className="arc-m">{'checks the key · picks a node'}</text>
      <text x="236" y="166" className="arc-m">{'meters each call to its user'}</text>

      <path d="M98 174 V208" className="arc-l dot" />
      <text x="104" y="194" className="arc-m">{'owns'}</text>
      <path d="M326 174 V208" className={`arc-l ${running ? 'acc' : ''}`} markerEnd={running ? 'url(#arc-ha)' : 'url(#arc-h)'} />
      <text x="332" y="194" className="arc-m">{'③ schedule'}</text>
      <path d="M196 248 C214 248 214 190 240 176" className="arc-l dot" />

      <rect x="0" y="210" width="196" height="88" className="arc-box" />
      <text x="8" y="228" className="arc-t">{`Cluster ${a.cluster}-prod`}</text>
      <rect x="8" y="238" width="10" height="10" className="arc-phys" />
      <text x="24" y="247" className="arc-m">{'physical node · your machine'}</text>
      <text x="24" y="260" className="arc-m">{'backs the cluster\'s keys'}</text>
      {a.seats.map((s, i) => <circle key={s} cx={13 + i * 14} cy="281" r="5" className={i === seat ? 'arc-ln on' : 'arc-ln'} />)}
      <text x="56" y="285" className="arc-m">{'1 logical node per user'}</text>

      <rect x="228" y="210" width="196" height="88" className="arc-box" />
      <text x="236" y="228" className="arc-t">{'Network nodes'}</text>
      {Array.from({ length: 8 }, (_, i) => <rect key={i} x={236 + (i % 4) * 22} y={238 + Math.floor(i / 4) * 20} width="16" height="14" className={i < lit ? 'arc-node on' : 'arc-node'} />)}
      <text x="330" y="249" className="arc-m">{running ? `${running} running` : 'idle'}</text>
      <text x="236" y="280" className="arc-m">{'any capable node runs it;'}</text>
      <text x="236" y="292" className="arc-m">{'paid tier: verified only'}</text>
    </svg>
  );
}

function snippets(a, seatName, model) {
  const label = a.user.replace(/\s+/g, '-');
  const msg = (s) => JSON.stringify(s);
  return {
    once: `// Once, on your backend — with your node's key (\`resonance api-key\`). Never in a browser.
const API = "https://net.narsill.io";
const NODE_KEY = process.env.RESONANCE_NODE_KEY;   // rk_…
const NODE_ID  = process.env.RESONANCE_NODE_ID;    // rn_…  (\`resonance status\`)

// 1. A cluster for ${a.app}: it groups the app's users and inherits your node's key.
const cluster = await post("/v1/clusters", { label: "${a.cluster}-prod" },
  { Authorization: \`Bearer \${NODE_KEY}\` });
// → { id: "cl_…", ownerToken: "ot_…" }   keep ownerToken as a server secret

// 2. Attach your physical node. A cluster with no physical node can't mint working keys.
await post(\`/v1/clusters/\${cluster.id}/nodes\`, { nodeId: NODE_ID },
  { Authorization: \`Bearer \${NODE_KEY}\`, "x-resonance-owner": cluster.ownerToken });

async function post(path, body, headers = {}) {
  const r = await fetch(API + path, { method: "POST",
    headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(\`\${path}: \${r.status} \${await r.text()}\`);
  return r.json();
}`,
    user: `// When a ${a.user} signs up: one logical node each, in ${a.app}'s cluster.
const ln = await post("/v1/logical-nodes",
  { clusterId: CLUSTER_ID, label: \`${label}:\${user.id}\` },
  { "x-resonance-owner": CLUSTER_OWNER_TOKEN });
// → { id: "ln_…", ownerToken: "ot_…" }   store both on the user's record

// Each session: a fresh key for that ${a.user} only, valid 24 hours.
const r = await fetch(\`\${API}/v1/logical-nodes/\${user.lnId}/api-key\`,
  { headers: { "x-resonance-owner": user.lnOwnerToken } });
const { apiKey } = await r.json();
// → "rk_s_ln_….cl_….<expiry>.<signature>"   send it to the signed-in browser only`,
    call: `// In the browser, signed in as ${seatName}: their own key, straight to the network.
const res = await fetch("https://net.narsill.io/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json", Authorization: \`Bearer \${userKey}\` },
  body: JSON.stringify({
    model: ${msg(model || 'GLM-4.7-Flash')},
    messages: [
      { role: "system", content: ${msg(a.example.system)} },
      { role: "user", content: ${msg(a.example.user)} },
    ],
    max_tokens: 400,
  }),
});
// 503 = every capable node is busy for longer than the network waits: retry with backoff.
const { choices } = await res.json();`,
    usage: `// Per-${a.user} usage, for budgets and billing.
const u = await (await fetch(\`\${API}/v1/logical-nodes/\${user.lnId}/usage\`)).json();
// → { requests, tokens }

// Over budget: stop the logical node — its keys are refused until you start it again.
if (u.requests > MONTHLY_CAP)
  await post(\`/v1/logical-nodes/\${user.lnId}/stop\`, {}, { "x-resonance-owner": user.lnOwnerToken });

// Offboarding: delete it — every key it was ever given stops working at once.
await fetch(\`\${API}/v1/logical-nodes/\${user.lnId}\`,
  { method: "DELETE", headers: { "x-resonance-owner": user.lnOwnerToken } });`,
  };
}

export function Architecture({ a, slug, seat, setSeat, log, model }) {
  const [tab, setTab] = useState('once');
  const running = log.filter((r) => r.status === 'running').length;
  const usage = useMemo(() => a.seats.map((s) => {
    const mine = log.filter((r) => r.seat === s);
    const done = mine.filter((r) => r.end);
    return { s, n: mine.length, err: mine.filter((r) => r.status === 'error').length, ms: done.reduce((t, r) => t + r.end - r.start, 0) };
  }), [a, log]);
  const code = snippets(a, a.seats[seat], model);
  return (
    <div className="arc">
      <p className="arc-why">{a.why}</p>
      <label className="arc-seat">
        <span>{'Signed in as'}</span>
        <select value={seat} onChange={(e) => setSeat(Number(e.target.value))}>
          {a.seats.map((s, i) => <option key={s} value={i}>{s}</option>)}
        </select>
      </label>
      <p className="dvp-dim">{`Every call the app makes now is tagged as ${a.seats[seat]}'s — in production it would carry their own logical node key.`}</p>
      <Diagram a={a} seat={seat} running={running} />

      <h4>{'This session, per user'}</h4>
      <table className="arc-use">
        <thead><tr><th>{a.user}</th><th>{'calls'}</th><th>{'errors'}</th><th>{'on the network'}</th></tr></thead>
        <tbody>
          {usage.map((u, i) => (
            <tr key={u.s} className={i === seat ? 'on' : ''}>
              <td>{u.s}</td><td>{u.n}</td><td>{u.err || '—'}</td><td>{u.ms ? `${(u.ms / 1000).toFixed(1)} s` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>{'The calls it makes'}</h4>
      <ul className="arc-calls">{a.calls.map(([n, d]) => <li key={n}><b>{n}</b><span>{d}</span></li>)}</ul>
      <p className="arc-tip">{a.budget}</p>

      <h4>{'The code, step by step'}</h4>
      <div className="dvp-codetabs">
        {[['once', '1 · set up'], ['user', '2 · per user'], ['call', '3 · call'], ['usage', '4 · usage']].map(([id, l]) => (
          <button type="button" key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>
        ))}
      </div>
      <pre className="dvp-code">{code[tab]}</pre>
      <p className="arc-repo">
        {'The full source of '}{a.app}{', with this architecture documented end to end: '}
        <a href={`${REPO}/tree/main/apps/${slug}`} target="_blank" rel="noreferrer">{`resonance-samples/apps/${slug}`}</a>
      </p>
    </div>
  );
}
