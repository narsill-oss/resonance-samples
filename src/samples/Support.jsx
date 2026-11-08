import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSeo } from '@shared/lib/useSeo';
import { chat, chatJson, pool } from './api';
import { DevPanel, settled, useMedia, useNetwork, useStored } from './network';
import { RelayLogo } from './logos';
import './support.css';

// Relay — a support desk whose autopilot runs on the Resonance network: parallel triage,
// incident detection across tickets, translation and replies in the customer's language.
// The tickets are sample data.
const TICKETS = [
  { id: 'R-2041', name: 'Kate Moreno', email: 'kate@brightmills.io', company: 'Brightmills', plan: 'Pro', channel: 'email', ago: 95, subject: 'Charged twice this month', body: 'Hi, my card was charged twice for the Pro plan on the 3rd. Can you refund the duplicate? This is the second time it happens.' },
  { id: 'R-2042', name: 'Tom Hale', email: 'tom@harbor.dev', company: 'Harbor', plan: 'Enterprise', channel: 'email', ago: 40, subject: 'API returns 500 on large uploads', body: 'Since yesterday every upload over 50 MB fails with a 500. Our nightly import is blocked and customers are waiting.' },
  { id: 'R-2043', name: 'Medline Ops', email: 'ops@medline.health', company: 'Medline', plan: 'Enterprise', channel: 'chat', ago: 18, subject: 'Cannot log in — SSO broken', body: 'None of our 40 users can sign in through SSO since this morning. We get "invalid assertion". Urgent.' },
  { id: 'R-2044', name: 'Jürgen Weber', email: 'j.weber@weber-logistik.de', company: 'Weber Logistik', plan: 'Business', channel: 'email', ago: 26, subject: 'Anmeldung über SSO funktioniert nicht', body: 'Seit heute Morgen schlägt die Anmeldung über SSO für unser ganzes Team fehl. Fehlermeldung: "invalid assertion". Bitte um schnelle Hilfe.' },
  { id: 'R-2045', name: 'Lena Krause', email: 'lena@studio-k.de', company: 'Studio K', plan: 'Free', channel: 'chat', ago: 210, subject: 'How do I export my data?', body: 'Is there a way to export all projects to CSV? I could not find it in the settings.' },
  { id: 'R-2046', name: 'Raj Patel', email: 'raj@finch.co', company: 'Finch', plan: 'Pro', channel: 'email', ago: 300, subject: 'Love the new dashboard', body: 'Just wanted to say the new dashboard is great. Small idea: a dark mode for the charts would be awesome.' },
  { id: 'R-2047', name: 'Chiara Russo', email: 'chiara@russoefigli.it', company: 'Russo & Figli', plan: 'Business', channel: 'chat', ago: 12, subject: 'Accesso SSO bloccato', body: 'Da stamattina non riusciamo ad accedere con il single sign-on, compare l\'errore "invalid assertion". Siamo fermi, potete aiutarci?' },
  { id: 'R-2048', name: 'Paul Girard', email: 'paul@woodcraft.fr', company: 'Woodcraft', plan: 'Pro', channel: 'email', ago: 380, subject: 'Adresse de facturation', body: 'Bonjour, merci d\'envoyer les factures à comptabilite@woodcraft.fr à partir du mois prochain.' },
  { id: 'R-2049', name: 'Mia Lund', email: 'mia@nordlight.se', company: 'Nordlight', plan: 'Pro', channel: 'email', ago: 150, subject: 'Webhooks arrive late', body: 'Webhook events have been delayed by 10-15 minutes since the weekend. Not critical, but it breaks our sync.' },
  { id: 'R-2050', name: 'Diego Ramírez', email: 'diego@andescoffee.co', company: 'Andes Coffee', plan: 'Pro', channel: 'email', ago: 64, subject: 'IVA duplicado en la factura', body: 'Hola, la factura de este mes muestra el IVA dos veces. ¿Pueden corregirla y enviarme una nueva?' },
];
const PLAN_RANK = { Enterprise: 0, Business: 1, Pro: 2, Free: 3 };
const TARGET = { P1: 60, P2: 240, P3: 1440 }; // first-response minutes
const target = (t, tri) => (tri && tri.priority ? (tri.priority === 'P1' && t.plan === 'Enterprise' ? 30 : TARGET[tri.priority]) : null);

