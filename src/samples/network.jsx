import React, { useEffect, useMemo, useState } from 'react';
import { Link } from '../Link';
import { SITES } from '@shared/lib/sites';
import { asCurl, asFetch, listModels, loadKey, onRequests, requests, saveKey, setSeat } from './api';
import { ARCHS, REPO } from './archs';
import { Architecture } from './Architecture';
import './dev.css';

// Optional: a backend that mints each user's logical node key (see the samples repo, server/).
const SESSION_URL = import.meta.env.VITE_SESSION_URL || '';

/// The network connection a sample app runs on: the API key (kept in this browser), the
/// chat models in the catalogue (defaulting to one tagged `prefer`, e.g. "vision"), and the tier. Browser-only work happens in the effect, so the
/// app still prerenders.
export function useNetwork({ prefer } = {}) {
  const [key, setKeyState] = useState('');
  const [catalogue, setCatalogue] = useState([]);
  const [model, setModel] = useState('');
  const [tier, setTier] = useState('free');
  const [modelError, setModelError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [dev, openDev] = useState(null); // null | 'how' | 'arch' | 'requests' | 'connection'

  useEffect(() => {
    setKeyState(loadKey());
    setLoaded(true);
    listModels()
      .then((m) => {
        setCatalogue(m);
        const pick = (prefer && m.find((x) => x.tags.includes(prefer))) || m[0];
        setModel((cur) => cur || (pick ? pick.id : ''));
      })
      .catch((e) => setModelError(e.message));
  }, []);

  const setKey = (k) => { const v = (k || '').trim(); saveKey(v); setKeyState(v); };
  const models = catalogue.map((m) => m.id);
  const tagsOf = (id) => (catalogue.find((m) => m.id === id) || { tags: [] }).tags;
  return {
    key, setKey, models, tagsOf, model, setModel, tier, setTier, modelError, loaded, dev, openDev,
    ready: Boolean(key && model),
    call: { key, model, tier },
  };
}

/// Whether a media query matches — false on the server and on first paint, then live.
export function useMedia(query) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const set = () => setOn(m.matches);
    set();
    m.addEventListener('change', set);
    return () => m.removeEventListener('change', set);
  }, [query]);
  return on;
}

/// State kept in this browser across reloads (localStorage, per app), so a sample keeps its
/// work. Starts at `initial` on the server and on first paint, then loads what was saved;
/// `revive` cleans a saved value (e.g. drops requests that were still running).
export function useStored(name, initial, revive = (v) => v) {
  const [value, setValue] = useState(initial);
  // State, not a ref: the save below must not run in the same commit as the load, or it would
  // write the initial value over what was saved before the loaded value lands.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const s = window.localStorage.getItem(`rsn.sample.${name}`);
      if (s !== null) setValue(revive(JSON.parse(s)));
    } catch (e) { /* private mode or bad JSON: keep the initial value */ }
    setLoaded(true);
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem(`rsn.sample.${name}`, JSON.stringify(value)); } catch (e) { /* full or blocked */ }
  }, [name, value, loaded]);
  return [value, setValue];
}

/// Drop entries still marked pending when a page was closed mid-run.
export const settled = (m) => Object.fromEntries(Object.entries(m || {}).filter(([, v]) => v && !v.pending));

/// Read a file the user picked as text.
export const readText = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => fail(r.error); r.readAsText(file); });

/// Hand the browser a file to save.
export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/// Parse CSV text (comma, semicolon or tab; quoted fields) into rows of strings.
export function parseCsv(text) {
  const first = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : text.length);
  const delim = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 1; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(f); f = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else f += c;
  }
  row.push(f);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  rows.delim = delim; // ';' files usually write decimals with a comma
  return rows;
}

