import React, { useMemo, useState } from 'react';
import { useSeo } from '@shared/lib/useSeo';
import { chatJson, pool } from './api';
import { DevPanel, download, readText, settled, useMedia, useNetwork, useStored } from './network';
import { ParlanceLogo } from './logos';
import './parlance.css';

// Parlance — a localization studio. One request per language translates every string at once;
// one request per language then back-translates and reviews them; placeholders, length limits,
// glossary terms and emoji are checked in plain code. Strings, languages and results are kept in
// this browser; import your own en.json to localize your app.
const SAMPLE = [
  { key: 'home.welcome', type: 'title', source: 'Welcome back, {name}!', context: 'Home screen title after sign-in', max: 28 },
  { key: 'onboarding.cta', type: 'button', source: 'Get started', context: 'Primary button on the first screen', max: 16 },
  { key: 'billing.trial', type: 'label', source: 'Your trial ends in {count} days', context: 'Banner at the top of settings', max: 40 },
  { key: 'billing.upgrade', type: 'button', source: 'Upgrade to Pro', context: 'Button; "Pro" is the plan name', max: 18 },
  { key: 'errors.network', type: 'toast', source: 'We couldn\'t reach the server. Check your connection and try again.', context: 'Error toast, 2 lines max', max: 80 },
  { key: 'share.invite', type: 'label', source: '{name} invited you to {project}', context: 'Notification row', max: 48 },
  { key: 'settings.dark', type: 'label', source: 'Dark mode', context: 'Settings switch label', max: 16 },
  { key: 'settings.mentions', type: 'label', source: 'Email me when someone mentions me', context: 'Settings switch label', max: 44 },
  { key: 'cart.empty', type: 'body', source: 'Your cart is empty — let\'s fix that.', context: 'Playful empty state', max: 40 },
  { key: 'a11y.close', type: 'button', source: 'Close dialog', context: 'Screen-reader label of the × button', max: 20 },
  { key: 'legal.delete', type: 'body', source: 'Deleting your account is permanent and can\'t be undone.', context: 'Confirmation dialog body', max: 70 },
  { key: 'push.streak', type: 'toast', source: '🔥 {count}-day streak! Keep it going.', context: 'Push notification; keep the emoji', max: 36 },
];
const BUILTIN_LANGS = [['it', 'Italian'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['pt-BR', 'Portuguese (Brazil)'], ['ja', 'Japanese'], ['pl', 'Polish'], ['nl', 'Dutch']];
const DEFAULT_PROJECT = { name: 'Wavelet', glossary: ['Wavelet', 'Pro'] };
// Values the previews put in place of placeholders, so a string reads the way users will see it.
const SAMPLE_VALUES = { name: 'Ada', project: 'Roadmap Q3', count: '3', amount: '€12', date: '14 May', email: 'ada@example.com' };

const translateSys = (lang, tone, project) => `You are a professional software localizer into ${lang}. Translate every UI string of the "${project.name}" app. Keep placeholders like {name} exactly as they are — they are filled in by the app at runtime. Keep these terms untranslated: ${project.glossary.join(', ') || 'none'}. Stay within each string's max length in characters. Tone: ${tone === 'formal' ? 'formal — use the formal form of address' : 'friendly and casual — use the informal form of address'}. Keep emoji. Reply ONLY with a JSON object mapping each key to its translation.`;
const reviewSys = (lang) => `You review UI translations from English into ${lang}. For each key, back-translate it to English and list real problems only (meaning drift, wrong formality, unnatural phrasing, untranslated words). Placeholders in braces are variables — never flag them. Reply ONLY with JSON: {<key>: {"back": <English back-translation>, "score": <1-5>, "issues": [<short strings>]}}.`;

const HOW = (
  <>
    <p>{'Localization fans out naturally — by language:'}</p>
    <ol>
      <li><b>{'Translate'}</b>{' — one request per language carrying every string (with context and length limits), all languages at once. JSON in, JSON out.'}</li>
      <li><b>{'Review'}</b>{' — another request per language, also side by side: each back-translates its language and scores every string.'}</li>
      <li><b>{'Glossary'}</b>{' — one call reads every source string and proposes the terms that must stay untranslated; code keeps only terms that really appear in your strings.'}</li>
      <li><b>{'Check'}</b>{' — plain code verifies what must never be left to a model: placeholders, length limits, glossary terms, emoji.'}</li>
      <li><b>{'Fix'}</b>{' — retranslate one cell with a note ("shorter", "less formal"), or edit it by hand; the checks rerun instantly.'}</li>
    </ol>
    <h4>{'Your own app'}</h4>
    <p>{'Strings → Import en.json takes a flat or nested i18n file. Add any language, set your glossary, then export one JSON per language. Everything stays in this browser.'}</p>
    <h4>{'Make it yours'}</h4>
    <p>{'Run the same calls in CI on every new string, fail the build on red cells, and open a PR with the rest. 16 requests for 8 languages take about as long as 2.'}</p>
  </>
);

const HOLDER = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/g;
const EMOJI = /\p{Extended_Pictographic}/gu;
const holders = (s) => (String(s).match(HOLDER) || []).sort().join(',');
const fill = (s) => String(s || '').replace(HOLDER, (m) => SAMPLE_VALUES[m.slice(1, -1)] || m.slice(1, -1));
const chars = (s) => [...fill(s)].length;

/// The checks code can be certain about, plus the reviewer's score.
function verdict(str, text, qa, glossary) {
  const issues = [];
  let level = 'ok';
  const t = String(text || '');
  if (!t.trim()) return { level: 'bad', issues: ['Missing translation'] };
  if (holders(t) !== holders(str.source)) { issues.push(`Placeholders differ: expected ${holders(str.source) || 'none'}`); level = 'bad'; }
  const len = chars(t);
  if (len > str.max) { issues.push(`${len}/${str.max} characters — too long for its slot`); if (level === 'ok') level = 'warn'; }
  glossary.filter((g) => g && str.source.includes(g) && !t.includes(g)).forEach((g) => { issues.push(`"${g}" must stay untranslated`); level = 'bad'; });
  const lost = (str.source.match(EMOJI) || []).filter((e) => !t.includes(e));
  if (lost.length) { issues.push(`Emoji dropped: ${lost.join(' ')}`); if (level === 'ok') level = 'warn'; }
  if (qa) {
    (qa.issues || []).forEach((x) => issues.push(String(x)));
    if ((Number(qa.score) <= 3 || (qa.issues || []).length) && level === 'ok') level = 'warn';
  }
  return { level, issues };
}

/// A UI string with its placeholders drawn as chips: either the sample value the app would
/// put there ("Ada"), or the placeholder's name.
function Text({ s, values }) {
  const parts = String(s || '').split(/(\{[a-zA-Z_][a-zA-Z0-9_]*\})/);
  return parts.map((p, i) => {
    if (!/^\{[a-zA-Z_][a-zA-Z0-9_]*\}$/.test(p)) return p;
    const name = p.slice(1, -1);
    return <span key={i} className={`pl-ph${values ? ' v' : ''}`} title={`Placeholder {${name}} — filled in by the app${values ? `; shown with a sample value` : ''}`}>{values ? (SAMPLE_VALUES[name] || name) : name}</span>;
  });
}

/// Flatten a nested i18n object ({ home: { title: "…" } }) into dotted keys.
function flatten(obj, pre = '', out = {}) {
  Object.entries(obj || {}).forEach(([k, v]) => {
    const key = pre ? `${pre}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else if (typeof v === 'string') out[key] = v;
  });
  return out;
}

export default function Localize() {
  useSeo({ title: 'Parlance localization · a Resonance sample', description: 'Translate an app into many languages at once on the Resonance network, review every string by back-translation, and check placeholders and lengths in code. Bring your own en.json.', path: '/samples/localize' });
  const net = useNetwork({ prefer: 'text-generation' });
  const phone = useMedia('(max-width: 820px)');
  const [strings, setStrings] = useStored('parlance.strings', SAMPLE);
  const [project, setProject] = useStored('parlance.project', DEFAULT_PROJECT);
  const [extra, setExtra] = useStored('parlance.extraLangs', []); // [[code, name]]
  const [langs, setLangs] = useStored('parlance.langs', BUILTIN_LANGS.map(([c]) => c));
  const [tone, setTone] = useStored('parlance.tone', 'friendly');
  const [tr, setTr] = useStored('parlance.tr', {}, settled); // lang -> { pending } | { map } | { error }
  const [qa, setQa] = useStored('parlance.qa', {}, settled);
  const [edits, setEdits] = useStored('parlance.edits', {}); // `${lang}|${key}` -> text
  const [values, setValues] = useState(true);
  const [sel, setSel] = useState(null); // { lang, key }
  const [tab, setTab] = useState('it');
  const [panel, setPanel] = useState(null); // 'strings' | 'langs'
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');

  const ALL = [...BUILTIN_LANGS, ...extra];
  const nameOf = (code) => (ALL.find(([c]) => c === code) || [code, code])[1];
  const active = langs.filter((l) => ALL.some(([c]) => c === l));

  const text = (lang, key) => (edits[`${lang}|${key}`] ?? (tr[lang] && tr[lang].map ? tr[lang].map[key] : undefined));
  const cell = (lang, str) => {
    const t = text(lang, str.key);
    if (t === undefined) return { level: tr[lang] && tr[lang].pending ? 'pending' : tr[lang] && tr[lang].error ? 'failed' : 'empty', issues: [] };
    // An edited cell no longer matches what the reviewer read: drop its notes, keep the code checks.
    const edited = edits[`${lang}|${str.key}`] !== undefined;
    return { ...verdict(str, t, edited ? null : qa[lang] && qa[lang].map && qa[lang].map[str.key], project.glossary), text: t, edited };
  };

  const translateLang = async (code) => {
    setTr((s) => ({ ...s, [code]: { pending: true } }));
    try {
      const map = await chatJson({ ...net.call, maxTokens: Math.min(4000, 300 + strings.length * 90), temperature: 0.2, messages: [{ role: 'system', content: translateSys(nameOf(code), tone, project) }, { role: 'user', content: JSON.stringify(strings.map(({ key, source, context, max }) => ({ key, source, context, max }))) }] });
      setTr((s) => ({ ...s, [code]: { map } }));
      setEdits((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith(`${code}|`))));
      return map;
    } catch (e) { setTr((s) => ({ ...s, [code]: { error: e.message } })); throw e; }
  };
  const reviewLang = async (code, map) => {
    setQa((s) => ({ ...s, [code]: { pending: true } }));
    try {
      const r = await chatJson({ ...net.call, maxTokens: Math.min(5000, 300 + strings.length * 130), temperature: 0.1, messages: [{ role: 'system', content: reviewSys(nameOf(code)) }, { role: 'user', content: JSON.stringify(strings.map(({ key, source }) => ({ key, source, translation: map[key] || '' }))) }] });
      setQa((s) => ({ ...s, [code]: { map: r } }));
    } catch (e) { setQa((s) => ({ ...s, [code]: { error: e.message } })); throw e; }
  };
  const run = async (codes) => {
    setError(''); setPhase('translate');
    setQa((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !codes.includes(k))));
    const res = await pool(codes.map((c) => () => translateLang(c)), 8);
    const ok = codes.map((c, i) => [c, res[i]]).filter(([, r]) => r.ok);
    setPhase('review');
    const rev = await pool(ok.map(([c, r]) => () => reviewLang(c, r.value)), 8);
    const bad = [...res, ...rev].filter((r) => !r.ok);
    if (bad.length) setError(`${bad.length} request(s) failed: ${bad[0].error.message}`);
    setPhase('');
  };
  const failed = active.filter((l) => (tr[l] && tr[l].error) || (qa[l] && qa[l].error));

  const stats = useMemo(() => {
    const s = { ok: 0, warn: 0, bad: 0 };
    active.forEach((l) => strings.forEach((str) => { const c = cell(l, str); if (s[c.level] !== undefined) s[c.level] += 1; }));
    return s;
  }, [active, strings, tr, qa, edits, project]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = active.filter((l) => tr[l] && tr[l].map).length;
  const pendingN = active.filter((l) => tr[l] && tr[l].pending).length;

  const exportAll = () => {
    const out = Object.fromEntries(active.filter((l) => tr[l] && tr[l].map).map((l) => [l, Object.fromEntries(strings.map((s) => [s.key, text(l, s.key) || '']))]));
    download(`${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'app'}-i18n.json`, JSON.stringify(out, null, 2));
  };
  // Changing the strings invalidates every translation of them.
  const replaceStrings = (next) => { setStrings(next); setTr({}); setQa({}); setEdits({}); setSel(null); };

  const shown = phone ? [active.includes(tab) ? tab : active[0]].filter(Boolean) : active;
  const cur = shown[0];
  const selStr = sel && strings.find((s) => s.key === sel.key);
  return (
    <div className="pl">
      <header className="pl-top">
        <div className="pl-brand"><ParlanceLogo size={36} /><b>{'Parlance'}</b></div>
        <div className="pl-proj"><span>{'Project'}</span><h1>{`${project.name} · ${strings.length} strings`}</h1></div>
        <div className="pl-tone" role="group" aria-label="Tone">
          {['friendly', 'formal'].map((t) => <button type="button" key={t} className={tone === t ? 'on' : ''} onClick={() => setTone(t)}>{t}</button>)}
        </div>
        {net.key && <select className="pl-model" value={net.model} onChange={(e) => net.setModel(e.target.value)} aria-label="Model">{net.models.map((m) => <option key={m} value={m}>{m}</option>)}</select>}
      </header>

      {net.loaded && !net.key && <Connect net={net} />}

      <section className="pl-run">
        <div className="pl-langs">
          {ALL.map(([c, n]) => (
            <button type="button" key={c} className={`pl-lang${langs.includes(c) ? ' on' : ''} ${tr[c] && tr[c].pending ? 'busy' : qa[c] && qa[c].pending ? 'rev' : tr[c] && tr[c].error ? 'err' : tr[c] && tr[c].map ? 'done' : ''}`} onClick={() => setLangs((ls) => (ls.includes(c) ? ls.filter((x) => x !== c) : [...ls, c]))} title={n} aria-pressed={langs.includes(c)}>
              <b>{c}</b><span>{n}</span>
            </button>
          ))}
          <button type="button" className="pl-lang add" onClick={() => setPanel('langs')}><b>{'+'}</b><span>{'Language'}</span></button>
        </div>
        <div className="pl-actions">
          <div className="pl-score">
            <span className="ok"><b>{stats.ok}</b>{' ready'}</span>
            <span className="warn"><b>{stats.warn}</b>{' to review'}</span>
            <span className="bad"><b>{stats.bad}</b>{' broken'}</span>
          </div>
          <div className="pl-view" role="group" aria-label="Placeholders">
            <button type="button" className={values ? 'on' : ''} onClick={() => setValues(true)} title="Show placeholders with sample values">{'Ada'}</button>
            <button type="button" className={values ? '' : 'on'} onClick={() => setValues(false)} title="Show placeholder names">{'{name}'}</button>
          </div>
          <button type="button" className="pl-btn ghost" onClick={() => setPanel('strings')}>{`Strings · ${strings.length}`}</button>
          {failed.length > 0 && !phase && <button type="button" className="pl-btn ghost warn" disabled={!net.ready} onClick={() => run(failed)}>{`Retry ${failed.length} failed`}</button>}
          <button type="button" className="pl-btn" disabled={!net.ready || Boolean(phase) || !active.length || !strings.length} onClick={() => run(active)}>
            {phase === 'translate' ? `Translating ${pendingN} language${pendingN === 1 ? '' : 's'}…` : phase === 'review' ? 'Back-translating & reviewing…' : done ? `Retranslate ${active.length} languages` : `Translate into ${active.length} languages`}
          </button>
          <button type="button" className="pl-btn ghost" disabled={!done} onClick={exportAll}>{'Export JSON'}</button>
        </div>
      </section>
      {error && <p className="pl-err">{error}</p>}

      {phone && (
        <nav className="pl-tabs" aria-label="Language">
          {active.map((l) => <button type="button" key={l} className={cur === l ? 'on' : ''} onClick={() => setTab(l)}>{l}</button>)}
        </nav>
      )}

      {!strings.length ? (
        <div className="pl-empty"><b>{'No strings yet'}</b><span>{'Import your en.json or add strings one by one.'}</span><button type="button" className="pl-btn" onClick={() => setPanel('strings')}>{'Open strings'}</button></div>
      ) : phone ? (
        <div className="pl-cards">
          {cur ? strings.map((s) => {
            const c = cell(cur, s);
            return (
              <button type="button" key={s.key} className={`pl-card ${c.level}`} onClick={() => setSel({ lang: cur, key: s.key })}>
                <span className="pl-key">{s.key}</span>
                <span className="pl-src"><Text s={s.source} values={values} /></span>
                <span className="pl-tr">{c.text ? <Text s={c.text} values={values} /> : c.level === 'pending' ? 'translating…' : c.level === 'failed' ? 'failed — retry above' : '—'}</span>
                {c.issues.length > 0 && <span className="pl-iss">{c.issues[0]}</span>}
              </button>
            );
          }) : <p className="pl-dim">{'Pick at least one language above.'}</p>}
        </div>
      ) : (
        <div className="pl-matrix-wrap">
          <table className="pl-matrix">
            <thead><tr><th className="pl-sticky">{'String'}</th>{active.map((l) => <th key={l}><span className={`pl-th ${tr[l] && tr[l].pending ? 'busy' : qa[l] && qa[l].pending ? 'rev' : tr[l] && tr[l].error ? 'err' : ''}`} title={(tr[l] && tr[l].error) || nameOf(l)}>{l}</span></th>)}</tr></thead>
            <tbody>
              {strings.map((s) => (
                <tr key={s.key}>
                  <th className="pl-sticky"><span className="pl-key">{s.key}</span><span className="pl-src"><Text s={s.source} values={values} /></span><span className="pl-max">{`max ${s.max}`}</span></th>
                  {active.map((l) => {
                    const c = cell(l, s);
                    return (
                      <td key={l} className={`pl-cell ${c.level}${sel && sel.lang === l && sel.key === s.key ? ' on' : ''}`}>
                        <button type="button" onClick={() => setSel({ lang: l, key: s.key })} aria-label={`${s.key} in ${nameOf(l)}`}>
                          <span className="pl-txt">{c.text ? <Text s={c.text} values={values} /> : (c.level === 'pending' ? '' : c.level === 'failed' ? '!' : '·')}</span>
                          {c.text !== undefined && <span className="pl-len">{`${chars(c.text)}/${s.max}`}</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sel && selStr && <Detail sel={sel} name={nameOf(sel.lang)} str={selStr} c={cell(sel.lang, selStr)} qa={qa[sel.lang] && qa[sel.lang].map && qa[sel.lang].map[sel.key]} net={net} tone={tone} project={project} values={values} onEdit={(t) => setEdits((e) => ({ ...e, [`${sel.lang}|${sel.key}`]: t }))} onRevert={() => setEdits((e) => { const n = { ...e }; delete n[`${sel.lang}|${sel.key}`]; return n; })} onClose={() => setSel(null)} />}
      {panel === 'strings' && <StringsPanel strings={strings} project={project} setProject={setProject} onReplace={replaceStrings} onClose={() => setPanel(null)} net={net} />}
      {panel === 'langs' && <LangPanel all={ALL} onAdd={(code, name) => { setExtra((x) => [...x.filter(([c]) => c !== code), [code, name]]); setLangs((ls) => [...new Set([...ls, code])]); }} onRemove={(code) => { setExtra((x) => x.filter(([c]) => c !== code)); setLangs((ls) => ls.filter((l) => l !== code)); }} extra={extra} onClose={() => setPanel(null)} />}
      <DevPanel net={net} app="Parlance" how={HOW} slug="localize" />
    </div>
  );
}

function Detail({ sel, name, str, c, qa, net, tone, project, values, onEdit, onRevert, onClose }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const redo = async () => {
    setBusy(true); setError('');
    try {
      const j = await chatJson({
        ...net.call, maxTokens: 240, temperature: 0.3,
        messages: [
          { role: 'system', content: `${translateSys(name, tone, project)} This time translate ONE string and reply ONLY with JSON: {"translation": <string>}.` },
          { role: 'user', content: JSON.stringify({ key: str.key, source: str.source, context: str.context, max: str.max, current: c.text || '', reviewer_issues: c.issues, note: note || undefined }) },
        ],
      });
      if (j.translation) onEdit(String(j.translation));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const over = chars(c.text || '') - str.max;
  const ph = (str.source.match(HOLDER) || []);
  return (
    <div className="pl-sheet-wrap" onClick={onClose}>
      <aside className="pl-sheet" onClick={(e) => e.stopPropagation()} aria-label={`${str.key} in ${name}`}>
        <header><div><span className="pl-key">{str.key}</span><b>{name}</b></div><button type="button" className="pl-x" onClick={onClose} aria-label="Close">{'×'}</button></header>
        <div className="pl-srcbox"><span>{'English'}</span><p><Text s={str.source} values={values} /></p><em>{`${str.context || 'No context'} · max ${str.max} characters`}</em></div>
        {ph.length > 0 && <p className="pl-phnote">{'Placeholders '}{ph.map((p) => <span key={p} className="pl-ph">{p.slice(1, -1)}</span>)}{' are filled in by the app at runtime and must appear in every translation. Previews use sample values like '}<span className="pl-ph v">{'Ada'}</span>{'.'}</p>}
        <label className="pl-edit"><span>{`${name}${c.level !== 'empty' && c.level !== 'pending' && c.level !== 'failed' ? ` · ${c.level === 'ok' ? 'ready' : c.level === 'warn' ? 'to review' : 'broken'}` : ''}`}</span>
          <textarea value={c.text || ''} onChange={(e) => onEdit(e.target.value)} rows={3} placeholder="Not translated yet — type one, or retranslate below" />
        </label>
        <div className={`pl-preview t-${str.type || 'label'}`}>
          <span>{'Preview'}</span>
          <div className="pl-phone"><div className="pl-slot" style={{ '--max': `${str.max}ch` }}>{c.text ? <Text s={c.text} values /> : '—'}</div></div>
          {over > 0 && <em>{`${over} characters over — it will be cut off`}</em>}
        </div>
        {c.edited && <p className="pl-dim">{'Edited by hand — the reviewer notes below are from the previous version. '}<button type="button" className="pl-link" onClick={onRevert}>{'Revert'}</button></p>}
        {qa && qa.back && <div className="pl-back"><span>{`Back-translation · reviewer score ${qa.score}/5`}</span><p>{qa.back}</p></div>}
        {c.issues && c.issues.length > 0 && <ul className="pl-issues">{c.issues.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        <div className="pl-redo">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the translator — e.g. shorter, less formal" aria-label="Note" />
          <button type="button" className="pl-btn" disabled={!net.ready || busy} onClick={redo}>{busy ? 'Retranslating…' : 'Retranslate'}</button>
        </div>
        {error && <p className="pl-err in">{error}</p>}
      </aside>
    </div>
  );
}

/// Your strings: import an en.json, add or remove strings, set the project name and glossary.
function StringsPanel({ strings, project, setProject, onReplace, onClose, net }) {
  const [draft, setDraft] = useState({ key: '', source: '', context: '', max: '' });
  const [msg, setMsg] = useState('');
  // Glossary from your own strings: one JSON call reads them all and proposes the terms that
  // must read the same everywhere — product names, plan names, feature names.
  const [terms, setTerms] = useState(null); // null | 'pending' | [{ term, why }]
  const suggest = async () => {
    setTerms('pending');
    try {
      const j = await chatJson({ ...net.call, maxTokens: 700, temperature: 0.1, messages: [
        { role: 'system', content: `You build localization glossaries. From the UI strings of the "${project.name}" app, list the terms that must NOT be translated (product, plan and feature names, brand words, units, code). Reply ONLY with JSON: {"terms": [{"term": string, "why": string (max 8 words)}]}. Only terms that literally appear in the strings; at most 12.` },
        { role: 'user', content: JSON.stringify(strings.map((x) => x.source)) },
      ] });
      const seen = new Set(project.glossary.map((g) => g.toLowerCase()));
      // Keep only real terms from the strings (the model can't invent one) and new ones.
      setTerms((j.terms || []).filter((t) => t && t.term && strings.some((x) => x.source.includes(t.term)) && !seen.has(String(t.term).toLowerCase())));
    } catch (e) { setTerms(null); setMsg(`Could not suggest terms: ${e.message}`); }
  };
  const addTerm = (t) => { setProject({ ...project, glossary: [...project.glossary, t] }); setTerms((cur) => (Array.isArray(cur) ? cur.filter((x) => x.term !== t) : cur)); };
  const importFile = async (file) => {
    if (!file) return;
    try {
      const flat = flatten(JSON.parse(await readText(file)));
      const list = Object.entries(flat).map(([key, source]) => ({ key, source, context: '', max: Math.max(16, Math.ceil([...source].length * 1.5)) }));
      if (!list.length) throw new Error('no strings found');
      onReplace(list);
      setMsg(`Imported ${list.length} strings from ${file.name}. Length limits are set to 1.5× the English text — adjust them below.`);
    } catch (e) { setMsg(`Could not import: ${e.message}`); }
  };
  const add = (e) => {
    e.preventDefault();
    const key = draft.key.trim() || `string.${strings.length + 1}`;
    if (strings.some((s) => s.key === key)) { setMsg(`"${key}" already exists.`); return; }
    onReplace([...strings, { key, source: draft.source.trim(), context: draft.context.trim(), max: Number(draft.max) || Math.max(16, Math.ceil(draft.source.length * 1.5)) }]);
    setDraft({ key: '', source: '', context: '', max: '' }); setMsg('');
  };
  const patch = (i, p) => onReplace(strings.map((s, j) => (j === i ? { ...s, ...p } : s)));
  return (
    <div className="pl-sheet-wrap" onClick={onClose}>
      <aside className="pl-sheet wide" onClick={(e) => e.stopPropagation()} aria-label="Strings">
        <header><div><span className="pl-key">{'Source strings · English'}</span><b>{'Strings'}</b></div><button type="button" className="pl-x" onClick={onClose} aria-label="Close">{'×'}</button></header>
        <div className="pl-projrow">
          <label><span>{'App name'}</span><input value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} /></label>
          <label><span>{'Never translate (comma-separated)'}</span><input value={project.glossary.join(', ')} onChange={(e) => setProject({ ...project, glossary: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></label>
        </div>
        <div className="pl-gloss">
          <button type="button" className="pl-btn ghost" onClick={suggest} disabled={!net.ready || !strings.length || terms === 'pending'}>{terms === 'pending' ? 'Reading your strings…' : 'Suggest glossary terms'}</button>
          {Array.isArray(terms) && (terms.length
            ? terms.map((t) => <button type="button" key={t.term} className="pl-term" onClick={() => addTerm(t.term)} title={t.why}>{`+ ${t.term}`}<small>{t.why}</small></button>)
            : <span className="pl-dim">{'Nothing new to add — your glossary already covers it.'}</span>)}
        </div>
        <div className="pl-row">
          <label className="pl-btn ghost file">{'Import en.json'}<input type="file" accept=".json,application/json" onChange={(e) => importFile(e.target.files[0])} /></label>
          <button type="button" className="pl-btn ghost" onClick={() => download('en.json', JSON.stringify(Object.fromEntries(strings.map((s) => [s.key, s.source])), null, 2))} disabled={!strings.length}>{'Export en.json'}</button>
          <button type="button" className="pl-btn ghost" onClick={() => { onReplace(SAMPLE); setProject(DEFAULT_PROJECT); setMsg('Back to the Wavelet sample.'); }}>{'Load sample'}</button>
        </div>
        <p className="pl-dim">{'Changing strings clears the translations, since they no longer match.'}</p>
        {msg && <p className="pl-msg">{msg}</p>}
        <form className="pl-add" onSubmit={add}>
          <input value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} placeholder="key — e.g. home.title" aria-label="Key" />
          <input value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} placeholder="English — use {name} for variables" aria-label="English text" required />
          <input value={draft.context} onChange={(e) => setDraft({ ...draft, context: e.target.value })} placeholder="Where it appears" aria-label="Context" />
          <input value={draft.max} onChange={(e) => setDraft({ ...draft, max: e.target.value.replace(/\D/g, '') })} placeholder="max" aria-label="Max characters" inputMode="numeric" />
          <button type="submit" className="pl-btn" disabled={!draft.source.trim()}>{'Add'}</button>
        </form>
        <ol className="pl-slist">
          {strings.map((s, i) => (
            <li key={s.key}>
              <span className="pl-key">{s.key}</span>
              <span className="pl-src"><Text s={s.source} values={false} /></span>
              <input value={s.context} onChange={(e) => patch(i, { context: e.target.value })} placeholder="context" aria-label={`Context of ${s.key}`} />
              <input className="n" value={s.max} onChange={(e) => patch(i, { max: Number(e.target.value.replace(/\D/g, '')) || 1 })} aria-label={`Max characters of ${s.key}`} inputMode="numeric" />
              <button type="button" className="pl-x sm" onClick={() => onReplace(strings.filter((_, j) => j !== i))} aria-label={`Remove ${s.key}`}>{'×'}</button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}

function LangPanel({ all, extra, onAdd, onRemove, onClose }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const n = name.trim();
    const c = (code.trim() || n.slice(0, 2)).toLowerCase();
    if (!n || !c) return;
    onAdd(c, n); setCode(''); setName('');
  };
  return (
    <div className="pl-sheet-wrap" onClick={onClose}>
      <aside className="pl-sheet" onClick={(e) => e.stopPropagation()} aria-label="Languages">
        <header><div><span className="pl-key">{`${all.length} languages`}</span><b>{'Add a language'}</b></div><button type="button" className="pl-x" onClick={onClose} aria-label="Close">{'×'}</button></header>
        <p className="pl-dim">{'Any language the model knows. Each one adds two requests (translate, review), and they all run side by side.'}</p>
        <form className="pl-add two" onSubmit={submit}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Language — e.g. Korean" aria-label="Language name" required />
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="code — ko" aria-label="Language code" />
          <button type="submit" className="pl-btn" disabled={!name.trim()}>{'Add'}</button>
        </form>
        <div className="pl-chips">
          {['Korean|ko', 'Swedish|sv', 'Turkish|tr', 'Arabic|ar', 'Hindi|hi', 'Chinese (Simplified)|zh-Hans'].filter((x) => !all.some(([c]) => c === x.split('|')[1])).map((x) => { const [n, c] = x.split('|'); return <button type="button" key={c} onClick={() => onAdd(c, n)}>{`+ ${n}`}</button>; })}
        </div>
        {extra.length > 0 && <ul className="pl-slist">{extra.map(([c, n]) => <li key={c} className="lang"><span className="pl-key">{c}</span><span className="pl-src">{n}</span><button type="button" className="pl-x sm" onClick={() => onRemove(c)} aria-label={`Remove ${n}`}>{'×'}</button></li>)}</ul>}
      </aside>
    </div>
  );
}

function Connect({ net }) {
  const [k, setK] = useState('');
  return (
    <form className="pl-connect" onSubmit={(e) => { e.preventDefault(); net.setKey(k); }}>
      <b>{'Connect your translators'}</b>
      <span>{'Every language is translated by a model on the Resonance network, all at once. Paste a node or logical node key — it stays in this browser.'}</span>
      <div><input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="rk_…" aria-label="Resonance API key" autoComplete="off" /><button type="submit" className="pl-btn" disabled={!k.trim()}>{'Connect'}</button></div>
    </form>
  );
}