const TRIAGE = 'You triage customer support tickets. Reply ONLY with JSON: {"category": "billing" | "bug" | "outage" | "how-to" | "account" | "feedback", "priority": "P1" | "P2" | "P3", "sentiment": "angry" | "frustrated" | "neutral" | "happy", "language": <the language the customer wrote in, in English, e.g. "German">, "summary": <English, max 12 words>, "macro": <the best canned action, 2-4 words>}. P1 = outage or many users blocked; P2 = one customer blocked or money involved; P3 = everything else.';
const INCIDENTS = 'You look for incidents: several tickets caused by the SAME underlying problem. Reply ONLY with JSON: {"incidents": [{"title": <short>, "ticket_ids": [<ids>], "severity": "major" | "minor", "hypothesis": <one sentence on the likely cause>}]}. Only groups of 2 or more tickets; an empty list if there are none.';

const HOW = (
  <>
    <p>{'Relay\'s autopilot is a small pipeline on '}<code>{'POST /v1/chat/completions'}</code>{':'}</p>
    <ol>
      <li><b>{'Map'}</b>{' — one triage request per ticket, five at a time, each returning JSON (category, priority, sentiment, language, summary). They run side by side on the network.'}</li>
      <li><b>{'Reduce'}</b>{' — one request reads every triage summary and groups tickets that share a cause into incidents. Three customers writing in three languages about "invalid assertion" become one SSO incident.'}</li>
      <li><b>{'Reply to all affected'}</b>{' — from an incident, one reply per affected ticket, each in that customer\'s language, all drafted at once.'}</li>
      <li><b>{'Act'}</b>{' — streamed translation, a reply drafted in the customer\'s own language that knows about the incident, and a status-page update.'}</li>
    </ol>
    <h4>{'Keyboard'}</h4>
    <p><code>{'j'}</code>{' / '}<code>{'k'}</code>{' move · '}<code>{'r'}</code>{' draft a reply · '}<code>{'e'}</code>{' resolve'}</p>
    <h4>{'Make it yours'}</h4>
    <p>{'Point TICKETS at your helpdesk API (Zendesk, Front, your own inbox) and run the triage on a schedule from a server holding a logical node key.'}</p>
  </>
);

