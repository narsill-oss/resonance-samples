import React, { useMemo, useRef, useState } from 'react';
import { useSeo } from '@shared/lib/useSeo';
import { chat, chatJson, pool } from './api';
import { DevPanel, download, parseCsv, readText, toCsv, useNetwork, useStored } from './network';
import { KestrelLogo } from './logos';
import './crm.css';

// Kestrel — a sales CRM whose AI runs on the Resonance network. Sample data; every AI action
// is a plain /v1/chat/completions call (JSON for structure, streaming for prose).
const STAGES = ['Prospect', 'Discovery', 'Proposal', 'Negotiation', 'Won'];
const STAGE_ODDS = { Prospect: 10, Discovery: 25, Proposal: 45, Negotiation: 70, Won: 100 };
const SEED = [
  { id: 'd1', company: 'Ferro & Vetro', contact: 'Giulia Bianchi', role: 'COO', value: 12000, stage: 'Prospect', owner: 'MR', touched: 2, notes: ['Downloaded the pricing PDF twice this week.', 'Asked whether we integrate with SAP Business One.'] },
  { id: 'd2', company: 'Northwind Logistics', contact: 'Marcus Lee', role: 'CTO', value: 48000, stage: 'Negotiation', owner: 'AK', touched: 1, notes: ['Demo went well; CTO wants a security review.', 'Budget approved for Q1, decision by end of month.', 'A competitor quoted 20% less.'] },
  { id: 'd3', company: 'Studio Marino', contact: 'Sofia Marino', role: 'Founder', value: 8500, stage: 'Proposal', owner: 'MR', touched: 9, notes: ['Proposal sent 9 days ago, no reply.', 'Small team (6 people), price-sensitive.'] },
  { id: 'd4', company: 'Helio Solar', contact: 'Daniel Okafor', role: 'Head of Ops', value: 30000, stage: 'Discovery', owner: 'JL', touched: 3, notes: ['Inbound from the webinar, very engaged; booked a second call.', 'Needs English and French support.'] },
  { id: 'd5', company: 'Baltic Foods', contact: 'Anna Kowalska', role: 'IT Manager', value: 5000, stage: 'Prospect', owner: 'JL', touched: 21, notes: ['Cold outbound: opened 1 of 4 emails.'] },
  { id: 'd6', company: 'Gallo Motors', contact: 'Lorenzo Gallo', role: 'Head of Sales', value: 62000, stage: 'Negotiation', owner: 'AK', touched: 4, notes: ['Verbal yes from the Head of Sales; legal reviewing the contract.', 'Asked for a 3-year discount.'] },
  { id: 'd7', company: 'Arcadia Health', contact: 'Priya Nair', role: 'CIO', value: 91000, stage: 'Discovery', owner: 'AK', touched: 6, notes: ['Two calls so far; the CIO is the champion, procurement not involved yet.', 'Strict data-residency requirements (EU only).'] },
  { id: 'd8', company: 'Copperline', contact: 'Tom Becker', role: 'VP Finance', value: 18000, stage: 'Won', owner: 'MR', touched: 12, notes: ['Signed annual plan.', 'Wants to expand to the EMEA team next quarter.'] },
];
const SAMPLE_CALL = `Call with Priya (CIO) and Mark from procurement, 35 min.
Priya: the pilot with the radiology team went fine, they want it hospital-wide.
Mark asked about pricing for ~400 seats, said anything above 100k needs board approval in March.
Concern: they had a bad experience with a vendor storing data outside the EU.
Priya wants a reference customer in healthcare. We agreed to send a security pack and schedule a call with their DPO next Tuesday.`;

const eur = (v) => `€${Math.round(v).toLocaleString('en-US')}`;
const brief = (d) => `${d.company} — ${d.contact} (${d.role})\nStage: ${d.stage} · Value: ${eur(d.value)} · Last touch: ${d.touched} days ago\nActivity:\n${d.notes.map((n) => `- ${n}`).join('\n')}${d.facts ? `\nKnown facts: ${JSON.stringify(d.facts)}` : ''}`;
const odds = (d) => (d.ai ? d.ai.probability : STAGE_ODDS[d.stage]);

const SCORE = 'You are a sales coach. Judge the chance this deal closes in the next 60 days. Reply ONLY with JSON: {"probability": <0-100 integer>, "health": "on track" | "at risk" | "stalled", "reasons": [<2-3 short strings>], "risk": <the biggest risk, one short sentence>, "next": <the single best next action, one short sentence>}';
const EXTRACT = 'You turn raw sales call notes into CRM fields. Reply ONLY with JSON: {"summary": <one sentence>, "budget": <string or null>, "decision_makers": [<names with roles>], "timeline": <string or null>, "pains": [<short strings>], "objections": [<short strings>], "next_step": <string or null>}. Use only what the notes say.';

