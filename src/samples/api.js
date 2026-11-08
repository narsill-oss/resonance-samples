// A minimal Resonance client for the sample apps: the OpenAI-compatible HTTP API with plain
// fetch, no SDK. Every call is recorded (key redacted) so the samples can show the exact
// request they made, as curl and as JavaScript.
export const API = (import.meta.env.VITE_API_BASE || 'https://net.narsill.io').replace(/\/$/, '');

const KEY_STORE = 'rsn.samples.key';

// The developer's API key lives only in this browser (localStorage) and is sent only to the API.
export function loadKey() {
  try { return window.localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
}
export function saveKey(k) {
  try { if (k) window.localStorage.setItem(KEY_STORE, k); else window.localStorage.removeItem(KEY_STORE); } catch (e) { /* private mode */ }
}

// Every request the samples make, newest last (key never stored): the developer panel draws
// them on a timeline so you can see the network serving them side by side.
const listeners = new Set();
let log = [];
let seq = 0;
export function onRequests(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function requests() { return log; }
function emit() { listeners.forEach((fn) => fn(log)); }
// Images ride along as data URLs; the log keeps a short stand-in instead of the bytes.
function forLog(body) {
  const part = (p) => (p && p.type === 'image_url' && p.image_url && String(p.image_url.url).startsWith('data:')
    ? { ...p, image_url: { url: `${p.image_url.url.slice(0, 30)}…(${Math.round(p.image_url.url.length / 1365)} KB)` } } : p);
  return { ...body, messages: body.messages.map((m) => (Array.isArray(m.content) ? { ...m, content: m.content.map(part) } : m)) };
}
// Who the app is acting for (the Architecture tab's "signed in as"): each request is tagged
// with it, the way a real backend would send each user's own logical node key.
let seat = '';
export function setSeat(s) { seat = s || ''; }

function begin(path, body) {
  const r = { id: ++seq, url: `${API}${path}`, body: forLog(body), seat, start: performance.now(), end: null, status: 'running', error: '' };
  log = [...log.slice(-59), r];
  emit();
  return (status, error = '') => {
    log = log.map((x) => (x.id === r.id ? { ...x, end: performance.now(), status, error } : x));
    emit();
  };
}

// Catalogue tags of models that don't take chat messages (Laya decides, speech models transcribe).
const NOT_CHAT = new Set(['decision', 'speech']);

/// Chat-capable models on the network (public catalogue), as { id, tags }.
export async function listModels() {
  const r = await fetch(`${API}/v1/models`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`model list: HTTP ${r.status}`);
  const list = await r.json();
  return (Array.isArray(list) ? list : [])
    .filter((m) => m.model_id && !(m.tags || []).some((t) => NOT_CHAT.has(t)))
    .map((m) => ({ id: m.model_id, tags: m.tags || [] }));
}

function errorText(status, body) {
  try { const j = JSON.parse(body); return j.error || j.message || body; } catch (e) { return body || `HTTP ${status}`; }
}

/// One chat completion. With `onDelta` it streams (Server-Sent Events) and calls it with each
/// text piece; it always resolves with the full text.
export async function chat({ key, model, messages, tier = 'free', maxTokens = 600, temperature = 0.4, onDelta, signal }) {
  const body = { model, messages, max_tokens: maxTokens, temperature, tier, stream: Boolean(onDelta) };
  const done = begin('/v1/chat/completions', body);
  try {
    const out = await send(body, key, onDelta, signal);
    done('ok');
    return out;
  } catch (e) {
    done(e.name === 'AbortError' ? 'stopped' : 'error', e.message);
    throw e;
  }
}

// Answers worth retrying: the network is momentarily full (503, 429) or its edge dropped the
// connection (502, 504, or a fetch that never got a response). Anything else is final.
const RETRY = new Set([429, 502, 503, 504]);
const wait = (ms, signal) => new Promise((ok, fail) => {
  const t = setTimeout(ok, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); fail(new DOMException('stopped', 'AbortError')); }, { once: true });
});

/// POST with up to four tries and a growing pause (with jitter, so a burst of parallel calls
/// doesn't come back in lockstep). Only the response headers are awaited here, so a stream
/// that has started is never sent twice.
async function post(path, body, key, signal) {
  let last;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) await wait(600 * 2 ** (attempt - 1) + Math.random() * 400, signal);
    let r;
    try {
      r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      last = new Error('the network did not answer (connection dropped)');
      continue;
    }
    if (r.ok) return r;
    const text = await r.text();
    last = new Error(r.status === 502 || r.status === 503 ? `the network is busy right now (${r.status}) — try again in a moment` : errorText(r.status, text));
    if (!RETRY.has(r.status)) throw last;
  }
  throw last;
}

async function send(body, key, onDelta, signal) {
  const r = await post('/v1/chat/completions', body, key, signal);
  if (!onDelta) {
    const j = await r.json();
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let out = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return out;
      try {
        const piece = JSON.parse(data).choices?.[0]?.delta?.content;
        if (piece) { out += piece; onDelta(piece, out); }
      } catch (e) { /* keep-alive or partial line */ }
    }
  }
  return out;
}

/// Ask for a JSON object and parse it out of the reply (models sometimes wrap it in prose or
/// code fences). Throws when no JSON object can be found.
export async function chatJson(opts) {
  const text = await chat({ ...opts, temperature: opts.temperature ?? 0.2 });
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('the model did not return JSON');
  return JSON.parse(text.slice(start, end + 1));
}

/// Run `tasks` (functions returning promises) with at most `limit` in flight.
export async function pool(tasks, limit = 3) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      try { results[i] = { ok: true, value: await tasks[i]() }; } catch (e) { results[i] = { ok: false, error: e }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/// A request as a copy-pasteable curl command (the key stays a placeholder).
export function asCurl(req) {
  if (!req) return '';
  return `curl ${req.body.stream ? '-N ' : ''}${req.url} \\\n  -H "Authorization: Bearer $RESONANCE_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(req.body, null, 2).replace(/'/g, "'\\''")}'`;
}

/// The same request as JavaScript fetch.
export function asFetch(req) {
  if (!req) return '';
  return `const res = await fetch("${req.url}", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json",\n    Authorization: \`Bearer \${process.env.RESONANCE_API_KEY}\`,\n  },\n  body: JSON.stringify(${JSON.stringify(req.body, null, 2).replace(/\n/g, '\n  ')}),\n});`;
}
