import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSeo } from '@shared/lib/useSeo';
import { chat, chatJson, pool } from './api';
import { DevPanel, download, readText, useNetwork, useStored } from './network';
import { FolioLogo } from './logos';
import './knowledge.css';

// Folio — a company handbook you can question. The network reads every page in parallel
// (map), one streamed call answers from the matching quotes only (reduce), and follow-ups are
// first rewritten into a standalone question. The pages are sample data.
const PAGES = [
  { id: 'leave', section: 'People', title: 'Paid leave', body: 'Full-time employees get 26 days of paid leave per year, accrued monthly. Up to 5 unused days can be carried into the next year and must be used by 31 March. Leave requests go through the HR portal at least 10 working days in advance; for less than 3 days, 2 working days are enough.' },
  { id: 'parental', section: 'People', title: 'Parental leave', body: 'Every parent gets 20 weeks of fully paid parental leave, to be taken within 18 months of the birth or adoption. It can be split into up to three blocks. Tell your manager and HR at least 8 weeks before the first block starts.' },
  { id: 'remote', section: 'People', title: 'Remote work', body: 'Employees can work remotely up to 3 days per week. Fully remote arrangements need approval from the department head. Working from another country is allowed for up to 30 days per year; longer stays need a tax review by Finance.' },
  { id: 'onboarding', section: 'People', title: 'Your first 90 days', body: 'Week 1: laptop setup, security training, meet your buddy. Week 2: shadow two customer calls and read the product handbook. By day 30 you ship a first small project and have a feedback 1:1 with your manager. HR sends the probation review at day 80.' },
  { id: 'expenses', section: 'Money', title: 'Travel & expenses', body: 'Book travel through the travel desk. Trains are preferred for trips under 4 hours. Hotel cap: €160 per night in capital cities, €120 elsewhere. Meals are reimbursed up to €45 per day with receipts. Submit expenses within 30 days of the trip; later claims need your manager\'s sign-off.' },
  { id: 'homeoffice', section: 'Money', title: 'Home office budget', body: 'Each employee has a one-off €500 home-office budget for a desk, chair, monitor or headset, plus €150 every two years for replacements. Buy what you need and file it as an expense with the category "home office".' },
  { id: 'learning', section: 'Money', title: 'Learning budget', body: 'You have €1,200 per year for courses, books and conferences that relate to your role. Conference travel comes out of the travel policy, not this budget. Unused budget does not roll over.' },
  { id: 'devices', section: 'IT & Security', title: 'Laptops & devices', body: 'New hires choose a 14" or 16" laptop. Devices are refreshed every 3 years. Lost or stolen devices must be reported to IT within 24 hours so they can be wiped remotely. Personal phones can read work email only with the device-management profile installed.' },
  { id: 'security', section: 'IT & Security', title: 'Passwords & access', body: 'Use the company password manager. Passwords must be at least 14 characters, and MFA is mandatory for email, code hosting and the HR portal. Access to production systems is granted per team and reviewed every quarter. Report phishing with the "Report" button in your mail client.' },
];
const SUGGEST = ['Can I work from Portugal for six weeks?', 'How much can I spend on a hotel in Paris?', 'I lost my laptop at the airport — what now?', 'Is there a budget for a standing desk?', 'Can I bring my dog to the office?'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

const MAP = 'You read ONE page of a company handbook and judge whether it helps answer the question. Reply ONLY with JSON: {"relevance": 0 | 1 | 2 | 3, "quote": <the single most relevant sentence copied verbatim from the page, or "">}. 0 = unrelated, 3 = answers it directly.';
const REWRITE = 'Rewrite the follow-up into a standalone question using the conversation. Reply ONLY with JSON: {"question": <standalone question>}.';

const HOW = (
  <>
    <p>{'Folio is retrieval without a vector database — a fan-out that the network makes cheap:'}</p>
    <ol>
      <li><b>{'Rewrite'}</b>{' (follow-ups only) — one JSON call turns "and in Spain?" into a full question.'}</li>
      <li><b>{'Read'}</b>{' — one request per page, six at a time: relevance 0-3 plus the exact sentence. The spines light up as each page comes back.'}</li>
      <li><b>{'Answer'}</b>{' — one streamed call that sees only the matching quotes and must cite them as [1], [2]. Click a citation to open the page with the sentence highlighted.'}</li>
      <li><b>{'Audit'}</b>{' — every page gets its own reviewer at once, flagging unclear, outdated or risky sentences; a flag is kept only if its sentence is really on the page, and an accepted rewrite changes the page.'}</li>
      <li><b>{'Fill the gap'}</b>{' — if nothing matches, draft the missing page in the handbook\'s voice and add it; the next question reads it too.'}</li>
    </ol>
    <h4>{'When to switch to embeddings'}</h4>
    <p>{'Up to a few hundred pages, reading everything in parallel is simple and accurate. Beyond that, pre-filter with a keyword or embedding search and keep this read-then-answer step for the top pages.'}</p>
  </>
);

const stateOf = (r) => (!r ? '' : r.pending ? 'reading' : r.error ? 'failed' : r.relevance >= 2 ? 'hit' : r.relevance === 1 ? 'near' : 'miss');

export default function Knowledge() {
  useSeo({ title: 'Folio handbook · a Resonance sample', description: 'Question a company handbook: the Resonance network reads every page in parallel and answers with citations you can open.', path: '/samples/knowledge' });
  const net = useNetwork({ prefer: 'text-generation' });
  const [pages, setPages] = useStored('folio.pages', PAGES);
  const [reads, setReads] = useState({});
  const [turns, setTurns] = useStored('folio.turns', []);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null); // { id, quote }
  const [mode, setMode] = useState('ask');
  const [toc, setToc] = useState(false);
  const [adding, setAdding] = useState(false);
  const endRef = useRef(null);

  const sections = useMemo(() => [...new Set(pages.map((p) => p.section))], [pages]);
  const pageNo = (id) => pages.findIndex((p) => p.id === id) + 1;
  const setTurn = (i, p) => setTurns((ts) => ts.map((t, j) => (j === i ? { ...t, ...p } : t)));
  const openPage = (id, quote) => { setOpen({ id, quote }); setToc(false); };

  const ask = async (raw) => {
    const question = raw.trim();
    if (!question || phase || !net.ready) return;
    setError(''); setQ(''); setOpen(null); setMode('ask');
    const i = turns.length;
    setTurns((ts) => [...ts, { q: question }]);
    const t0 = performance.now();
    try {
      let standalone = question;
      if (turns.length) {
        setPhase('rewrite');
        const hist = turns.slice(-3).map((t) => `Q: ${t.standalone || t.q}\nA: ${(t.answer || '').slice(0, 400)}`).join('\n');
        const j = await chatJson({ ...net.call, maxTokens: 120, messages: [{ role: 'system', content: REWRITE }, { role: 'user', content: `${hist}\n\nFollow-up: ${question}` }] });
        if (j.question) standalone = String(j.question);
        setTurn(i, { standalone });
      }
      setPhase('read');
      setReads(Object.fromEntries(pages.map((p) => [p.id, { pending: true }])));
      const tr = performance.now();
      const res = await pool(pages.map((p) => async () => {
        try {
          const j = await chatJson({ ...net.call, maxTokens: 160, messages: [{ role: 'system', content: MAP }, { role: 'user', content: `Question: ${standalone}\n\nPage "${p.title}" (${p.section}):\n${p.body}` }] });
          const r = { relevance: Math.max(0, Math.min(3, Number(j.relevance) || 0)), quote: String(j.quote || '') };
          setReads((s) => ({ ...s, [p.id]: r }));
          return r;
        } catch (e) { setReads((s) => ({ ...s, [p.id]: { error: e.message } })); throw e; }
      }), 6);
      const readMs = performance.now() - tr;
      const bad = res.filter((r) => !r.ok);
      if (bad.length === pages.length) throw bad[0].error;
      const hits = pages.map((p, k) => ({ p, r: res[k] })).filter(({ r }) => r.ok && r.value.relevance >= 2)
        .sort((a, b) => b.r.value.relevance - a.r.value.relevance).slice(0, 4);
      const sources = hits.map(({ p, r }) => ({ id: p.id, title: p.title, section: p.section, quote: r.value.quote }));
      setTurn(i, { sources, stats: { read: pages.length - bad.length, ms: readMs, failed: bad.length } });
      if (!sources.length) { setTurn(i, { gap: true, answer: '' }); return; }
      setPhase('answer');
      await chat({
        ...net.call, maxTokens: 380,
        messages: [
          { role: 'system', content: 'You answer employees\' questions from the company handbook. Use ONLY the numbered sources; cite each claim like [1]. Be brief (under 90 words) and practical. If the sources only partly answer, say what is missing and who to ask (HR, Finance or IT).' },
          { role: 'user', content: `Sources:\n${sources.map((s, k) => `[${k + 1}] ${s.title}: ${s.quote || pages.find((p) => p.id === s.id).body}`).join('\n')}\n\nQuestion: ${standalone}` },
        ],
        onDelta: (_, all) => setTurn(i, { answer: all }),
      });
      setTurn(i, { total: performance.now() - t0 });
    } catch (e) {
      setError(e.message);
    } finally {
      setPhase('');
      setTimeout(() => endRef.current && endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' }), 30);
    }
  };

  const draftPage = async (i) => {
    const t = turns[i];
    setPhase('draft'); setError('');
    try {
      await chat({
        ...net.call, maxTokens: 260,
        messages: [
          { role: 'system', content: 'The company handbook has no page answering this question. Draft one in the handbook\'s plain, specific voice: a short title on the first line, then 3-4 sentences of policy. Mark any number or rule you had to assume with "(to confirm)". No markdown.' },
          { role: 'user', content: `Question: ${t.standalone || t.q}\n\nExample of the house style:\n${PAGES[0].body}` },
        ],
        onDelta: (_, all) => setTurn(i, { draft: all }),
      });
    } catch (e) { setError(e.message); } finally { setPhase(''); }
  };
  const shelve = (i) => {
    const d = clean(turns[i].draft || '').trim();
    const [title, ...rest] = d.split('\n');
    const id = `draft-${Date.now()}`;
    setPages((ps) => [...ps, { id, section: 'Drafts', title: title.slice(0, 60) || 'Untitled draft', body: rest.join(' ').trim() || d, draft: true }]);
    setTurn(i, { shelved: id });
  };

  // Your own handbook: Markdown or text files become pages — one per "## " heading, or one per
  // file — under the file's "# " title (or "Imported").
  const importFiles = async (files) => {
    const added = [];
    for (const f of [...files]) {
      const text = (await readText(f)).replace(/\r/g, '');
      const h1 = (text.match(/^#\s+(.+)$/m) || [])[1];
      const section = (h1 || 'Imported').trim().slice(0, 40);
      const parts = text.split(/^##\s+/m);
      const chunks = parts.length > 1 ? parts.slice(1).map((c) => { const [t, ...b] = c.split('\n'); return [t, b.join('\n')]; }) : [[h1 || f.name.replace(/\.[^.]+$/, ''), text.replace(/^#\s+.+$/m, '')]];
      chunks.forEach(([t, b], k) => {
        const body = clean(b).replace(/^[-*]\s+/gm, '').replace(/\n{2,}/g, '\n').trim().slice(0, 6000);
        if (body) added.push({ id: `imp-${Date.now().toString(36)}-${added.length}-${k}`, section, title: clean(t).trim().slice(0, 80) || 'Untitled', body });
      });
    }
    setPages((ps) => [...ps, ...added]);
    setMsg(added.length ? `Added ${added.length} page${added.length === 1 ? '' : 's'}. Every question now reads them too — each page is one request, all side by side.` : 'No text found in those files.');
  };
  const exportMd = () => download('handbook.md', sections.map((sec) => `# ${sec}\n\n${pages.filter((p) => p.section === sec).map((p) => `## ${p.title}\n\n${p.body}`).join('\n\n')}`).join('\n\n'), 'text/markdown');
  const patchPage = (id, p) => setPages((ps) => ps.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const removePage = (id) => { setPages((ps) => ps.filter((x) => x.id !== id)); setOpen(null); };

  const reading = Object.keys(reads).length > 0;
  const readDone = pages.filter((p) => reads[p.id] && !reads[p.id].pending).length;
  const last = turns[turns.length - 1];

  return (
    <div className="fo">
      <header className="fo-mast">
        <button type="button" className="fo-toc-btn" onClick={() => setToc(true)} aria-label="Open contents"><span />{'Contents'}</button>
        <div className="fo-brand">
          <FolioLogo size={34} />
          <div><b>{'Folio'}</b><span>{'The Northwind Handbook'}</span></div>
        </div>
        <nav className="fo-modes" aria-label="View">
          <button type="button" className={mode === 'ask' ? 'on' : ''} onClick={() => setMode('ask')}>{'Ask'}</button>
          <button type="button" className={mode === 'browse' ? 'on' : ''} onClick={() => setMode('browse')}>{'Browse'}</button>
          <button type="button" className={mode === 'audit' ? 'on' : ''} onClick={() => setMode('audit')}>{'Audit'}</button>
        </nav>
        <div className="fo-conn">
          {net.key
            ? <label><span>{'Reader'}</span><select value={net.model} onChange={(e) => net.setModel(e.target.value)}>{net.models.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
            : <span className="fo-closed">{'Reading room closed'}</span>}
        </div>
      </header>
      <div className="fo-edition">
        <span>{`Vol. 3 · ${pages.length} pages · ${sections.length} sections`}</span>
        <span className="fo-ed-actions">
          {turns.length > 0 && <button type="button" onClick={() => { setTurns([]); setReads({}); setMode('ask'); }}>{'New conversation'}</button>}
          <label className="fo-ed-file">{'Import pages'}<input type="file" multiple accept=".md,.markdown,.txt,text/plain,text/markdown" onChange={(e) => { importFiles(e.target.files); e.target.value = ''; }} /></label>
          <button type="button" onClick={exportMd}>{'Export'}</button>
          <button type="button" onClick={() => { if (window.confirm('Reset the handbook to the sample pages and clear the conversation?')) { setPages(PAGES); setTurns([]); setReads({}); setMsg(''); } }}>{'Reset'}</button>
        </span>
      </div>
      {msg && <p className="fo-msg">{msg}<button type="button" onClick={() => setMsg('')} aria-label="Dismiss">{'×'}</button></p>}

      <div className="fo-layout">
        <div className={`fo-scrim${toc ? ' on' : ''}`} onClick={() => setToc(false)} aria-hidden="true" />
        <aside className={`fo-toc${toc ? ' open' : ''}`} aria-label="Contents">
          <div className="fo-toc-h"><b>{'Contents'}</b><button type="button" className="fo-x" onClick={() => setToc(false)} aria-label="Close contents">{'×'}</button></div>
          {sections.map((s, si) => (
            <div key={s} className="fo-sec">
              <h3><span>{ROMAN[si] || si + 1}</span>{s}</h3>
              {pages.filter((p) => p.section === s).map((p) => {
                const st = stateOf(reads[p.id]);
                return (
                  <button type="button" key={p.id} className={`fo-entry ${st}${open && open.id === p.id ? ' on' : ''}`} onClick={() => openPage(p.id, reads[p.id] && reads[p.id].quote)}>
                    <i className="fo-ink" aria-hidden="true" />
                    <span className="fo-entry-t">{p.title}{p.draft && <em>{' · draft'}</em>}</span>
                    <span className="fo-leader" aria-hidden="true" />
                    <span className="fo-pg">{pageNo(p.id)}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {adding
            ? <AddPage onAdd={(p) => { setPages((ps) => [...ps, p]); setAdding(false); }} onCancel={() => setAdding(false)} sections={sections} />
            : <button type="button" className="fo-add" onClick={() => setAdding(true)}>{'+ Add a page'}</button>}
        </aside>

        <main className="fo-main">
          {mode === 'browse' ? (
            <Browse pages={pages} sections={sections} reads={reads} pageNo={pageNo} onOpen={openPage} />
          ) : mode === 'audit' ? (
            <Audit pages={pages} net={net} pageNo={pageNo} onOpen={openPage} onFix={(id, from, to) => setPages((ps) => ps.map((p) => (p.id === id ? { ...p, body: p.body.replace(from, to) } : p)))} />
          ) : (
            <div className="fo-col">
              {net.loaded && !net.key && <Connect net={net} />}

              {!turns.length && (
                <section className="fo-hero">
                  <span className="fo-kicker">{'Ask the handbook'}</span>
                  <h1>{'What would you like to know?'}</h1>
                  <AskForm q={q} setQ={setQ} onAsk={ask} disabled={!net.ready} busy={Boolean(phase)} big />
                  <div className="fo-faq">
                    <span className="fo-kicker">{'Frequently asked'}</span>
                    {SUGGEST.map((s) => <button type="button" key={s} disabled={!net.ready || Boolean(phase)} onClick={() => ask(s)}><span>{s}</span><i aria-hidden="true">{'→'}</i></button>)}
                  </div>
                </section>
              )}

              {reading && (
                <section className="fo-shelf" aria-label="Pages being read">
                  <div className="fo-spines">
                    {pages.map((p) => {
                      const st = stateOf(reads[p.id]);
                      return <button type="button" key={p.id} className={`fo-spine ${st}`} title={p.title} onClick={() => openPage(p.id, reads[p.id] && reads[p.id].quote)}><span>{p.title}</span></button>;
                    })}
                  </div>
                  <p className="fo-shelf-cap">
                    {phase === 'read'
                      ? `Reading ${pages.length} pages at once on the network — ${readDone} back`
                      : phase === 'rewrite' ? 'Reading the conversation first…'
                        : last && last.stats ? `Read ${last.stats.read} pages in ${(last.stats.ms / 1000).toFixed(1)}s · ${last.sources.length} relevant` : ''}
                  </p>
                </section>
              )}

              {turns.map((t, i) => (
                <article key={i} className="fo-turn">
                  <div className="fo-q"><span className="fo-qn">{`Q${i + 1}`}</span><h2>{t.q}</h2></div>
                  {t.standalone && t.standalone !== t.q && <p className="fo-meta">{`Read as: “${t.standalone}”`}</p>}
                  {t.answer !== undefined && !t.gap && (
                    <div className="fo-answer">
                      <Cited text={t.answer || ''} onCite={(n) => { const s = t.sources[n - 1]; if (s) openPage(s.id, s.quote); }} />
                      {phase === 'answer' && i === turns.length - 1 && <span className="fo-caret" />}
                    </div>
                  )}
                  {t.answer === undefined && !t.gap && i === turns.length - 1 && phase && <p className="fo-meta">{'Looking it up…'}</p>}
                  {t.sources && t.sources.length > 0 && (
                    <ol className="fo-notes">
                      {t.sources.map((s, k) => (
                        <li key={s.id}>
                          <button type="button" onClick={() => openPage(s.id, s.quote)}>
                            <span className="fo-n">{k + 1}</span>
                            <span className="fo-note-b"><b>{s.title}</b>{s.quote && <span>{`“${s.quote}”`}</span>}</span>
                            <span className="fo-pg">{`p. ${pageNo(s.id)}`}</span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                  {t.gap && (
                    <div className="fo-gap">
                      <span className="fo-kicker">{'Not in the handbook'}</span>
                      <p>{'No page answers this yet. Folio can draft the missing page in the handbook\'s voice for HR to review.'}</p>
                      {t.draft !== undefined && <div className="fo-draft">{clean(t.draft)}{phase === 'draft' && <span className="fo-caret" />}</div>}
                      <div className="fo-row">
                        {t.draft === undefined && <button type="button" className="fo-btn solid" disabled={!net.ready || Boolean(phase)} onClick={() => draftPage(i)}>{'Draft the missing page'}</button>}
                        {t.draft && phase !== 'draft' && !t.shelved && <button type="button" className="fo-btn solid" onClick={() => shelve(i)}>{'Add it to the handbook as a draft'}</button>}
                        {t.shelved && <button type="button" className="fo-btn" onClick={() => openPage(t.shelved)}>{'Open the draft'}</button>}
                      </div>
                    </div>
                  )}
                </article>
              ))}
              {error && <p className="fo-err">{error}</p>}
              <div ref={endRef} />
              {turns.length > 0 && (
                <div className="fo-dock"><AskForm q={q} setQ={setQ} onAsk={ask} disabled={!net.ready} busy={Boolean(phase)} placeholder="Ask a follow-up…" /></div>
              )}
            </div>
          )}
        </main>
      </div>

      {open && <Reader pages={pages} open={open} pageNo={pageNo} onOpen={openPage} onClose={() => setOpen(null)} onPatch={patchPage} onRemove={removePage} />}
      <DevPanel net={net} app="Folio" how={HOW} slug="knowledge" />
    </div>
  );
}

function AskForm({ q, setQ, onAsk, disabled, busy, big, placeholder = 'Ask about leave, travel, devices…' }) {
  return (
    <form className={`fo-ask${big ? ' big' : ''}`} onSubmit={(e) => { e.preventDefault(); onAsk(q); }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} disabled={disabled} aria-label="Question" />
      <button type="submit" disabled={disabled || busy || !q.trim()}>{busy ? 'Reading…' : 'Ask'}</button>
    </form>
  );
}

function Connect({ net }) {
  const [k, setK] = useState('');
  return (
    <form className="fo-connect" onSubmit={(e) => { e.preventDefault(); net.setKey(k); }}>
      <span className="fo-kicker">{'Open the reading room'}</span>
      <p>{'Folio reads with models on the Resonance network. Paste your node key or a logical node key — it stays in this browser.'}</p>
      <div className="fo-row"><input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="rk_…" aria-label="Resonance API key" autoComplete="off" /><button type="submit" className="fo-btn solid" disabled={!k.trim()}>{'Open'}</button></div>
    </form>
  );
}

// The audit: every page read by its own reviewer at once, looking for what makes a handbook
// wrong or hard to follow. Code keeps only flags whose sentence is really on the page.
const AUDIT = 'You audit one page of a company handbook. Flag sentences that are ambiguous, likely outdated (dates, amounts, tools), risky (legal or safety), or contradict common sense, and propose a clearer rewrite. Reply ONLY with JSON: {"flags": [{"sentence": <copied verbatim from the page>, "kind": "unclear" | "outdated" | "risky" | "missing", "why": <one short sentence>, "rewrite": <the sentence rewritten>}]}. At most 3 flags; [] if the page is clear.';
function Audit({ pages, net, pageNo, onOpen, onFix }) {
  const [res, setRes] = useStored('folio.audit', {});
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setRes(Object.fromEntries(pages.map((p) => [p.id, { pending: true }])));
    await pool(pages.map((p) => async () => {
      try {
        const j = await chatJson({ ...net.call, maxTokens: 600, temperature: 0.1, messages: [{ role: 'system', content: AUDIT }, { role: 'user', content: `${p.title}\n\n${p.body}` }] });
        const flags = (j.flags || []).filter((f) => f && f.sentence && p.body.includes(String(f.sentence).trim())).slice(0, 3);
        setRes((r) => ({ ...r, [p.id]: { flags, at: Date.now() } }));
      } catch (e) { setRes((r) => ({ ...r, [p.id]: { error: e.message } })); }
    }), 6);
    setBusy(false);
  };
  const flagged = pages.filter((p) => res[p.id] && res[p.id].flags && res[p.id].flags.length);
  const done = pages.filter((p) => res[p.id] && !res[p.id].pending).length;
  return (
    <div className="fo-col">
      <section className="fo-hero">
        <span className="fo-kicker">{'Audit the handbook'}</span>
        <h1>{'What would confuse a new hire?'}</h1>
        <p className="fo-audit-lede">{`Each of the ${pages.length} pages gets its own reviewer, all at once. A flag is kept only if its sentence is really on the page; accept a rewrite and the page changes — the next question reads it.`}</p>
        <div><button type="button" className="fo-btn solid" disabled={!net.ready || busy || !pages.length} onClick={run}>{busy ? `Reading ${done}/${pages.length} pages…` : Object.keys(res).length ? 'Audit again' : `Audit all ${pages.length} pages`}</button></div>
      </section>
      {Object.keys(res).length > 0 && !busy && !flagged.length && <p className="fo-audit-ok">{'No page was flagged.'}</p>}
      {flagged.map((p) => (
        <section key={p.id} className="fo-audit-page">
          <button type="button" className="fo-audit-t" onClick={() => onOpen(p.id)}><span className="fo-pg">{pageNo(p.id)}</span>{p.title}</button>
          {res[p.id].flags.map((f) => (
            <div key={f.sentence} className={`fo-flag k-${f.kind}`}>
              <span className="fo-kicker">{f.kind}</span>
              <blockquote>{f.sentence}</blockquote>
              <p>{f.why}</p>
              {f.rewrite && <p className="fo-rewrite">{f.rewrite}</p>}
              <div className="fo-flag-a">
                {f.rewrite && <button type="button" className="fo-btn sm" onClick={() => { onFix(p.id, f.sentence, f.rewrite); setRes((r) => ({ ...r, [p.id]: { ...r[p.id], flags: r[p.id].flags.filter((x) => x !== f) } })); }}>{'Accept rewrite'}</button>}
                <button type="button" className="fo-link" onClick={() => onOpen(p.id, f.sentence)}>{'See it on the page'}</button>
              </div>
            </div>
          ))}
        </section>
      ))}
      {pages.filter((p) => res[p.id] && res[p.id].error).map((p) => <p key={p.id} className="fo-err">{`${p.title}: ${res[p.id].error}`}</p>)}
    </div>
  );
}

function Browse({ pages, sections, reads, pageNo, onOpen }) {
  return (
    <div className="fo-browse">
      {sections.map((s, si) => (
        <section key={s}>
          <h2><span>{ROMAN[si] || si + 1}</span>{s}</h2>
          <div className="fo-cards">
            {pages.filter((p) => p.section === s).map((p) => (
              <button type="button" key={p.id} className={`fo-card ${stateOf(reads[p.id])}`} onClick={() => onOpen(p.id, reads[p.id] && reads[p.id].quote)}>
                <span className="fo-pg">{`p. ${pageNo(p.id)}`}{p.draft ? ' · draft' : ''}</span>
                <b>{p.title}</b>
                <span className="fo-card-x">{p.body.split('. ')[0]}.</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Reader({ pages, open, pageNo, onOpen, onClose, onPatch, onRemove }) {
  const [edit, setEdit] = useState(null);
  useEffect(() => { setEdit(null); }, [open.id]);
  const page = pages.find((p) => p.id === open.id);
  const n = pageNo(open.id);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!page) return null;
  const prev = pages[n - 2];
  const next = pages[n];
  return (
    <div className="fo-reader-wrap" onClick={onClose}>
      <aside className="fo-reader" onClick={(e) => e.stopPropagation()} aria-label={page.title}>
        <header><span className="fo-kicker">{`${page.section}${page.draft ? ' · draft' : ''}`}</span><span className="fo-reader-act">{!edit && <button type="button" onClick={() => setEdit({ title: page.title, body: page.body, section: page.section })}>{'Edit'}</button>}<button type="button" className="fo-x" onClick={onClose} aria-label="Close page">{'×'}</button></span></header>
        {edit ? (
          <form className="fo-edit" onSubmit={(e) => { e.preventDefault(); onPatch(page.id, { ...edit, draft: false }); setEdit(null); }}>
            <input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} aria-label="Title" />
            <input value={edit.section} onChange={(e) => setEdit({ ...edit, section: e.target.value })} aria-label="Section" />
            <textarea rows={10} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} aria-label="Page text" />
            <div className="fo-row">
              <button type="submit" className="fo-btn solid" disabled={!edit.title.trim() || !edit.body.trim()}>{page.draft ? 'Save & publish' : 'Save'}</button>
              <button type="button" className="fo-btn" onClick={() => setEdit(null)}>{'Cancel'}</button>
              <button type="button" className="fo-btn danger" onClick={() => { if (window.confirm(`Remove "${page.title}" from the handbook?`)) onRemove(page.id); }}>{'Remove page'}</button>
            </div>
          </form>
        ) : (
          <>
            <h2>{page.title}</h2>
            <Highlighted body={page.body} quote={open.quote} />
          </>
        )}
        {open.quote && !findQuote(page.body, open.quote) && <p className="fo-meta">{`Quoted as: “${open.quote}”`}</p>}
        <footer>
          <button type="button" disabled={!prev} onClick={() => prev && onOpen(prev.id)}>{prev ? `← ${prev.title}` : ''}</button>
          <span className="fo-pg">{`${n} / ${pages.length}`}</span>
          <button type="button" disabled={!next} onClick={() => next && onOpen(next.id)}>{next ? `${next.title} →` : ''}</button>
        </footer>
      </aside>
    </div>
  );
}

function AddPage({ onAdd, onCancel, sections }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [section, setSection] = useState(sections[0]);
  return (
    <form className="fo-newpage" onSubmit={(e) => { e.preventDefault(); if (title.trim() && body.trim()) onAdd({ id: `own-${Date.now()}`, section: section.trim() || 'Other', title: title.trim(), body: body.trim() }); }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Page title" aria-label="Page title" />
      <input value={section} onChange={(e) => setSection(e.target.value)} list="fo-sections" placeholder="Section" aria-label="Section — pick one or type a new one" />
      <datalist id="fo-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Paste the policy text…" rows={5} aria-label="Page text" />
      <div className="fo-row"><button type="submit" className="fo-btn solid" disabled={!title.trim() || !body.trim()}>{'Add page'}</button><button type="button" className="fo-btn" onClick={onCancel}>{'Cancel'}</button></div>
    </form>
  );
}

const clean = (s) => s.replace(/\*\*|^#+\s*/gm, '');
const findQuote = (body, quote) => {
  const q = (quote || '').replace(/[.\s]+$/, '').toLowerCase();
  if (!q) return null;
  const at = body.toLowerCase().indexOf(q);
  return at < 0 ? null : [at, q.length];
};

/// Answer text with [n] markers turned into citation buttons.
function Cited({ text, onCite }) {
  const parts = text.split(/(\[\d+\])/g);
  return <p>{parts.map((s, i) => { const m = s.match(/^\[(\d+)\]$/); return m ? <button type="button" key={i} className="fo-cite" onClick={() => onCite(Number(m[1]))} aria-label={`Source ${m[1]}`}>{m[1]}</button> : <React.Fragment key={i}>{s}</React.Fragment>; })}</p>;
}

/// A page body with the quoted sentence marked, when it is found verbatim.
function Highlighted({ body, quote }) {
  const hit = findQuote(body, quote);
  if (!hit) return <p className="fo-body">{body}</p>;
  const [at, len] = hit;
  return <p className="fo-body">{body.slice(0, at)}<mark>{body.slice(at, at + len)}</mark>{body.slice(at + len)}</p>;
}