const HOW = (
  <>
    <p>{'Kestrel is an ordinary CRM: the intelligence is six kinds of call to '}<code>{'POST /v1/chat/completions'}</code>{'.'}</p>
    <ul>
      <li><b>{'Rescore pipeline'}</b>{' — one JSON request per deal, four at a time. Watch the Requests tab: the bars overlap because different nodes serve them side by side.'}</li>
      <li><b>{'Deal coach'}</b>{' — the same scoring call for one deal, rendered as probability, risks and a next action.'}</li>
      <li><b>{'Call notes → fields'}</b>{' — extraction: free text in, typed JSON out (budget, decision makers, objections…), then written back to the deal.'}</li>
      <li><b>{'Stale sweep'}</b>{' — every deal quiet for a week or more gets its own follow-up draft, written in parallel from that deal\'s notes; logging one resets its last touch.'}</li>
      <li><b>{'Follow-up'}</b>{' and '}<b>{'Forecast brief'}</b>{' — streamed prose ("stream": true) that you can stop half-way.'}</li>
    </ul>
    <h4>{'Make it yours'}</h4>
    <p>{'Add deals by hand or import a CSV (company, contact, role, value, stage, notes); everything is kept in this browser. In production, replace that with your CRM\'s API and keep the prompts. Give the server that runs it a logical node key, so its usage is metered on its own.'}</p>
  </>
);