export default function Support() {
  useSeo({ title: 'Relay support desk · a Resonance sample', description: 'A support desk whose autopilot — parallel triage, incident detection, translation and replies — runs on the Resonance network.', path: '/samples/support' });
  const net = useNetwork({ prefer: 'text-generation' });
  // Tickets, triage, incidents and resolutions are kept in this browser; new tickets age from
  // when they were added.
  const [tickets, setTickets] = useStored('relay.tickets', TICKETS, (ts) => ts.map((t) => (t.at ? { ...t, ago: Math.max(0, Math.round((Date.now() - t.at) / 60000)) } : t)));
  const [tri, setTri] = useStored('relay.triage', {}, settled);
  const [incidents, setIncidents] = useStored('relay.incidents', []);
  const [resolved, setResolved] = useStored('relay.resolved', {});
  const [view, setView] = useState('open');
  const [focus, setFocus] = useState(null); // incident title filter
  const [sel, setSel] = useState(TICKETS[2].id);
  const [composing, setComposing] = useState(false);
  const [phase, setPhase] = useState(''); // '' | 'triage' | 'incidents'
  const [error, setError] = useState('');
  const replyRef = useRef(null);
  const narrow = useMedia('(max-width: 1180px)');
  const phone = useMedia('(max-width: 760px)');
  const [pane, setPane] = useState('list'); // phones show one pane at a time

  const queue = useMemo(() => {
    let list = tickets.filter((t) => (view === 'open' ? !resolved[t.id] : resolved[t.id]));
    if (focus) { const inc = incidents.find((i) => i.title === focus); if (inc) list = list.filter((t) => inc.ticket_ids.includes(t.id)); }
    const left = (t) => { const g = target(t, tri[t.id]); return g == null ? 1e9 : g - t.ago; };
    return [...list].sort((a, b) => left(a) - left(b) || PLAN_RANK[a.plan] - PLAN_RANK[b.plan] || a.ago - b.ago);
  }, [view, resolved, focus, incidents, tri]);
  const ticket = tickets.find((t) => t.id === sel) || queue[0];

  const triageOne = async (t) => {
    setTri((s) => ({ ...s, [t.id]: { pending: true } }));
    try {
      const j = await chatJson({ ...net.call, maxTokens: 220, messages: [{ role: 'system', content: TRIAGE }, { role: 'user', content: `${t.id} from ${t.name} (${t.plan} plan)\nSubject: ${t.subject}\n\n${t.body}` }] });
      setTri((s) => ({ ...s, [t.id]: j }));
      return j;
    } catch (e) { setTri((s) => ({ ...s, [t.id]: { error: e.message } })); throw e; }
  };
  // Reduce: one call over every triaged ticket finds the ones that share a cause.
  const findIncidents = async (pairs) => {
    if (pairs.length < 2) return;
    setPhase('incidents');
    try {
      const j = await chatJson({ ...net.call, maxTokens: 400, messages: [{ role: 'system', content: INCIDENTS }, { role: 'user', content: pairs.map(([t, r]) => `${t.id}: [${r.category}/${r.priority}] ${r.summary} — original subject "${t.subject}"`).join('\n') }] });
      const ids = new Set(pairs.map(([t]) => t.id));
      setIncidents((Array.isArray(j.incidents) ? j.incidents : []).map((i) => ({ ...i, ticket_ids: (i.ticket_ids || []).filter((x) => ids.has(x)) })).filter((i) => i.ticket_ids.length >= 2));
    } catch (e) { setError(e.message); }
  };
  const autopilot = async () => {
    setError(''); setIncidents([]); setFocus(null); setPhase('triage');
    const open = tickets.filter((t) => !resolved[t.id]);
    const res = await pool(open.map((t) => () => triageOne(t)), 5);
    const bad = res.filter((r) => !r.ok);
    if (bad.length) setError(`${bad.length} ticket(s) failed to triage: ${bad[0].error.message}`);
    await findIncidents(open.map((t, i) => [t, res[i]]).filter(([, r]) => r.ok).map(([t, r]) => [t, r.value]));
    setPhase('');
  };
  // A new ticket is triaged on arrival, then incidents are re-checked with it included.
  const addTicket = async (t) => {
    setTickets((ts) => [t, ...ts]); setSel(t.id); setComposing(false); setPane('conv'); setView('open');
    if (!net.ready) return;
    setError(''); setPhase('triage');
    try {
      const j = await triageOne(t);
      const pairs = [[t, j], ...tickets.filter((x) => !resolved[x.id] && tri[x.id] && tri[x.id].priority).map((x) => [x, tri[x.id]])];
      await findIncidents(pairs);
    } catch (e) { setError(e.message); }
    setPhase('');
  };
  const reset = () => { setTickets(TICKETS); setTri({}); setIncidents([]); setResolved({}); setFocus(null); setSel(TICKETS[2].id); };

  const resolve = (id) => {
    setResolved((r) => ({ ...r, [id]: r[id] || { at: Date.now(), reply: '' } }));
    const next = queue.find((t) => t.id !== id);
    if (next) setSel(next.id);
  };

  // j / k / r / e, unless you're typing
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const i = queue.findIndex((t) => t.id === (ticket && ticket.id));
      if (e.key === 'j' && queue[i + 1]) setSel(queue[i + 1].id);
      else if (e.key === 'k' && queue[i - 1]) setSel(queue[i - 1].id);
      else if (e.key === 'r' && replyRef.current) { e.preventDefault(); replyRef.current(); }
      else if (e.key === 'e' && ticket && view === 'open') resolve(ticket.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const triaged = tickets.filter((t) => tri[t.id] && tri[t.id].priority);
  const breached = triaged.filter((t) => !resolved[t.id] && target(t, tri[t.id]) - t.ago < 0).length;
  const incidentOf = (id) => incidents.find((i) => i.ticket_ids.includes(id));

  return (
    <div className={`rl${phone ? ` rl-phone rl-pane-${pane}` : ''}`}>
      <aside className="rl-rail">
        <div className="rl-logo" title="Relay"><RelayLogo size={38} /></div>
        <button type="button" className={view === 'open' ? 'on' : ''} onClick={() => setView('open')} title="Open"><span>{tickets.length - Object.keys(resolved).length}</span>{'Open'}</button>
        <button type="button" className={view === 'resolved' ? 'on' : ''} onClick={() => setView('resolved')} title="Resolved"><span>{Object.keys(resolved).length}</span>{'Done'}</button>
        <button type="button" className="rl-reset" onClick={() => { if (window.confirm('Reset Relay to the sample inbox? New tickets, triage and resolutions here will be cleared.')) reset(); }} title="Reset the sample inbox">{'↺'}<span className="rl-sr">{'Reset'}</span></button>
      </aside>

      <section className="rl-queue">
        <header className="rl-qh">
          <div className="rl-qh-t"><b>{view === 'open' ? 'Inbox' : 'Resolved'}</b><span>{`${queue.length} tickets`}</span></div>
          <button type="button" className="rl-new" onClick={() => setComposing(true)} title="Log a new ticket">{'+ New'}</button>
          <button type="button" className="rl-auto" disabled={!net.ready || Boolean(phase)} onClick={autopilot}>
            <i />{phase === 'triage' ? `Triaging ${triaged.length}/${tickets.length}` : phase === 'incidents' ? 'Finding incidents…' : 'Autopilot'}
          </button>
        </header>
        {net.loaded && !net.key && <Connect net={net} />}
        {triaged.length > 0 && (
          <div className="rl-meter">
            <span><b>{triaged.filter((t) => tri[t.id].priority === 'P1').length}</b>{' P1'}</span>
            <span><b>{new Set(triaged.map((t) => tri[t.id].language)).size}</b>{' languages'}</span>
            <span className={breached ? 'bad' : ''}><b>{breached}</b>{' SLA breached'}</span>
          </div>
        )}
        {incidents.map((inc) => (
          <button type="button" key={inc.title} className={`rl-inc ${inc.severity}${focus === inc.title ? ' on' : ''}`} onClick={() => setFocus(focus === inc.title ? null : inc.title)}>
            <span className="rl-inc-k">{`Incident · ${inc.ticket_ids.length} tickets`}</span>
            <b>{inc.title}</b>
            <span>{inc.hypothesis}</span>
          </button>
        ))}
        {error && <p className="rl-err">{error}</p>}
        <ol className="rl-list">
          {queue.map((t) => {
            const r = tri[t.id];
            const g = target(t, r);
            const left = g == null ? null : g - t.ago;
            return (
              <li key={t.id}>
                <button type="button" className={`rl-row${ticket && ticket.id === t.id ? ' on' : ''}`} onClick={() => { setSel(t.id); setPane('conv'); }}>
                  <span className="rl-row-a">
                    {r && r.priority ? <span className={`rl-p ${r.priority}`}>{r.priority}</span> : <span className={`rl-p${r && r.pending ? ' wait' : ''}`}>{r && r.pending ? '··' : '—'}</span>}
                    <b>{t.name}</b>
                    <span className="rl-ago">{ago(t.ago)}</span>
                  </span>
                  <span className="rl-row-s">{r && r.summary ? r.summary : t.subject}</span>
                  <span className="rl-row-m">
                    <span className="rl-plan">{t.plan}</span>
                    {r && r.language && r.language !== 'English' && <span>{r.language}</span>}
                    {r && r.sentiment && <span className={`rl-sent ${r.sentiment}`}>{r.sentiment}</span>}
                    {left != null && !resolved[t.id] && <span className={left < 0 ? 'rl-sla bad' : left < 30 ? 'rl-sla warn' : 'rl-sla'}>{left < 0 ? `SLA −${dur(-left)}` : `SLA ${dur(left)}`}</span>}
                    {incidentOf(t.id) && <span className="rl-tag-inc">{'incident'}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      {ticket ? (
        <Conversation
          key={ticket.id} ticket={ticket} tri={tri[ticket.id]} incident={incidentOf(ticket.id)} net={net}
          done={resolved[ticket.id]} onResolve={(reply) => { setResolved((r) => ({ ...r, [ticket.id]: { at: Date.now(), reply } })); const n = queue.find((t) => t.id !== ticket.id); if (n) setSel(n.id); }}
          replyRef={replyRef} onBack={phone ? () => setPane('list') : null}
          extra={narrow ? <Copilot embedded ticket={ticket} tri={tri[ticket.id]} incident={incidentOf(ticket.id)} net={net} incidents={incidents} tickets={tickets} allTri={tri} /> : null}
        />
      ) : <section className="rl-conv rl-zero">{'Inbox zero.'}</section>}

      {composing && <NewTicket onAdd={addTicket} onClose={() => setComposing(false)} next={`R-${2050 + tickets.filter((t) => t.at).length + 1}`} />}
      {!narrow && <Copilot ticket={ticket} tri={ticket && tri[ticket.id]} incident={ticket && incidentOf(ticket.id)} net={net} incidents={incidents} tickets={tickets} allTri={tri} />}
      <DevPanel net={net} app="Relay" how={HOW} slug="support" />
    </div>
  );
}

/// Log a ticket by hand — paste a customer email or chat in any language.
function NewTicket({ onAdd, onClose, next }) {
  const [f, setF] = useState({ name: '', email: '', company: '', plan: 'Pro', channel: 'email', subject: '', body: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="rl-modal" onClick={onClose}>
      <form className="rl-newt" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onAdd({ ...f, id: next, name: f.name.trim() || f.email.trim() || 'Customer', ago: 0, at: Date.now() }); }}>
        <header><b>{'New ticket'}</b><span className="rl-mono">{next}</span><button type="button" className="rl-x" onClick={onClose} aria-label="Close">{'×'}</button></header>
        <div className="rl-grid2">
          <label><span>{'Name'}</span><input value={f.name} onChange={set('name')} /></label>
          <label><span>{'Email'}</span><input value={f.email} onChange={set('email')} type="email" /></label>
          <label><span>{'Company'}</span><input value={f.company} onChange={set('company')} /></label>
          <label><span>{'Plan'}</span><select value={f.plan} onChange={set('plan')}>{Object.keys(PLAN_RANK).map((p) => <option key={p}>{p}</option>)}</select></label>
        </div>
        <label><span>{'Subject'}</span><input value={f.subject} onChange={set('subject')} required /></label>
        <label><span>{'Message — any language'}</span><textarea rows={6} value={f.body} onChange={set('body')} required placeholder="Paste the customer's email or chat message" /></label>
        <div className="rl-newt-f"><span>{'It is triaged on arrival and checked against open incidents.'}</span><button type="submit" className="rl-auto" disabled={!f.subject.trim() || !f.body.trim()}>{'Add to inbox'}</button></div>
      </form>
    </div>
  );
}

function Connect({ net }) {
  const [k, setK] = useState('');
  return (
    <form className="rl-connect" onSubmit={(e) => { e.preventDefault(); net.setKey(k); }}>
      <b>{'Connect the autopilot'}</b>
      <span>{'Relay\'s AI runs on the Resonance network. Paste a node or logical node key.'}</span>
      <div><input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="rk_…" aria-label="Resonance API key" autoComplete="off" /><button type="submit" disabled={!k.trim()}>{'Connect'}</button></div>
    </form>
  );
}

function Conversation({ ticket, tri, incident, net, done, onResolve, replyRef, onBack, extra }) {
  const [trans, setTrans] = useState('');
  const [reply, setReply] = useState(done ? done.reply : '');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const foreign = tri && tri.language && tri.language !== 'English';

  const stream = (kind, messages, set) => async () => {
    setError(''); setBusy(kind); set('');
    try { await chat({ ...net.call, maxTokens: 420, messages, onDelta: (_, all) => set(all) }); } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const translate = stream('translate', [
    { role: 'system', content: 'Translate the customer message to English. Output only the translation.' },
    { role: 'user', content: `${ticket.subject}\n\n${ticket.body}` },
  ], setTrans);
  const draft = stream('draft', [
    { role: 'system', content: `You are a calm, precise support engineer at a SaaS company. Write the reply in ${foreign ? tri.language : 'the customer\'s language'}, under 110 words, signed "— Relay Support". Acknowledge the issue, say concretely what happens next, never promise timelines or refunds you can't confirm.${incident ? ` This ticket is part of a known incident: "${incident.title}" (${incident.hypothesis}). Say the team is on it and that they'll get an update, without technical speculation.` : ''}` },
    { role: 'user', content: `${tri && tri.priority ? `Triage: ${tri.priority}, ${tri.category}, customer seems ${tri.sentiment}.\n` : ''}From: ${ticket.name} (${ticket.plan} plan)\nSubject: ${ticket.subject}\n\n${ticket.body}` },
  ], setReply);
  replyRef.current = net.ready && !done ? draft : null;

  return (
    <section className="rl-conv">
      {onBack && <button type="button" className="rl-back" onClick={onBack}>{'← Inbox'}</button>}
      <header className="rl-ch">
        <div>
          <span className="rl-mono">{`${ticket.id} · ${ticket.channel} · ${ago(ticket.ago)} ago`}</span>
          <h1>{ticket.subject}</h1>
        </div>
        {!done && <button type="button" className="rl-ghost" onClick={() => onResolve(reply)}>{'Resolve '}<kbd>{'e'}</kbd></button>}
      </header>
      <article className="rl-msg">
        <div className="rl-msg-h"><span className="rl-avatar">{ticket.name[0]}</span><b>{ticket.name}</b><span>{`<${ticket.email}>`}</span></div>
        <p>{ticket.body}</p>
        {foreign && !trans && busy !== 'translate' && <button type="button" className="rl-ghost sm" disabled={!net.ready} onClick={translate}>{`Translate from ${tri.language}`}</button>}
        {(trans || busy === 'translate') && <p className="rl-trans"><span className="rl-mono">{'EN · machine translation'}</span>{trans}{busy === 'translate' && <i className="rl-caret" />}</p>}
      </article>
      {done && done.reply && <article className="rl-msg ours"><div className="rl-msg-h"><span className="rl-avatar us">{'R'}</span><b>{'Relay Support'}</b><span>{'sent'}</span></div><p>{done.reply}</p></article>}
      {error && <p className="rl-err">{error}</p>}
      {!done && (
        <div className="rl-compose">
          <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder={net.ready ? 'Write a reply, or press r to draft one…' : 'Write a reply…'} rows={7} />
          {busy === 'draft' && <i className="rl-caret in" />}
          <div className="rl-compose-f">
            <button type="button" className="rl-ghost" disabled={!net.ready || Boolean(busy)} onClick={draft}>{busy === 'draft' ? 'Drafting…' : reply ? 'Redraft ' : 'Draft with AI '}{busy !== 'draft' && <kbd>{'r'}</kbd>}</button>
            {foreign && <span className="rl-mono">{`replying in ${tri.language}`}</span>}
            <button type="button" className="rl-send" disabled={!reply.trim() || Boolean(busy)} onClick={() => onResolve(reply)}>{'Send & resolve'}</button>
          </div>
        </div>
      )}
      {extra}
    </section>
  );
}

function Copilot({ ticket, tri, incident, net, incidents, tickets, embedded, allTri = {} }) {
  const [status, setStatus] = useState('');
  // Everyone hit by the incident gets a reply in their own language — one call per ticket,
  // all at once. Drafts only: an agent reads and sends them.
  const [bulk, setBulk] = useState({}); // ticket id -> { pending } | { text } | { error }
  const replyAll = async () => {
    const inc = incident || incidents[0];
    const list = inc.ticket_ids.map((id) => tickets.find((t) => t.id === id)).filter(Boolean);
    setBulk(Object.fromEntries(list.map((t) => [t.id, { pending: true }])));
    await pool(list.map((t) => async () => {
      const lang = (allTri[t.id] && allTri[t.id].language) || 'the language the customer wrote in';
      try {
        const text = await chat({ ...net.call, maxTokens: 260, temperature: 0.4, messages: [
          { role: 'system', content: `You are a support engineer. Write a short reply (under 90 words) in ${lang}, signed "— Relay Support". The customer is affected by a known incident: "${inc.title}". Say the team is working on it, that they will get an update when it is fixed, and one thing they can do meanwhile if there is an obvious one. No guesses about the cause, no timelines.` },
          { role: 'user', content: `${t.name} (${t.company}, ${t.plan} plan) wrote:\n${t.subject}\n\n${t.body}` },
        ] });
        setBulk((b) => ({ ...b, [t.id]: { text } }));
      } catch (e) { setBulk((b) => ({ ...b, [t.id]: { error: e.message } })); }
    }), 5);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const write = async () => {
    setError(''); setBusy(true); setStatus('');
    const inc = incident || incidents[0];
    try {
      await chat({
        ...net.call, maxTokens: 300,
        messages: [
          { role: 'system', content: 'Write a public status-page update (under 80 words): a title line, what users experience, that the team is investigating, and when the next update comes ("within 30 minutes"). Calm and factual; no internal details, no guesses about the cause.' },
          { role: 'user', content: `Incident: ${inc.title}. Affected customers: ${inc.ticket_ids.length}. Symptoms from tickets: ${inc.ticket_ids.map((id) => tickets.find((t) => t.id === id)).filter(Boolean).map((t) => t.body).join(' | ')}` },
        ],
        onDelta: (_, all) => setStatus(all),
      });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <aside className={`rl-cop${embedded ? ' embedded' : ''}`}>
      <span className="rl-mono rl-cop-k">{'Copilot'}</span>
      {ticket && (
        <div className="rl-card">
          <span className="rl-mono">{'Customer'}</span>
          <b>{ticket.company}</b>
          <dl><dt>{'Plan'}</dt><dd>{ticket.plan}</dd><dt>{'Contact'}</dt><dd>{ticket.name}</dd><dt>{'Channel'}</dt><dd>{ticket.channel}</dd></dl>
        </div>
      )}
      <div className="rl-card">
        <span className="rl-mono">{'Triage'}</span>
        {tri && tri.priority ? (
          <dl>
            <dt>{'Priority'}</dt><dd><span className={`rl-p ${tri.priority}`}>{tri.priority}</span></dd>
            <dt>{'Category'}</dt><dd>{tri.category}</dd>
            <dt>{'Sentiment'}</dt><dd className={`rl-sent ${tri.sentiment}`}>{tri.sentiment}</dd>
            <dt>{'Language'}</dt><dd>{tri.language}</dd>
            <dt>{'Suggested'}</dt><dd>{tri.macro}</dd>
          </dl>
        ) : <p className="rl-dim">{tri && tri.pending ? 'Reading…' : tri && tri.error ? 'Triage failed for this ticket.' : 'Run Autopilot to triage the whole inbox in one go.'}</p>}
      </div>
      {(incident || incidents.length > 0) && (
        <div className="rl-card inc">
          <span className="rl-mono">{incident ? 'Part of an incident' : 'Open incident'}</span>
          <b>{(incident || incidents[0]).title}</b>
          <p className="rl-dim">{(incident || incidents[0]).hypothesis}</p>
          <button type="button" className="rl-ghost sm" disabled={!net.ready || busy} onClick={write}>{busy ? 'Writing…' : status ? 'Rewrite status update' : 'Draft status-page update'}</button>
          {error && <p className="rl-err">{error}</p>}
          {(status || busy) && <pre className="rl-status">{status}{busy && <i className="rl-caret" />}</pre>}
          <button type="button" className="rl-ghost sm" disabled={!net.ready || Object.values(bulk).some((b) => b.pending)} onClick={replyAll}>
            {Object.values(bulk).some((b) => b.pending) ? 'Drafting every reply…' : `Reply to all ${(incident || incidents[0]).ticket_ids.length} affected`}
          </button>
          {Object.keys(bulk).length > 0 && (
            <ul className="rl-bulk">
              {Object.entries(bulk).map(([id, b]) => {
                const t = tickets.find((x) => x.id === id);
                return (
                  <li key={id}>
                    <span className="rl-mono">{`${id} · ${t ? t.name : ''}${allTri[id] && allTri[id].language ? ` · ${allTri[id].language}` : ''}`}</span>
                    {b.pending ? <p className="rl-dim">{'Writing…'}</p> : b.error ? <p className="rl-err">{b.error}</p> : <pre className="rl-status">{b.text}</pre>}
                    {b.text && <button type="button" className="rl-ghost sm" onClick={() => navigator.clipboard && navigator.clipboard.writeText(b.text)}>{'Copy'}</button>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <div className="rl-model">
        <span className="rl-mono">{'Model'}</span>
        <select value={net.model} onChange={(e) => net.setModel(e.target.value)} disabled={!net.models.length} aria-label="Model">
          {net.models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
    </aside>
  );
}

const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);
const ago = (m) => (m >= 60 ? `${Math.floor(m / 60)}h` : `${m}m`);