/// Rows of objects as CSV text, in the order of `cols`.
export function toCsv(cols, rows) {
  const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.map(esc).join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

/// The request log, live.
export function useRequests() {
  const [log, setLog] = useState([]);
  useEffect(() => { setLog(requests()); return onRequests(setLog); }, []);
  return log;
}

// Re-render on animation frames while something runs, so running bars grow.
function useNow(active) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    let raf = 0;
    const tick = () => { setNow(performance.now()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return active ? now : 0;
}

/// Wall-clock time covered by a set of [start, end] intervals.
function covered(spans) {
  const s = [...spans].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur = null;
  for (const [a, b] of s) {
    if (!cur || a > cur[1]) { if (cur) total += cur[1] - cur[0]; cur = [a, b]; } else cur[1] = Math.max(cur[1], b);
  }
  return cur ? total + cur[1] - cur[0] : 0;
}

const secs = (ms) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;

/// The developer view every sample carries, whatever its own design: a "Runs on Resonance"
/// badge that opens how the app uses the network, a live timeline of its requests (with the
/// exact curl/fetch of each) and the connection settings.
export function DevPanel({ net, app, how, slug }) {
  const log = useRequests();
  const arch = ARCHS[slug];
  // Who the app acts for: kept per app, applied to every call even while the panel is closed.
  const [seat, setSeatIdx] = useStored(`arch.${slug}.seat`, 0);
  useEffect(() => {
    if (!arch) return;
    const who = arch.seats[seat] || arch.seats[0];
    setSeat(who);
    // With a session server (the samples repo's server/), "signed in as" is real: the server
    // returns that user's own logical node key, and every call carries it.
    if (SESSION_URL) {
      fetch(SESSION_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app: slug, user: who }) })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`session server: HTTP ${r.status}`))))
        .then((j) => { if (j.apiKey) net.setKey(j.apiKey); })
        .catch(() => { /* keep the key that is set */ });
    }
  }, [arch, seat]); // eslint-disable-line react-hooks/exhaustive-deps
  const running = log.some((r) => r.status === 'running');
  const now = useNow(running && net.dev === 'requests');
  const [pick, setPick] = useState(null);
  const [tab, setTab] = useState('curl');
  const [draft, setDraft] = useState('');
  useEffect(() => { if (net.dev === 'connection') setDraft(net.key); }, [net.dev, net.key]);

  const view = log.slice(-24);
  const stats = useMemo(() => {
    const done = view.filter((r) => r.end);
    if (!done.length) return null;
    const spans = done.map((r) => [r.start, r.end]);
    const sum = spans.reduce((a, [s, e]) => a + e - s, 0);
    const wall = covered(spans);
    let peak = 0;
    for (const r of done) peak = Math.max(peak, done.filter((o) => o.start <= r.start && o.end > r.start).length);
    return { n: done.length, sum, wall, peak, gain: wall ? sum / wall : 1 };
  }, [view]);
  const t0 = view.length ? Math.min(...view.map((r) => r.start)) : 0;
  const t1 = view.length ? Math.max(...view.map((r) => r.end || now || r.start), t0 + 1) : 1;
  const sel = log.find((r) => r.id === pick) || view[view.length - 1];

  if (!net.dev) {
    return (
      <button type="button" className="dvp-badge" onClick={() => net.openDev(net.key ? 'requests' : 'connection')} aria-label="Open the developer view">
        <span className="dvp-dot" data-on={running ? '1' : '0'} />
        <span className="dvp-badge-t">{'Runs on Resonance'}</span>
        {log.length > 0 && <span className="dvp-count">{log.length}</span>}
      </button>
    );
  }

  return (
    <aside className="dvp" aria-label="Developer view">
      <header className="dvp-h">
        <div>
          <span className="dvp-k">{'Developer view'}</span>
          <b>{app}</b>
        </div>
        <button type="button" className="dvp-x" onClick={() => net.openDev(null)} aria-label="Close">{'×'}</button>
      </header>
      <nav className="dvp-tabs">
        {[['how', 'How it works'], ...(arch ? [['arch', 'Architecture']] : []), ['requests', 'Requests'], ['connection', 'Connection']].map(([id, label]) => (
          <button type="button" key={id} className={net.dev === id ? 'on' : ''} onClick={() => net.openDev(id)}>{label}</button>
        ))}
      </nav>

      <div className="dvp-body">
        {net.dev === 'how' && <div className="dvp-how">{how}</div>}
        {net.dev === 'arch' && arch && <Architecture a={arch} slug={slug} seat={seat} setSeat={setSeatIdx} log={log} model={net.model} />}

        {net.dev === 'requests' && (
          <>
            {stats ? (
              <div className="dvp-stats">
                <div><b>{stats.n}</b><span>{'requests'}</span></div>
                <div><b>{stats.peak}</b><span>{'at once (peak)'}</span></div>
                <div><b>{secs(stats.wall)}</b><span>{`wall time · ${secs(stats.sum)} one by one`}</span></div>
                <div className="acc"><b>{`${stats.gain.toFixed(1)}×`}</b><span>{'from running in parallel'}</span></div>
              </div>
            ) : <p className="dvp-dim">{'Use the app: every call it makes to the network shows up here, on a shared timeline.'}</p>}
            <ol className="dvp-tl">
              {view.map((r) => {
                const end = r.end || now || r.start;
                const left = ((r.start - t0) / (t1 - t0)) * 100;
                const width = Math.max(((end - r.start) / (t1 - t0)) * 100, 0.8);
                return (
                  <li key={r.id}>
                    <button type="button" className={sel && sel.id === r.id ? 'on' : ''} onClick={() => setPick(r.id)} title={r.error || undefined}>
                      <span className="dvp-tl-l" title={r.seat || undefined}>{`#${r.id} ${r.body.stream ? 'stream' : 'json'}`}</span>
                      <span className="dvp-tl-track"><span className={`dvp-tl-bar s-${r.status}`} style={{ left: `${left}%`, width: `${width}%` }} /></span>
                      <span className="dvp-tl-t">{r.end ? secs(r.end - r.start) : '…'}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {sel && (
              <>
                <div className="dvp-codetabs">
                  <button type="button" className={tab === 'curl' ? 'on' : ''} onClick={() => setTab('curl')}>{'curl'}</button>
                  <button type="button" className={tab === 'js' ? 'on' : ''} onClick={() => setTab('js')}>{'JavaScript'}</button>
                  <span className="dvp-dim">{`#${sel.id}${sel.error ? ` · ${sel.error}` : ''}`}</span>
                </div>
                <pre className="dvp-code">{tab === 'curl' ? asCurl(sel) : asFetch(sel)}</pre>
              </>
            )}
          </>
        )}

        {net.dev === 'connection' && (
          <form className="dvp-conn" onSubmit={(e) => { e.preventDefault(); net.setKey(draft); if (draft.trim()) net.openDev('requests'); }}>
            <label>
              <span>{'API key'}</span>
              <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="rk_… or rk_s_…" autoComplete="off" />
            </label>
            <p className="dvp-dim">
              {'Your node key ('}<code>{'resonance api-key'}</code>{') or a logical node key. It stays in this browser and is sent only to the Resonance API. '}
              <a href={`${SITES.docs}#start-keys`}>{'How keys work'}</a>
            </p>
            <div className="dvp-row">
              <button type="submit" className="dvp-btn acc">{'Save key'}</button>
              {net.key && <button type="button" className="dvp-btn" onClick={() => { net.setKey(''); setDraft(''); }}>{'Forget'}</button>}
            </div>
            <label>
              <span>{'Model'}</span>
              <select value={net.model} onChange={(e) => net.setModel(e.target.value)} disabled={!net.models.length}>
                {net.models.length ? net.models.map((m) => <option key={m} value={m}>{m}</option>) : <option>{net.modelError ? 'unavailable' : 'loading…'}</option>}
              </select>
            </label>
            <label>
              <span>{'Tier'}</span>
              <select value={net.tier} onChange={(e) => net.setTier(e.target.value)}>
                <option value="free">{'free — the open network'}</option>
                <option value="auto">{'auto — paid when your wallet covers it'}</option>
                <option value="paid">{'paid — verified paid nodes'}</option>
              </select>
            </label>
          </form>
        )}
      </div>

      <footer className="dvp-f">
        <Link to="/samples">{'← All samples'}</Link>
        <a href={slug ? `${REPO}/tree/main/apps/${slug}` : REPO} target="_blank" rel="noreferrer">{'Source on GitHub'}</a>
        <a href={`${SITES.docs}#start-what`}>{'Docs'}</a>
      </footer>
    </aside>
  );
}