export default function Crm() {
  useSeo({ title: 'Kestrel CRM · a Resonance sample', description: 'A sales CRM whose AI — deal scoring, call-note extraction, follow-ups and forecasts — runs on the Resonance network.', path: '/samples/crm' });
  const net = useNetwork({ prefer: 'text-generation' });
  const [deals, setDeals] = useStored('kestrel.deals', SEED);
  const [find, setFind] = useState('');
  const [owner, setOwner] = useState('');
  const [adding, setAdding] = useState(false);
  const [sweep, setSweep] = useState(null); // null | { [dealId]: { pending } | { subject, body } | { error } }
  const [msg, setMsg] = useState('');
  const [view, setView] = useState('pipeline');
  const [open, setOpen] = useState(null);
  const [scoring, setScoring] = useState({});
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(null);

  const patch = (id, p) => setDeals((ds) => ds.map((d) => (d.id === id ? { ...d, ...p } : d)));
  const score = async (d) => {
    setScoring((s) => ({ ...s, [d.id]: true }));
    try {
      const j = await chatJson({ ...net.call, maxTokens: 320, messages: [{ role: 'system', content: SCORE }, { role: 'user', content: brief(d) }] });
      patch(d.id, { ai: {
        probability: Math.max(0, Math.min(100, Math.round(Number(j.probability) || 0))),
        health: ['on track', 'at risk', 'stalled'].includes(j.health) ? j.health : 'at risk',
        reasons: Array.isArray(j.reasons) ? j.reasons.slice(0, 3).map(String) : [],
        risk: String(j.risk || ''), next: String(j.next || ''),
      } });
    } finally { setScoring((s) => ({ ...s, [d.id]: false })); }
  };
  const rescore = async () => {
    setError('');
    const open_ = deals.filter((d) => d.stage !== 'Won');
    const res = await pool(open_.map((d) => () => score(d)), 4);
    const bad = res.filter((r) => !r.ok);
    if (bad.length) setError(`${bad.length} deal(s) could not be scored: ${bad[0].error.message}`);
  };
  const busy = Object.values(scoring).some(Boolean);
  const openDeals = deals.filter((d) => d.stage !== 'Won');
  const pipeline = openDeals.reduce((a, d) => a + d.value, 0);
  const forecast = openDeals.reduce((a, d) => a + (d.value * odds(d)) / 100, 0);
  const atRisk = openDeals.filter((d) => d.ai && d.ai.health !== 'on track').length;
  const deal = deals.find((d) => d.id === open);
  const q = find.trim().toLowerCase();
  const shown = deals.filter((d) => (!owner || d.owner === owner) && (!q || `${d.company} ${d.contact} ${d.notes.join(' ')}`.toLowerCase().includes(q)));
  const owners = [...new Set(deals.map((d) => d.owner))];

  const importCsv = async (file) => {
    if (!file) return;
    try {
      const [head, ...rows] = parseCsv(await readText(file));
      const col = (...names) => head.findIndex((h) => names.includes(h.trim().toLowerCase()));
      const at = { company: col('company', 'account', 'organisation', 'organization', 'name'), contact: col('contact', 'person', 'contact name'), role: col('role', 'title', 'job title'), value: col('value', 'amount', 'deal value', 'arr'), stage: col('stage', 'status'), notes: col('notes', 'note', 'activity', 'description'), owner: col('owner', 'rep') };
      if (at.company < 0) throw new Error('needs a "company" column');
      const added = rows.map((r, i) => {
        const stage = STAGES.find((st) => st.toLowerCase() === String(r[at.stage] || '').trim().toLowerCase()) || 'Prospect';
        return { id: `i${Date.now().toString(36)}${i}`, company: r[at.company].trim(), contact: at.contact >= 0 ? r[at.contact] : '', role: at.role >= 0 ? r[at.role] : '', value: at.value >= 0 ? Number(String(r[at.value]).replace(/[^\d.]/g, '')) || 0 : 0, stage, owner: (at.owner >= 0 && r[at.owner]) ? String(r[at.owner]).slice(0, 3).toUpperCase() : 'ME', touched: 0, notes: at.notes >= 0 && r[at.notes] ? String(r[at.notes]).split(/\s*[|\n]\s*/).filter(Boolean) : [] };
      }).filter((d) => d.company);
      setDeals((ds) => [...ds, ...added]);
      setMsg(`Imported ${added.length} deals from ${file.name}.`);
    } catch (e) { setMsg(`Could not import: ${e.message}`); }
  };
  const exportCsv = () => download('kestrel-deals.csv', toCsv(['company', 'contact', 'role', 'value', 'stage', 'owner', 'win_chance', 'health', 'next', 'notes'], deals.map((d) => ({ ...d, win_chance: odds(d), health: d.ai ? d.ai.health : '', next: d.ai ? d.ai.next : '', notes: d.notes.join(' | ') }))), 'text/csv');

  const drop = (stage) => {
    if (drag) patch(drag, { stage, ai: undefined });
    setDrag(null);
  };

  return (
    <div className="ks">
      <aside className="ks-side">
        <div className="ks-brand"><KestrelLogo size={30} /><span>{'Kestrel'}</span></div>
        <nav className="ks-nav">
          <button type="button" className={view === 'pipeline' ? 'on' : ''} onClick={() => setView('pipeline')}><Icon d="M3 4h4v16H3zM10 4h4v10h-4zM17 4h4v6h-4z" />{'Pipeline'}</button>
          <button type="button" className={view === 'forecast' ? 'on' : ''} onClick={() => setView('forecast')}><Icon d="M3 20h18M5 16l5-6 4 3 5-7" />{'Forecast'}</button>
        </nav>
        <div className="ks-team">
          <span className="ks-cap">{'Team'}</span>
          {[['MR', 'Marta Rossi'], ['AK', 'Aisha Khan'], ['JL', 'Jonas Lind']].map(([i, n]) => <div key={i} className="ks-person"><span className="ks-av">{i}</span>{n}</div>)}
        </div>
        <div className="ks-ai">
          <span className="ks-cap">{'Kestrel AI'}</span>
          {net.key ? (
            <>
              <span className="ks-ai-on"><i />{'Connected'}</span>
              <select value={net.model} onChange={(e) => net.setModel(e.target.value)} aria-label="Model">
                {net.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </>
          ) : <span className="ks-ai-off">{'Not connected'}</span>}
          <span className="ks-powered">{'powered by Resonance'}</span>
        </div>
      </aside>

      <main className="ks-main">
        <header className="ks-top">
          <div>
            <span className="ks-cap">{view === 'pipeline' ? 'Q1 · New business' : 'Q1 · Forecast'}</span>
            <h1>{view === 'pipeline' ? 'Pipeline' : 'Forecast'}</h1>
          </div>
          <div className="ks-actions">
            <button type="button" className="ks-btn" onClick={() => setAdding(true)}>{'+ Deal'}</button>
            <label className="ks-btn ks-file">{'Import CSV'}<input type="file" accept=".csv,text/csv" onChange={(e) => importCsv(e.target.files[0])} /></label>
            <button type="button" className="ks-btn" onClick={exportCsv}>{'Export'}</button>
            <button type="button" className="ks-btn" disabled={!net.ready || !openDeals.some((d) => d.touched >= 7)} onClick={() => setSweep({})} title="Draft a follow-up for every deal untouched for a week or more">{`Sweep stale · ${openDeals.filter((d) => d.touched >= 7).length}`}</button>
            <button type="button" className="ks-btn ks-primary" disabled={!net.ready || busy || !openDeals.length} onClick={rescore}>
              {busy ? `Scoring ${Object.values(scoring).filter(Boolean).length} deals…` : 'Rescore pipeline'}
            </button>
          </div>
        </header>
        <div className="ks-filter">
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search deals, contacts, notes…" aria-label="Search deals" />
          <div className="ks-owners" role="group" aria-label="Owner">
            <button type="button" className={owner ? '' : 'on'} onClick={() => setOwner('')}>{'All'}</button>
            {owners.map((o) => <button type="button" key={o} className={owner === o ? 'on' : ''} onClick={() => setOwner(owner === o ? '' : o)}>{o}</button>)}
          </div>
          <button type="button" className="ks-link" onClick={() => { if (window.confirm('Reset Kestrel to the sample pipeline? Your deals and scores here will be replaced.')) { setDeals(SEED); setOpen(null); setMsg('Back to the sample pipeline.'); } }}>{'Reset sample'}</button>
        </div>
        {msg && <p className="ks-msg">{msg}</p>}

        {net.loaded && !net.key && <Connect net={net} />}
        {error && <p className="ks-err">{error}</p>}

        <section className="ks-kpis">
          <Kpi label="Open pipeline" value={eur(pipeline)} sub={`${openDeals.length} deals`} />
          <Kpi label="Weighted forecast" value={eur(forecast)} sub={`${openDeals.filter((d) => d.ai).length} of ${openDeals.length} scored by AI`} />
          <Kpi label="Avg. win chance" value={`${openDeals.length ? Math.round(openDeals.reduce((a, d) => a + odds(d), 0) / openDeals.length) : 0}%`} sub="AI where scored, stage odds elsewhere" />
          <Kpi label="Needs attention" value={String(atRisk)} sub="at risk or stalled" tone={atRisk ? 'warn' : ''} />
        </section>

        {view === 'pipeline' ? (
          <div className="ks-board">
            {STAGES.map((st) => {
              const col = shown.filter((d) => d.stage === st);
              return (
                <div key={st} className={`ks-col${drag ? ' ks-droppable' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(st)}>
                  <div className="ks-col-h"><b>{st}</b><span>{eur(col.reduce((a, d) => a + d.value, 0))}</span></div>
                  {col.map((d) => (
                    <button
                      type="button" key={d.id} draggable className={`ks-card${open === d.id ? ' on' : ''}`}
                      onDragStart={() => setDrag(d.id)} onDragEnd={() => setDrag(null)} onClick={() => setOpen(d.id)}
                    >
                      <span className="ks-card-h"><b>{d.company}</b><span className="ks-av sm">{d.owner}</span></span>
                      <span className="ks-dim">{`${d.contact} · ${eur(d.value)}`}</span>
                      <Odds deal={d} busy={scoring[d.id]} />
                      {d.ai && d.ai.health !== 'on track' && <span className={`ks-flag ${d.ai.health.replace(' ', '-')}`}>{d.ai.risk || d.ai.health}</span>}
                      <span className="ks-touch">{d.touched > 7 ? `⚠ ${d.touched}d since last touch` : `${d.touched}d ago`}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ) : <Forecast deals={deals} net={net} />}
        <p className="ks-hint">{'Drag a deal to another stage — its AI score resets, since the context changed.'}</p>
      </main>

      {deal && <DealSheet deal={deal} net={net} patch={patch} score={score} scoring={scoring[deal.id]} onDelete={() => { setDeals((ds) => ds.filter((d) => d.id !== deal.id)); setOpen(null); }} onClose={() => setOpen(null)} />}
      {adding && <NewDeal owners={owners} onAdd={(d) => { setDeals((ds) => [...ds, d]); setAdding(false); setOpen(d.id); }} onClose={() => setAdding(false)} />}
      {sweep && <Sweep deals={deals} net={net} onClose={() => setSweep(null)} onLog={(d, r) => patch(d.id, { touched: 0, notes: [...d.notes, `Follow-up sent: "${r.subject}"`], ai: undefined })} />}
      <DevPanel net={net} app="Kestrel CRM" how={HOW} slug="crm" />
    </div>
  );
}

function Connect({ net }) {
  const [k, setK] = useState('');
  return (
    <form className="ks-connect" onSubmit={(e) => { e.preventDefault(); net.setKey(k); }}>
      <div>
        <b>{'Switch on Kestrel AI'}</b>
        <p>{'Scoring, call notes, follow-ups and forecasts run on the Resonance network. Paste your node key ('}<code>{'resonance api-key'}</code>{') or a logical node key — it stays in this browser.'}</p>
      </div>
      <div className="ks-connect-row">
        <input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="rk_…" aria-label="Resonance API key" autoComplete="off" />
        <button type="submit" className="ks-btn ks-primary" disabled={!k.trim()}>{'Connect'}</button>
      </div>
    </form>
  );
}

function Kpi({ label, value, sub, tone = '' }) {
  return <div className={`ks-kpi ${tone}`}><span className="ks-cap">{label}</span><b>{value}</b><span className="ks-dim">{sub}</span></div>;
}

function Odds({ deal, busy }) {
  const p = odds(deal);
  return (
    <span className={`ks-odds${busy ? ' busy' : ''}`}>
      <span className="ks-odds-track"><span className={`ks-odds-fill${deal.ai ? ' ai' : ''}`} style={{ width: `${p}%` }} /></span>
      <span className="ks-odds-n">{busy ? '…' : `${p}%${deal.ai ? '' : ' est.'}`}</span>
    </span>
  );
}

function NewDeal({ owners, onAdd, onClose }) {
  const [f, setF] = useState({ company: '', contact: '', role: '', value: '', stage: 'Prospect', owner: owners[0] || 'ME', note: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="ks-sheet-wrap" onClick={onClose}>
      <form className="ks-sheet ks-new" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onAdd({ id: `n${Date.now().toString(36)}`, company: f.company.trim(), contact: f.contact.trim(), role: f.role.trim(), value: Number(f.value) || 0, stage: f.stage, owner: f.owner.trim().slice(0, 3).toUpperCase() || 'ME', touched: 0, notes: f.note.trim() ? [f.note.trim()] : [] }); }}>
        <header className="ks-sheet-h"><div><span className="ks-cap">{'Pipeline'}</span><h2>{'New deal'}</h2></div><button type="button" className="ks-close" onClick={onClose} aria-label="Close">{'×'}</button></header>
        <div className="ks-sheet-b">
          <label className="ks-field"><span>{'Company'}</span><input className="ks-input" value={f.company} onChange={set('company')} required /></label>
          <div className="ks-two">
            <label className="ks-field"><span>{'Contact'}</span><input className="ks-input" value={f.contact} onChange={set('contact')} /></label>
            <label className="ks-field"><span>{'Role'}</span><input className="ks-input" value={f.role} onChange={set('role')} /></label>
          </div>
          <div className="ks-two">
            <label className="ks-field"><span>{'Value (€)'}</span><input className="ks-input" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" /></label>
            <label className="ks-field"><span>{'Stage'}</span><select className="ks-input" value={f.stage} onChange={set('stage')}>{STAGES.map((st) => <option key={st}>{st}</option>)}</select></label>
          </div>
          <label className="ks-field"><span>{'Owner (initials)'}</span><input className="ks-input" value={f.owner} onChange={set('owner')} maxLength={3} /></label>
          <label className="ks-field"><span>{'What do you know so far?'}</span><textarea className="ks-input" rows={4} value={f.note} onChange={set('note')} placeholder="e.g. Met at a trade fair, wants a demo for 20 seats in May." /></label>
          <button type="submit" className="ks-btn ks-primary" disabled={!f.company.trim()}>{'Add deal'}</button>
        </div>
      </form>
    </div>
  );
}

function DealSheet({ deal, net, patch, score, scoring, onDelete, onClose }) {
  const [tab, setTab] = useState('coach');
  const [note, setNote] = useState('');
  const [call, setCall] = useState('');
  const [facts, setFacts] = useState(null);
  const [mail, setMail] = useState('');
  const [goal, setGoal] = useState('book the next meeting');
  const [tone, setTone] = useState('warm');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const stop = useRef(null);

  const run = async (kind, fn) => {
    setError(''); setBusy(kind);
    try { await fn(); } catch (e) { if (e.name !== 'AbortError') setError(e.message); } finally { setBusy(''); stop.current = null; }
  };
  const extract = () => run('extract', async () => {
    setFacts(null);
    const j = await chatJson({ ...net.call, maxTokens: 450, messages: [{ role: 'system', content: EXTRACT }, { role: 'user', content: call }] });
    setFacts(j);
  });
  const apply = () => {
    const merged = { ...(deal.facts || {}) };
    ['budget', 'timeline', 'next_step'].forEach((k) => { if (facts[k]) merged[k] = facts[k]; });
    ['decision_makers', 'objections', 'pains'].forEach((k) => { if (Array.isArray(facts[k]) && facts[k].length) merged[k] = [...new Set([...(merged[k] || []), ...facts[k]])]; });
    patch(deal.id, { facts: merged, notes: [...deal.notes, `Call: ${facts.summary || 'notes logged'}`], touched: 0, ai: undefined });
    setFacts(null); setCall(''); setTab('coach');
  };
  const compose = () => run('mail', async () => {
    const ctl = new AbortController(); stop.current = ctl; setMail('');
    await chat({
      ...net.call, signal: ctl.signal, maxTokens: 400,
      messages: [
        { role: 'system', content: `You write short B2B emails (under 130 words, with a subject line). Tone: ${tone}. Goal: ${goal}. Use only facts from the deal; never invent prices, dates or names.` },
        { role: 'user', content: brief(deal) },
      ],
      onDelta: (_, all) => setMail(all),
    });
  });

  const ai = deal.ai;
  return (
    <div className="ks-sheet-wrap" onClick={onClose}>
      <section className="ks-sheet" onClick={(e) => e.stopPropagation()} aria-label={`${deal.company} deal`}>
        <header className="ks-sheet-h">
          <div>
            <span className="ks-cap ks-stagepick">
              <select value={deal.stage} onChange={(e) => patch(deal.id, { stage: e.target.value, ai: undefined })} aria-label="Stage">{STAGES.map((st) => <option key={st}>{st}</option>)}</select>
              {` · owner ${deal.owner} · `}
              <button type="button" className="ks-link" onClick={() => { if (window.confirm(`Delete ${deal.company}?`)) onDelete(); }}>{'delete'}</button>
            </span>
            <h2>{deal.company}</h2>
            <span className="ks-dim">{`${deal.contact}, ${deal.role} · ${eur(deal.value)}`}</span>
          </div>
          <button type="button" className="ks-close" onClick={onClose} aria-label="Close">{'×'}</button>
        </header>
        <nav className="ks-tabs">
          {[['coach', 'Deal coach'], ['timeline', 'Timeline'], ['call', 'Call notes'], ['mail', 'Follow-up']].map(([id, l]) => (
            <button type="button" key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{l}</button>
          ))}
        </nav>
        <div className="ks-sheet-b">
          {error && <p className="ks-err">{error}</p>}

          {tab === 'coach' && (
            ai ? (
              <div className="ks-coach">
                <div className="ks-ring" style={{ '--p': ai.probability }}><b>{`${ai.probability}%`}</b><span>{'to close in 60 days'}</span></div>
                <div>
                  <span className={`ks-flag ${ai.health.replace(' ', '-')}`}>{ai.health}</span>
                  <ul className="ks-reasons">{ai.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                  {ai.risk && <p><b>{'Biggest risk. '}</b>{ai.risk}</p>}
                  {ai.next && <p className="ks-next"><b>{'Next best action. '}</b>{ai.next}</p>}
                </div>
                <button type="button" className="ks-btn" disabled={!net.ready || scoring} onClick={() => run('score', () => score(deal))}>{scoring ? 'Re-scoring…' : 'Re-score'}</button>
              </div>
            ) : (
              <div className="ks-empty">
                <p>{'No AI read on this deal yet. The coach weighs the activity, stage, value and silence into a win probability, the biggest risk and the next best action.'}</p>
                <button type="button" className="ks-btn ks-primary" disabled={!net.ready || scoring} onClick={() => run('score', () => score(deal))}>{scoring ? 'Scoring…' : 'Score this deal'}</button>
              </div>
            )
          )}
          {tab === 'coach' && deal.facts && (
            <dl className="ks-facts">
              {Object.entries(deal.facts).map(([k, v]) => <React.Fragment key={k}><dt>{k.replace('_', ' ')}</dt><dd>{Array.isArray(v) ? v.join(' · ') : v}</dd></React.Fragment>)}
            </dl>
          )}

          {tab === 'timeline' && (
            <>
              <ol className="ks-timeline">{[...deal.notes].reverse().map((n, i) => <li key={i}>{n}</li>)}</ol>
              <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) { patch(deal.id, { notes: [...deal.notes, note.trim()], touched: 0, ai: undefined }); setNote(''); } }}>
                <input className="ks-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Log a call, email or meeting and press Enter" />
              </form>
            </>
          )}

          {tab === 'call' && (
            <>
              <p className="ks-dim">{'Paste raw notes or a transcript. Kestrel pulls out the fields a CRM needs and writes them to the deal.'}</p>
              <textarea className="ks-input ks-area" value={call} onChange={(e) => setCall(e.target.value)} placeholder="Call notes…" rows={7} />
              <div className="ks-row">
                <button type="button" className="ks-btn" onClick={() => setCall(SAMPLE_CALL)}>{'Use sample notes'}</button>
                <button type="button" className="ks-btn ks-primary" disabled={!net.ready || !call.trim() || busy} onClick={extract}>{busy === 'extract' ? 'Extracting…' : 'Extract fields'}</button>
              </div>
              {facts && (
                <div className="ks-extract">
                  <p><b>{facts.summary}</b></p>
                  <dl className="ks-facts">
                    {['budget', 'timeline', 'decision_makers', 'pains', 'objections', 'next_step'].map((k) => (
                      <React.Fragment key={k}><dt>{k.replace('_', ' ')}</dt><dd>{Array.isArray(facts[k]) ? (facts[k].join(' · ') || '—') : (facts[k] || '—')}</dd></React.Fragment>
                    ))}
                  </dl>
                  <button type="button" className="ks-btn ks-primary" onClick={apply}>{'Apply to deal'}</button>
                </div>
              )}
            </>
          )}

          {tab === 'mail' && (
            <>
              <div className="ks-row ks-wrap">
                <label className="ks-sel"><span>{'Goal'}</span>
                  <select value={goal} onChange={(e) => setGoal(e.target.value)}>
                    <option>{'book the next meeting'}</option><option>{'re-engage after silence'}</option><option>{'recap the proposal'}</option><option>{'answer the open objection'}</option>
                  </select>
                </label>
                <label className="ks-sel"><span>{'Tone'}</span>
                  <select value={tone} onChange={(e) => setTone(e.target.value)}>
                    <option>{'warm'}</option><option>{'formal'}</option><option>{'direct'}</option>
                  </select>
                </label>
                {busy === 'mail'
                  ? <button type="button" className="ks-btn" onClick={() => stop.current && stop.current.abort()}>{'Stop'}</button>
                  : <button type="button" className="ks-btn ks-primary" disabled={!net.ready} onClick={compose}>{mail ? 'Rewrite' : 'Write follow-up'}</button>}
              </div>
              {(mail || busy === 'mail') && (
                <div className="ks-mail">
                  <div className="ks-mail-h"><span>{`To: ${deal.contact}`}</span>{mail && busy !== 'mail' && <button type="button" className="ks-link" onClick={() => navigator.clipboard && navigator.clipboard.writeText(mail)}>{'Copy'}</button>}</div>
                  <div className="ks-mail-b">{mail}{busy === 'mail' && <span className="ks-caret" />}</div>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

// The stale-deal sweep: every open deal untouched for 7+ days gets its own follow-up draft,
// written in parallel, each from that deal's own history. Logging one resets its last touch.
const FOLLOW = 'You write sales follow-up emails that get replies: under 90 words, one specific reason to talk now taken from the deal\'s own history, one clear question, no pressure, no "just checking in". Reply ONLY with JSON: {"subject": string, "body": string (signed with just the first name of the deal owner)}.';
function Sweep({ deals, net, onLog, onClose }) {
  const stale = deals.filter((d) => d.stage !== 'Won' && d.touched >= 7).sort((a, b) => b.touched - a.touched);
  const [res, setRes] = useState({});
  const [started, setStarted] = useState(false);
  const run = async () => {
    setStarted(true);
    setRes(Object.fromEntries(stale.map((d) => [d.id, { pending: true }])));
    await pool(stale.map((d) => async () => {
      try {
        const j = await chatJson({ ...net.call, maxTokens: 300, temperature: 0.5, messages: [{ role: 'system', content: FOLLOW }, { role: 'user', content: `${brief(d)}\nOwner: ${d.owner}` }] });
        setRes((r) => ({ ...r, [d.id]: { subject: String(j.subject || ''), body: String(j.body || '') } }));
      } catch (e) { setRes((r) => ({ ...r, [d.id]: { error: e.message } })); }
    }), 4);
  };
  return (
    <div className="ks-sheet-wrap" onClick={onClose}>
      <div className="ks-sheet ks-sweep" onClick={(e) => e.stopPropagation()}>
        <header className="ks-sheet-h"><div><span className="ks-cap">{'Pipeline'}</span><h2>{`Stale deals · ${stale.length}`}</h2></div><button type="button" className="ks-close" onClick={onClose} aria-label="Close">{'×'}</button></header>
        <div className="ks-sheet-b">
          <p className="ks-dim">{'Deals with no activity for a week or more. One draft per deal, all written at once from each deal\'s own notes — read and edit before sending.'}</p>
          {!started && <button type="button" className="ks-btn ks-primary" disabled={!net.ready || !stale.length} onClick={run}>{`Draft ${stale.length} follow-ups`}</button>}
          <ul className="ks-sweep-l">
            {stale.map((d) => {
              const r = res[d.id];
              return (
                <li key={d.id}>
                  <div className="ks-row"><b>{d.company}</b><span className="ks-dim">{`${d.contact} · ${d.stage} · ${d.touched} days quiet`}</span></div>
                  {r && r.pending && <p className="ks-dim">{'Writing…'}</p>}
                  {r && r.error && <p className="ks-err">{r.error}</p>}
                  {r && r.body && (
                    <>
                      <p className="ks-sweep-s">{r.subject}</p>
                      <pre className="ks-sweep-b">{r.body}</pre>
                      <div className="ks-row">
                        <button type="button" className="ks-btn" onClick={() => navigator.clipboard && navigator.clipboard.writeText(`${r.subject}\n\n${r.body}`)}>{'Copy'}</button>
                        <button type="button" className="ks-btn" onClick={() => { onLog(d, r); setRes((x) => { const n = { ...x }; delete n[d.id]; return n; }); }}>{'Log as sent'}</button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Forecast({ deals, net }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rows = useMemo(() => STAGES.filter((s) => s !== 'Won').map((st) => {
    const ds = deals.filter((d) => d.stage === st);
    return { st, n: ds.length, value: ds.reduce((a, d) => a + d.value, 0), stageW: ds.reduce((a, d) => a + (d.value * STAGE_ODDS[st]) / 100, 0), aiW: ds.reduce((a, d) => a + (d.value * odds(d)) / 100, 0) };
  }), [deals]);
  const max = Math.max(...rows.map((r) => r.value), 1);
  const tot = rows.reduce((a, r) => ({ value: a.value + r.value, stageW: a.stageW + r.stageW, aiW: a.aiW + r.aiW }), { value: 0, stageW: 0, aiW: 0 });
  const write = async () => {
    setError(''); setBusy(true); setText('');
    const lines = deals.filter((d) => d.stage !== 'Won').map((d) => `${d.company}: ${d.stage}, ${eur(d.value)}, ${d.ai ? `AI ${d.ai.probability}% (${d.ai.health}; risk: ${d.ai.risk})` : `not scored (stage odds ${STAGE_ODDS[d.stage]}%)`}`).join('\n');
    try {
      await chat({
        ...net.call, maxTokens: 450,
        messages: [
          { role: 'system', content: 'You are a VP of Sales writing the weekly forecast brief for the leadership team: 4 short paragraphs — headline number and confidence, the 2-3 deals that decide the quarter, the main risks, and what the team does this week. No tables, no invented facts.' },
          { role: 'user', content: `Open pipeline ${eur(tot.value)}; stage-weighted ${eur(tot.stageW)}; AI-weighted ${eur(tot.aiW)}.\nDeals:\n${lines}` },
        ],
        onDelta: (_, all) => setText(all),
      });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="ks-fc">
      <div className="ks-table-wrap">
      <table className="ks-table">
        <thead><tr><th>{'Stage'}</th><th>{'Deals'}</th><th>{'Pipeline'}</th><th>{'Stage odds'}</th><th>{'AI-weighted'}</th><th aria-label="Chart" /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.st}>
              <td>{r.st}</td><td>{r.n}</td><td>{eur(r.value)}</td><td>{eur(r.stageW)}</td><td><b>{eur(r.aiW)}</b></td>
              <td className="ks-bars"><span className="b1" style={{ width: `${(r.value / max) * 100}%` }} /><span className="b2" style={{ width: `${(r.aiW / max) * 100}%` }} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td>{'Total'}</td><td /><td>{eur(tot.value)}</td><td>{eur(tot.stageW)}</td><td><b>{eur(tot.aiW)}</b></td><td /></tr></tfoot>
      </table>
      </div>
      <p className="ks-dim">{'Stage odds use fixed percentages per stage; AI-weighted uses each deal\'s scored probability. Rescore the pipeline to see them diverge.'}</p>
      <div className="ks-brief">
        <div className="ks-row"><h3>{'Forecast brief'}</h3><button type="button" className="ks-btn ks-primary" disabled={!net.ready || busy} onClick={write}>{busy ? 'Writing…' : text ? 'Rewrite' : 'Write the brief'}</button></div>
        {error && <p className="ks-err">{error}</p>}
        {text || busy ? <div className="ks-brief-b">{text}{busy && <span className="ks-caret" />}</div> : <p className="ks-dim">{'A one-page narrative for leadership, written from the numbers and the AI\'s read on each deal.'}</p>}
      </div>
    </div>
  );
}

function Icon({ d }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d={d} /></svg>;
}
