import React, { useMemo, useRef, useState } from 'react';
import { useSeo } from '@shared/lib/useSeo';
import { chat, chatJson, pool } from './api';
import { DevPanel, readText, settled, useMedia, useNetwork, useStored } from './network';
import { ShortlistLogo } from './logos';
import './shortlist.css';

// Shortlist — screening applicants against a rubric. Every CV is screened in parallel by a
// model on the network: a 0–4 score per criterion with a quote from the CV as evidence, and
// the must-haves. Code then does what must not be left to a model: it strips names, contact
// details, age and gendered pronouns before anything is sent (blind mode), checks every quote
// really is in the CV (a score without real evidence counts as zero), weighs the rubric, and
// fills names back into emails locally. The company, the role and the applicants are made up.

const ROLE = {
  title: 'Senior Backend Engineer, Platform',
  company: 'Mosaic Health',
  about: 'Mosaic Health runs scheduling and records for 300 clinics. The Platform team owns the event pipeline, the patient-records API and on-call for both. Lisbon, hybrid; we sponsor visas and relocation.',
  criteria: [
    { id: 'dist', name: 'Distributed systems in production', weight: 30, signals: 'queues, streaming, sharding, consensus, scaling a system under real load' },
    { id: 'lang', name: 'Go or Rust in production', weight: 20, signals: 'shipped and maintained services in Go or Rust' },
    { id: 'ops', name: 'Ownership & on-call', weight: 15, signals: 'on-call rotations, incident command, postmortems, SLOs' },
    { id: 'reg', name: 'Regulated or sensitive data', weight: 10, signals: 'healthcare, HIPAA, GDPR, audit trails, access control' },
    { id: 'comms', name: 'Communication & mentoring', weight: 25, signals: 'design docs, mentoring, leading across teams, clear writing' },
  ],
  musts: [
    { id: 'yrs', text: '5+ years building backend systems' },
    { id: 'loc', text: 'Based in or willing to relocate to Lisbon' },
  ],
};

const APPLICANTS = [
  { id: 'c1', name: 'Amara Okafor', cv: `Amara Okafor · amara.okafor@mailbox.example · +49 151 2345 6789 · linkedin.com/in/amaraokafor
Berlin, Germany. Open to relocating within the EU.

Senior Software Engineer, Ledgerly (fintech), 2020–present
- Built the payments ledger in Go: double-entry, idempotent writes, 4k transactions per second at peak.
- Moved settlement from nightly batches to Kafka streams, cutting reconciliation from 9 hours to 20 minutes.
- Lead of the payments on-call rotation; wrote our incident and postmortem templates.
- Mentored four engineers, two of whom are now seniors.

Backend Engineer, Shopwave, 2017–2020
- Python and Go services for checkout; sharded the orders database by merchant.

Education: BSc Computer Science, University of Lagos, 2016.` },
  { id: 'c2', name: 'Lukas Brenner', cv: `Lukas Brenner — lukas@brenner.example — +43 660 123 4567
Born 1990 · Austrian · married, two children
Vienna, Austria. Willing to relocate to Lisbon with his family.

Backend Engineer, Medisoft GmbH (hospital software), 2018–present
- Java/Spring services for 40 hospitals; built the HL7 and FHIR integration layer.
- Led the split of the monolith into 12 services on Kubernetes.
- Designed the audit trail for patient-record access to meet GDPR requirements.
- Runs the quarterly architecture review and writes most of our design docs.

Developer, Raiffeisen IT, 2016–2018
- Internal tools in Java.

References: his team lead at Medisoft, on request.` },
  { id: 'c3', name: 'Priya Raman', cv: `PRIYA RAMAN | priya.raman@post.example | github.com/praman
Bangalore, India — open to relocation, will need a work visa.

Staff Engineer, Tessellate DB (distributed database startup), 2019–present
- Core author of the Raft-based replication layer, written in Rust.
- Rebuilt the storage engine's compaction; p99 write latency down 60%.
- Wrote the design docs for multi-region replication and led their review across three teams.
- Part of the database on-call; incident commander for two SEV-1s.

Software Engineer, Flipkart, 2014–2019
- Order-management services in Java; scaled them for the annual sale (40x traffic).

Talks: "Raft in practice", RustConf 2023.` },
  { id: 'c4', name: 'Tom Whitfield', cv: `Tom Whitfield — tom@whitfield.example — 07700 900123
London, UK. Remote only.

Full-Stack Ninja, Synergetix, 2022–present
- Spearheaded paradigm shifts across the stack.
- Leveraged cutting-edge AI, blockchain and microservices to drive value.
- 10x engineer mindset; passionate about disruption.

Junior Developer, WebWorks Agency, 2020–2022
- Built WordPress sites and some Node.js APIs.

Skills: Go, Rust, Kubernetes, Kafka, Terraform, React, Vue, Angular, Svelte, ML, Web3.` },
  { id: 'c5', name: 'Sofia Marques', cv: `Sofia Marques · sofia.marques@correio.example · +351 912 345 678
Lisbon, Portugal.

Backend Engineer, CareLink (telehealth), 2019–present
- Go services for video consultations and e-prescriptions, used by 1.2M patients.
- Designed the HIPAA- and GDPR-compliant audit log: append-only, every record access traceable.
- Introduced SLOs for the prescriptions API and run its on-call; I write most postmortems.
- Onboarding buddy for every new backend hire; I run our internal Go study group.

Before software: Registered Nurse, Hospital de Santa Maria, 2014–2017.
Bootcamp and self-study, 2017–2018; Junior Developer at a Lisbon agency, 2018–2019.` },
  { id: 'c6', name: 'Kenji Watanabe', cv: `Kenji Watanabe / kenji.w@mail.example / +81 90 1234 5678
Tokyo, Japan. Happy to relocate to Europe.

Site Reliability Engineer, Hikari Games, 2017–present
- Go tooling and services for game backends serving 3M daily players.
- Built the Prometheus and alerting stack; owner of the SLO program.
- Incident commander rotation; ran 60+ postmortems and the blameless-review training.
- Migrated matchmaking to a sharded Redis cluster.

Systems Engineer, NTT Data, 2014–2017
- Linux infrastructure and deployment automation.` },
  { id: 'c7', name: 'Fatima Zahra El Idrissi', cv: `Fatima Zahra El Idrissi - fz.elidrissi@inbox.example - +351 934 567 890
Porto, Portugal. Moving to Lisbon is fine for me.

Software Engineer, Rotas (logistics), 2019-present
- I build event-driven system with Node.js and TypeScript, RabbitMQ between 14 services.
- I made the routing service handle 5 times more orders after we sign big clients.
- I mentor 3 junior developers and I organize the Porto Node.js meetup (800 members).
- I write the RFCs for new services and present them to product and operations.

Developer, Casablanca Digital, 2017-2019
- PHP and Node.js APIs for e-commerce clients.

Languages: Arabic, French, Portuguese, English.` },
  { id: 'c8', name: 'Daniel Novak', cv: `Daniel Novak · dnovak@fastmail.example · Prague
I prefer to stay remote and am not looking to relocate.

Staff Engineer, Quantile Trading, 2015–present
- Low-latency C++ order routing across 6 exchanges; distributed market-data fan-out.
- Designed the firm's replicated state machine for order books.
- Leads a team of 6; author of most of the engineering standards.

Software Engineer, Avast, 2011–2015
- C++ and Python services for threat detection at scale.` },
  { id: 'c9', name: 'Grace Liu', cv: `Grace Liu · grace.liu@mail.example · +34 612 345 678
Madrid, Spain. Open to Lisbon.

Backend Engineer, Movera (logistics), 2024–present
- Kotlin and Go services for fleet tracking; designed the sharded Postgres layout for 2B location points.

Career break, 2023 — full-time caregiver for a family member.

Backend Engineer, Parcelio, 2018–2022
- Go services for parcel tracking; built the Kafka pipeline for carrier events.
- On-call for tracking; wrote the runbooks the team still uses.
- Presented our event-sourcing approach at two internal engineering all-hands.` },
];

const STAGES = [['new', 'New'], ['screen', 'Screened'], ['interview', 'Interview'], ['offer', 'Offer'], ['rejected', 'Not now']];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// ---- blind mode: what code removes before anything is sent ----------------------------------
function redact(cand) {
  let t = cand.cv;
  t = t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]');
  t = t.replace(/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?){2,}\d{3,4}\b/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '[phone]' : m));
  t = t.replace(/\b(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com)\/[\w/-]+/gi, '[link]');
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const full = String(cand.name || '').trim();
  if (full) t = t.replace(new RegExp(esc(full).replace(/\s+/g, '\\s+'), 'gi'), '[name]');
  const names = full.split(/\s+/).filter((w) => w.length > 2);
  names.forEach((n) => { t = t.replace(new RegExp(`\\b${esc(n)}\\b`, 'gi'), '[name]'); });
  t = t.replace(/\[name\](\s*\[name\])+/g, '[name]');
  t = t.replace(/^.*\b(born (?:in |on )?\d|date of birth|nationality|marital status|married|age:? \d{2}\b).*$/gim, '[personal details]');
  t = t.replace(/\b(he|she)\b/gi, 'they').replace(/\b(him|her)\b/gi, 'them').replace(/\b(his|hers)\b/gi, 'their');
  return t;
}
const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9%.'+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
/// A quote counts only if it is really in the text the model was given.
const quoted = (q, text) => Boolean(q) && norm(q).length >= 8 && norm(text).includes(norm(q));

// ---- prompts --------------------------------------------------------------------------------
const roleText = (role) => `Role: ${role.title} at ${role.company}. ${role.about}
Rubric (score each 0–4: 0 no evidence, 1 weak, 2 some, 3 strong, 4 exceptional):
${role.criteria.map((c) => `- ${c.id}: ${c.name} — look for ${c.signals}`).join('\n')}
Must-haves:
${role.musts.map((m) => `- ${m.id}: ${m.text}`).join('\n')}`;
const SCREEN_SYS = (role) => `You screen job applications for a hiring team. Judge only what the CV shows, never what it might imply about the person. Placeholders like [name] or [personal details] were removed on purpose; ignore them.
${roleText(role)}
For every criterion and must-have, copy the single most relevant sentence from the CV verbatim as evidence (or null if there is none). Reply ONLY with JSON:
{"scores": {<criterion id>: {"score": 0-4, "evidence": <verbatim quote or null>}}, "musts": {<must id>: {"met": "yes"|"no"|"unclear", "evidence": <verbatim quote or null>}}, "strengths": [<2 short phrases>], "gaps": [<2 short phrases>], "summary": <one sentence>}`;

const HOW = (
  <>
    <p>{'Screening fans out by applicant; code guards the parts that must be fair and exact:'}</p>
    <ol>
      <li><b>{'Blind'}</b>{' — before anything is sent, code strips names, contact details, links, age, family status and gendered pronouns. Toggle Blind off to see the difference.'}</li>
      <li><b>{'Rubric from a job ad'}</b>{' — paste a posting and one call drafts the criteria, what evidence shows each, and the must-haves; code makes the weights add up to 100.'}</li>
      <li><b>{'Screen'}</b>{' — one request per CV, five at a time: a 0–4 score per criterion and each must-have, each with a verbatim quote as evidence. JSON out.'}</li>
      <li><b>{'Verify'}</b>{' — code checks every quote is really in the CV. A score without real evidence counts as zero and is flagged, so an invented claim can\'t lift anyone.'}</li>
      <li><b>{'Weigh'}</b>{' — the rubric weights are applied in code; a failed must-have is a knockout, shown, never hidden.'}</li>
      <li><b>{'Act'}</b>{' — compare 2–3 people in one call, stream an interview kit aimed at the gaps, and draft emails where the name is filled in locally.'}</li>
    </ol>
    <h4>{'Limits'}</h4>
    <p>{'Removing obvious signals reduces bias; it doesn\'t remove it. Treat the score as a reading aid for people, not a decision.'}</p>
    <h4>{'Make it yours'}</h4>
    <p>{'Pull applicants from your ATS webhook, keep the rubric in your repo, and store only the scores and quotes.'}</p>
  </>
);

function scoreOf(res, role) {
  if (!res || !res.out) return null;
  let total = 0; let w = 0;
  const per = {};
  role.criteria.forEach((c) => {
    const s = (res.out.scores || {})[c.id] || {};
    const raw = Math.max(0, Math.min(4, Number(s.score) || 0));
    const ok = quoted(s.evidence, res.seen);
    const counted = ok ? raw : 0;
    per[c.id] = { raw, counted, evidence: s.evidence || null, ok, unverified: raw > 0 && !ok };
    total += (counted / 4) * c.weight; w += c.weight;
  });
  const musts = {};
  role.musts.forEach((m) => {
    const x = (res.out.musts || {})[m.id] || {};
    const met = ['yes', 'no', 'unclear'].includes(x.met) ? x.met : 'unclear';
    musts[m.id] = { met, evidence: x.evidence || null, ok: quoted(x.evidence, res.seen) };
  });
  const knockout = Object.values(musts).some((m) => m.met === 'no');
  return { score: w ? Math.round((total / w) * 100) : 0, per, musts, knockout, unverified: Object.values(per).filter((p) => p.unverified).length };
}
const roleKey = (role) => JSON.stringify([role.criteria.map((c) => [c.id, c.weight, c.signals]), role.musts]);

export default function Hiring() {
  useSeo({ title: 'Shortlist hiring · a Resonance sample', description: 'Screen every applicant at once on the Resonance network: blind CVs, a weighted rubric with verbatim evidence checked in code, side-by-side comparisons, interview kits and emails.', path: '/samples/hiring' });
  const net = useNetwork({ prefer: 'text-generation' });
  const narrow = useMedia('(max-width: 980px)');
  const [role, setRole] = useStored('shortlist.role', ROLE);
  const [cands, setCands] = useStored('shortlist.candidates', APPLICANTS);
  const [results, setResults] = useStored('shortlist.results', {}, settled); // id -> { pending } | { out, seen, blind, role } | { error }
  const [stages, setStages] = useStored('shortlist.stages', {});
  const [blind, setBlind] = useStored('shortlist.blind', true);
  const [view, setView] = useState('people'); // people | pipeline | role
  const [selId, setSelId] = useState(null);
  const [cmp, setCmp] = useState([]);
  const [compare, setCompare] = useState(null); // { pending } | { out, ids } | { error }
  const [adding, setAdding] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const rk = roleKey(role);
  const label = (c) => (blind ? `Candidate ${LETTERS[cands.findIndex((x) => x.id === c.id) % 26]}` : c.name);
  const scored = useMemo(() => cands.map((c) => ({ c, r: results[c.id], s: scoreOf(results[c.id], role), stage: stages[c.id] || (results[c.id] && results[c.id].out ? 'screen' : 'new') })), [cands, results, role, stages]);
  const ranked = [...scored].sort((a, b) => (a.s ? (a.s.knockout ? -1 : a.s.score) : -2) < (b.s ? (b.s.knockout ? -1 : b.s.score) : -2) ? 1 : -1);
  const sel = scored.find((x) => x.c.id === selId) || (!narrow ? ranked[0] : null);
  const stale = (r) => r && r.out && r.role !== rk;

  const screenOne = async (c) => {
    const seen = blind ? redact(c) : c.cv;
    setResults((s) => ({ ...s, [c.id]: { pending: true } }));
    try {
      const out = await chatJson({ ...net.call, maxTokens: 900, temperature: 0.1, messages: [{ role: 'system', content: SCREEN_SYS(role) }, { role: 'user', content: seen }] });
      setResults((s) => ({ ...s, [c.id]: { out, seen, blind, role: rk } }));
    } catch (e) { setResults((s) => ({ ...s, [c.id]: { error: e.message } })); throw e; }
  };
  const screenAll = async (list) => {
    setRunning(true); setError('');
    const res = await pool(list.map((c) => () => screenOne(c)), 5);
    const bad = res.filter((r) => !r.ok);
    if (bad.length) setError(`${bad.length} screening(s) failed: ${bad[0].error.message}`);
    setRunning(false);
  };
  const todo = cands.filter((c) => !results[c.id] || results[c.id].error || stale(results[c.id]));

  const runCompare = async () => {
    const ids = cmp.slice(0, 3);
    const people = ids.map((id) => scored.find((x) => x.c.id === id)).filter((x) => x && x.r && x.r.out);
    if (people.length < 2) return;
    setCompare({ pending: true, ids });
    try {
      const out = await chatJson({
        ...net.call, maxTokens: 900, temperature: 0.2,
        messages: [
          { role: 'system', content: `You help a hiring team compare shortlisted applicants for one role. Use only the CVs and screenings given. ${roleText(role)}\nReply ONLY with JSON: {"rows": [{"criterion": <criterion id>, "best": <label>, "why": <short reason>}], "pick": <label>, "reason": <two sentences>, "ask": {<label>: <the one thing to verify in the interview>}}` },
          { role: 'user', content: JSON.stringify(people.map((p) => ({ label: `Candidate ${LETTERS[cands.findIndex((x) => x.id === p.c.id)]}`, cv: p.r.seen, screening: p.r.out }))) },
        ],
      });
      setCompare({ out, ids });
    } catch (e) { setCompare({ error: e.message, ids }); }
  };
  const letterOf = (id) => `Candidate ${LETTERS[cands.findIndex((x) => x.id === id)]}`;
  const nameForLetter = (l) => { const c = cands.find((x) => letterOf(x.id) === l); return c ? label(c) : l; };

  const move = (id, stage) => setStages((s) => ({ ...s, [id]: stage }));
  const resetAll = () => { setRole(ROLE); setCands(APPLICANTS); setResults({}); setStages({}); setCmp([]); setCompare(null); setSelId(null); };

  return (
    <div className="sl">
      <header className="sl-top">
        <div className="sl-brand"><ShortlistLogo size={34} /><b>{'Shortlist'}</b></div>
        <div className="sl-role"><span>{role.company}</span><h1>{role.title}</h1></div>
        <nav className="sl-tabs" aria-label="View">
          {[['people', `Applicants · ${cands.length}`], ['pipeline', 'Pipeline'], ['role', 'Role & rubric']].map(([id, l]) => <button type="button" key={id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>{l}</button>)}
        </nav>
        <label className="sl-blind" title="Strip names, contact details, age, family status and pronouns before screening, and hide names here">
          <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
          <span className="sl-sw" aria-hidden="true" />{'Blind'}
        </label>
        {net.key && <select className="sl-model" value={net.model} onChange={(e) => net.setModel(e.target.value)} aria-label="Model">{net.models.map((m) => <option key={m} value={m}>{m}</option>)}</select>}
      </header>

      {net.loaded && !net.key && <Connect net={net} />}

      <div className="sl-bar">
        <div className="sl-counts">
          {STAGES.map(([id, l]) => <span key={id}><b>{scored.filter((x) => x.stage === id).length}</b>{` ${l}`}</span>)}
        </div>
        {cmp.length > 0 && <button type="button" className="sl-btn ghost" disabled={cmp.length < 2 || !net.ready || (compare && compare.pending)} onClick={runCompare}>{compare && compare.pending ? 'Comparing…' : `Compare ${cmp.length}`}</button>}
        <button type="button" className="sl-btn ghost" onClick={() => setAdding(true)}>{'+ Applicant'}</button>
        <button type="button" className="sl-btn" disabled={!net.ready || running || !todo.length} onClick={() => screenAll(todo)}>
          {running ? `Screening ${cands.filter((c) => results[c.id] && results[c.id].pending).length}…` : todo.length ? `Screen ${todo.length} applicant${todo.length === 1 ? '' : 's'}` : 'All screened'}
        </button>
      </div>
      {error && <p className="sl-err">{error}</p>}
      {compare && <ComparePanel compare={compare} role={role} nameOf={nameForLetter} onClose={() => setCompare(null)} />}

      {view === 'people' && (
        <div className={`sl-people${sel && narrow ? ' detail' : ''}`}>
          <ol className="sl-list">
            {ranked.map(({ c, r, s, stage }, i) => (
              <li key={c.id} className={`${sel && sel.c.id === c.id ? 'on' : ''}${s && s.knockout ? ' ko' : ''}`}>
                <input type="checkbox" checked={cmp.includes(c.id)} disabled={!s || (!cmp.includes(c.id) && cmp.length >= 3)} onChange={() => setCmp((x) => (x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id]))} aria-label={`Compare ${label(c)}`} title={s ? 'Select 2–3 to compare' : 'Screen first'} />
                <button type="button" onClick={() => setSelId(c.id)}>
                  <span className="sl-rank">{s ? i + 1 : '·'}</span>
                  <span className="sl-who"><b>{label(c)}</b><em>{r && r.pending ? 'screening…' : r && r.error ? 'failed' : s ? (s.knockout ? 'knockout · must-have not met' : (r.out.summary || '').slice(0, 90)) : 'not screened'}</em></span>
                  <span className={`sl-score${s ? '' : ' none'}${r && r.pending ? ' busy' : ''}`}>{s ? s.score : '—'}</span>
                </button>
                <span className={`sl-stage st-${stage}`}>{STAGES.find(([id]) => id === stage)[1]}</span>
              </li>
            ))}
          </ol>
          {sel ? <Detail key={sel.c.id} x={sel} role={role} label={label(sel.c)} blind={blind} stale={stale(sel.r)} net={net} onBack={() => setSelId(null)} narrow={narrow} onMove={(st) => move(sel.c.id, st)} onScreen={() => screenAll([sel.c])} onRemove={() => { setCands((cs) => cs.filter((c) => c.id !== sel.c.id)); setSelId(null); }} /> : !narrow && <div className="sl-detail empty"><b>{'Pick an applicant'}</b></div>}
        </div>
      )}

      {view === 'pipeline' && <Pipeline scored={scored} label={label} onMove={move} onOpen={(id) => { setSelId(id); setView('people'); }} />}
      {view === 'role' && <RoleEditor role={role} setRole={setRole} onReset={resetAll} net={net} />}
      {adding && <AddApplicant onAdd={(c) => { setCands((cs) => [...cs, c]); setAdding(false); setSelId(c.id); setView('people'); }} onClose={() => setAdding(false)} />}
      <DevPanel net={net} app="Shortlist" how={HOW} slug="hiring" />
    </div>
  );
}

/// The CV as the model saw it: redactions as black bars, evidence quotes highlighted.
function CvText({ text, marks, focus }) {
  const lower = text.toLowerCase();
  const spans = [];
  marks.forEach((m) => {
    if (!m.q) return;
    const at = lower.indexOf(String(m.q).toLowerCase().trim());
    if (at >= 0) spans.push({ a: at, b: at + String(m.q).trim().length, id: m.id });
  });
  spans.sort((x, y) => x.a - y.a);
  const out = [];
  let i = 0;
  const plain = (s, k) => s.split(/(\[(?:name|email|phone|link|personal details)\])/).map((p, j) => (/^\[(name|email|phone|link|personal details)\]$/.test(p) ? <span key={`${k}-${j}`} className="sl-red" title={`Removed before screening: ${p.slice(1, -1)}`}>{p.slice(1, -1)}</span> : p));
  spans.forEach((s, k) => {
    if (s.a < i) return;
    out.push(<React.Fragment key={`p${k}`}>{plain(text.slice(i, s.a), `p${k}`)}</React.Fragment>);
    out.push(<mark key={`m${k}`} className={focus === s.id ? 'on' : ''}>{text.slice(s.a, s.b)}</mark>);
    i = s.b;
  });
  out.push(<React.Fragment key="end">{plain(text.slice(i), 'end')}</React.Fragment>);
  return <pre className="sl-cv">{out}</pre>;
}

function Detail({ x, role, label, blind, stale, net, narrow, onBack, onMove, onScreen, onRemove }) {
  const { c, r, s, stage } = x;
  const [focus, setFocus] = useState(null);
  const [tool, setTool] = useState(null); // kit | advance | reject
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ctrl = useRef(null);
  const seen = r && r.seen ? r.seen : blind ? redact(c) : c.cv;
  const first = String(c.name || '').split(/\s+/)[0] || 'there';

  const write = async (kind) => {
    setTool(kind); setOut(''); setErr(''); setBusy(true);
    ctrl.current = new AbortController();
    const sys = kind === 'kit'
      ? `You prepare a structured interview for a hiring panel. ${roleText(role)}\nWrite 7 questions as a numbered list. Aim at the weakest criteria and at any claim that needs verifying; one question per must-have that is unclear. After each question add a line starting with "Strong answer:" describing what a strong answer sounds like. No preamble.`
      : `You write short, kind, specific emails to job applicants for ${role.company}. Address the person as {first_name} — never invent a name. Sign as "${role.company} Talent team". ${kind === 'advance' ? 'Invite them to a 45-minute technical interview and ask for two time slots next week; mention one specific thing from their CV that stood out.' : 'Decline respectfully: thank them, give one honest, specific reason tied to the role\'s needs, and no false promises.'} Under 140 words. Plain text.`;
    try {
      await chat({ ...net.call, maxTokens: kind === 'kit' ? 900 : 350, temperature: 0.4, signal: ctrl.current.signal, onDelta: (_, all) => setOut(all), messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify({ cv: seen, screening: r && r.out ? r.out : null }) }] });
    } catch (e) { if (e.name !== 'AbortError') setErr(e.message); } finally { setBusy(false); }
  };
  // The model only ever wrote {first_name}; the name is filled in here, locally.
  const shown = tool === 'kit' ? out : out.replace(/\{first_name\}/g, first);

  return (
    <section className="sl-detail" aria-label={label}>
      {narrow && <button type="button" className="sl-back" onClick={onBack}>{'← All applicants'}</button>}
      <header className="sl-dh">
        <div><h2>{label}</h2>{s && <span className="sl-dsum">{r.out.summary}</span>}</div>
        {s && <div className={`sl-big${s.knockout ? ' ko' : ''}`}><b>{s.score}</b><span>{s.knockout ? 'knockout' : 'of 100'}</span></div>}
      </header>
      <div className="sl-moves">
        {STAGES.map(([id, l]) => <button type="button" key={id} className={stage === id ? 'on' : ''} onClick={() => onMove(id)}>{l}</button>)}
      </div>
      {stale && <p className="sl-note">{'The rubric changed since this screening. '}<button type="button" className="sl-link" disabled={!net.ready} onClick={onScreen}>{'Screen again'}</button></p>}
      {r && r.error && <p className="sl-err in">{r.error} <button type="button" className="sl-link" onClick={onScreen}>{'Retry'}</button></p>}
      {!r && <p className="sl-note">{'Not screened yet. '}<button type="button" className="sl-link" disabled={!net.ready} onClick={onScreen}>{'Screen now'}</button></p>}

      {s && (
        <>
          <ul className="sl-crit">
            {role.criteria.map((cr) => {
              const p = s.per[cr.id];
              return (
                <li key={cr.id}>
                  <button type="button" className={focus === cr.id ? 'on' : ''} onClick={() => setFocus(focus === cr.id ? null : cr.id)} title={p.evidence ? 'Show the evidence in the CV' : 'No evidence quoted'}>
                    <span className="sl-cn">{cr.name}<em>{`${cr.weight}%`}</em></span>
                    <span className="sl-pips" aria-label={`${p.counted} of 4`}>{[1, 2, 3, 4].map((k) => <i key={k} className={k <= p.counted ? 'f' : k <= p.raw ? 'x' : ''} />)}</span>
                  </button>
                  {p.unverified && <span className="sl-flag">{`Model gave ${p.raw}/4, but its quote isn't in the CV — counted as 0`}</span>}
                  {focus === cr.id && p.evidence && <q className={p.ok ? '' : 'bad'}>{p.evidence}</q>}
                </li>
              );
            })}
          </ul>
          <ul className="sl-musts">
            {role.musts.map((m) => { const v = s.musts[m.id]; return <li key={m.id} className={`m-${v.met}`}><b>{v.met === 'yes' ? '✓' : v.met === 'no' ? '✕' : '?'}</b><span>{m.text}{v.evidence && <q>{v.evidence}</q>}</span></li>; })}
          </ul>
          <div className="sl-sg">
            <div><span className="sl-k">{'Strengths'}</span><ul>{(r.out.strengths || []).map((t, i) => <li key={i}>{t}</li>)}</ul></div>
            <div><span className="sl-k">{'Gaps'}</span><ul>{(r.out.gaps || []).map((t, i) => <li key={i}>{t}</li>)}</ul></div>
          </div>
          <div className="sl-tools">
            <button type="button" className={`sl-btn ghost${tool === 'kit' ? ' on' : ''}`} disabled={!net.ready || busy} onClick={() => write('kit')}>{'Interview kit'}</button>
            <button type="button" className={`sl-btn ghost${tool === 'advance' ? ' on' : ''}`} disabled={!net.ready || busy} onClick={() => write('advance')}>{'Invite email'}</button>
            <button type="button" className={`sl-btn ghost${tool === 'reject' ? ' on' : ''}`} disabled={!net.ready || busy} onClick={() => write('reject')}>{'Decline email'}</button>
            {busy && <button type="button" className="sl-link" onClick={() => ctrl.current && ctrl.current.abort()}>{'Stop'}</button>}
          </div>
          {(out || err) && (
            <div className="sl-out">
              <div className="sl-outh"><span className="sl-k">{tool === 'kit' ? 'Interview kit' : tool === 'advance' ? 'Invitation' : 'Decline'}</span>{out && !busy && <button type="button" className="sl-link" onClick={() => navigator.clipboard && navigator.clipboard.writeText(shown)}>{'Copy'}</button>}</div>
              {err ? <p className="sl-err in">{err}</p> : <pre>{shown}</pre>}
              {tool !== 'kit' && out && <p className="sl-dim">{blind ? 'Written blind: the model only saw {first_name}; the name was filled in here.' : 'The model wrote {first_name}; the name was filled in here.'}</p>}
            </div>
          )}
        </>
      )}

      <div className="sl-cvh"><span className="sl-k">{r && r.seen ? (r.blind ? 'CV as the model saw it (blind)' : 'CV as the model saw it') : blind ? 'CV as it will be sent (blind)' : 'CV'}</span>{!APPLICANTS.some((a) => a.id === c.id) && <button type="button" className="sl-link" onClick={onRemove}>{'Remove applicant'}</button>}</div>
      <CvText text={seen} marks={s ? [...Object.entries(s.per).map(([id, p]) => ({ id, q: p.ok ? p.evidence : null })), ...Object.entries(s.musts).map(([id, m]) => ({ id: `m-${id}`, q: m.ok ? m.evidence : null }))] : []} focus={focus} />
    </section>
  );
}

function ComparePanel({ compare, role, nameOf, onClose }) {
  if (compare.pending) return <section className="sl-cmp"><span className="sl-k">{'Comparing…'}</span><div className="sl-skel" /></section>;
  if (compare.error) return <section className="sl-cmp"><p className="sl-err in">{compare.error}</p><button type="button" className="sl-link" onClick={onClose}>{'Close'}</button></section>;
  const o = compare.out || {};
  return (
    <section className="sl-cmp">
      <header><span className="sl-k">{'Side by side'}</span><button type="button" className="sl-x" onClick={onClose} aria-label="Close">{'×'}</button></header>
      {o.pick && <p className="sl-pick"><b>{`Lean: ${nameOf(o.pick)}`}</b>{` — ${o.reason || ''}`}</p>}
      <table>
        <tbody>
          {(o.rows || []).map((row) => { const cr = role.criteria.find((c) => c.id === row.criterion); return <tr key={row.criterion}><th>{cr ? cr.name : row.criterion}</th><td><b>{nameOf(row.best)}</b><span>{row.why}</span></td></tr>; })}
        </tbody>
      </table>
      {o.ask && <ul className="sl-asks">{Object.entries(o.ask).map(([l, t]) => <li key={l}><b>{nameOf(l)}</b>{` — verify: ${t}`}</li>)}</ul>}
    </section>
  );
}

function Pipeline({ scored, label, onMove, onOpen }) {
  const [over, setOver] = useState(null);
  return (
    <div className="sl-pipe">
      {STAGES.map(([id, l]) => {
        const items = scored.filter((x) => x.stage === id).sort((a, b) => (b.s ? b.s.score : -1) - (a.s ? a.s.score : -1));
        return (
          <section key={id} className={`sl-col st-${id}${over === id ? ' over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(id); }} onDragLeave={() => setOver(null)} onDrop={(e) => { e.preventDefault(); setOver(null); onMove(e.dataTransfer.getData('text/plain'), id); }}>
            <h3>{l}<span>{items.length}</span></h3>
            {items.map(({ c, s }) => (
              <article key={c.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', c.id)} className={s && s.knockout ? 'ko' : ''}>
                <button type="button" onClick={() => onOpen(c.id)}><b>{label(c)}</b><span>{s ? `${s.score}${s.knockout ? ' · knockout' : ''}${s.unverified ? ` · ${s.unverified} unverified` : ''}` : 'not screened'}</span></button>
                <select value={id} onChange={(e) => onMove(c.id, e.target.value)} aria-label={`Stage of ${label(c)}`}>{STAGES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

// A rubric from a job ad: one JSON call turns the posting into criteria (what to look for,
// weights that add up to 100 — fixed in code if they don't) and the must-haves.
function FromJobAd({ net, onRubric }) {
  const [ad, setAd] = useState('');
  const [state, setState] = useState('');
  const build = async () => {
    setState('pending');
    try {
      const j = await chatJson({ ...net.call, maxTokens: 900, temperature: 0.2, messages: [
        { role: 'system', content: 'You turn a job posting into a fair screening rubric. Judge skills and evidence only — never age, gender, nationality, family or school prestige. Reply ONLY with JSON: {"title": string, "company": string, "about": string (2 sentences), "criteria": [{"name": string, "weight": integer, "signals": string (what evidence in a CV shows it)}] (4-6 items, weights sum to 100), "musts": [string] (1-3 hard requirements stated in the ad)}.' },
        { role: 'user', content: ad.slice(0, 8000) },
      ] });
      const crit = (j.criteria || []).filter((c) => c && c.name).slice(0, 6);
      if (!crit.length) throw new Error('no criteria came back');
      // Weights: whole numbers that add up to exactly 100, whatever the model returned.
      const raw = crit.map((c) => Math.max(1, Number(c.weight) || 1));
      const sum = raw.reduce((a, b) => a + b, 0);
      const w = raw.map((x) => Math.round((x / sum) * 100));
      w[0] += 100 - w.reduce((a, b) => a + b, 0);
      const t = Date.now().toString(36);
      onRubric({
        title: String(j.title || 'New role'), company: String(j.company || ''), about: String(j.about || ''),
        criteria: crit.map((c, i) => ({ id: `k${t}${i}`, name: String(c.name), weight: w[i], signals: String(c.signals || '') })),
        musts: (j.musts || []).filter(Boolean).slice(0, 3).map((m, i) => ({ id: `m${t}${i}`, text: String(m) })),
      });
      setState('done');
    } catch (e) { setState(`Could not build a rubric: ${e.message}`); }
  };
  return (
    <section className="sl-fromad">
      <h3>{'From a job ad'}<span>{'one call drafts the rubric — review it below'}</span></h3>
      <textarea rows={5} value={ad} onChange={(e) => setAd(e.target.value)} placeholder="Paste a job posting: the rubric, weights and must-haves are drafted from it" />
      <div className="sl-row">
        <button type="button" className="sl-btn" onClick={build} disabled={!net.ready || ad.trim().length < 80 || state === 'pending'}>{state === 'pending' ? 'Drafting…' : 'Draft the rubric'}</button>
        {state === 'done' && <span className="sl-dim">{'Done — every screening is now out of date. Adjust anything, then screen again.'}</span>}
        {state && state !== 'pending' && state !== 'done' && <span className="sl-dim warn">{state}</span>}
      </div>
    </section>
  );
}

function RoleEditor({ role, setRole, onReset, net }) {
  const total = role.criteria.reduce((a, c) => a + (Number(c.weight) || 0), 0);
  const setC = (i, p) => setRole({ ...role, criteria: role.criteria.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const setM = (i, p) => setRole({ ...role, musts: role.musts.map((m, j) => (j === i ? { ...m, ...p } : m)) });
  return (
    <div className="sl-roleed">
      <FromJobAd net={net} onRubric={(r) => setRole(r)} />
      <section>
        <label><span className="sl-k">{'Title'}</span><input value={role.title} onChange={(e) => setRole({ ...role, title: e.target.value })} /></label>
        <label><span className="sl-k">{'Company'}</span><input value={role.company} onChange={(e) => setRole({ ...role, company: e.target.value })} /></label>
        <label><span className="sl-k">{'About the role'}</span><textarea rows={4} value={role.about} onChange={(e) => setRole({ ...role, about: e.target.value })} /></label>
      </section>
      <section>
        <h3>{'Rubric'}<span className={total === 100 ? '' : 'warn'}>{`weights total ${total}%`}</span></h3>
        {role.criteria.map((c, i) => (
          <div key={c.id} className="sl-critrow">
            <input value={c.name} onChange={(e) => setC(i, { name: e.target.value })} aria-label="Criterion" />
            <label className="sl-w"><input type="range" min="0" max="50" step="5" value={c.weight} onChange={(e) => setC(i, { weight: Number(e.target.value) })} aria-label={`Weight of ${c.name}`} /><b>{`${c.weight}%`}</b></label>
            <input className="sig" value={c.signals} onChange={(e) => setC(i, { signals: e.target.value })} aria-label={`What to look for: ${c.name}`} placeholder="What to look for" />
            <button type="button" className="sl-x sm" onClick={() => setRole({ ...role, criteria: role.criteria.filter((_, j) => j !== i) })} aria-label={`Remove ${c.name}`}>{'×'}</button>
          </div>
        ))}
        <button type="button" className="sl-link" onClick={() => setRole({ ...role, criteria: [...role.criteria, { id: `k${Date.now().toString(36)}`, name: 'New criterion', weight: 10, signals: '' }] })}>{'+ Criterion'}</button>
        <h3>{'Must-haves'}<span>{'a "no" is a knockout'}</span></h3>
        {role.musts.map((m, i) => (
          <div key={m.id} className="sl-critrow must">
            <input value={m.text} onChange={(e) => setM(i, { text: e.target.value })} aria-label="Must-have" />
            <button type="button" className="sl-x sm" onClick={() => setRole({ ...role, musts: role.musts.filter((_, j) => j !== i) })} aria-label="Remove must-have">{'×'}</button>
          </div>
        ))}
        <button type="button" className="sl-link" onClick={() => setRole({ ...role, musts: [...role.musts, { id: `m${Date.now().toString(36)}`, text: '' }] })}>{'+ Must-have'}</button>
        <p className="sl-dim">{'Changes apply to the next screening; earlier screenings are marked as out of date.'}</p>
        <button type="button" className="sl-btn ghost" onClick={onReset}>{'Reset the sample (role, applicants, results)'}</button>
      </section>
    </div>
  );
}

function AddApplicant({ onAdd, onClose }) {
  const [name, setName] = useState('');
  const [cv, setCv] = useState('');
  return (
    <div className="sl-modal" onClick={onClose}>
      <form className="sl-sheet" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onAdd({ id: `u${Date.now().toString(36)}`, name: name.trim() || 'New applicant', cv: cv.trim() }); }}>
        <header><b>{'Add an applicant'}</b><button type="button" className="sl-x" onClick={onClose} aria-label="Close">{'×'}</button></header>
        <label><span className="sl-k">{'Name'}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Used for display and emails only — removed before screening" /></label>
        <label><span className="sl-k">{'CV as text'}</span><textarea rows={12} value={cv} onChange={(e) => setCv(e.target.value)} placeholder="Paste the CV here" required /></label>
        <div className="sl-row">
          <label className="sl-btn ghost file">{'Load .txt / .md'}<input type="file" accept=".txt,.md,text/plain" onChange={async (e) => { if (e.target.files[0]) setCv(await readText(e.target.files[0])); }} /></label>
          <button type="submit" className="sl-btn" disabled={!cv.trim()}>{'Add applicant'}</button>
        </div>
        <p className="sl-dim">{'Kept in this browser only. In blind mode the name, contact details and personal lines are stripped before anything is sent.'}</p>
      </form>
    </div>
  );
}

function Connect({ net }) {
  const [k, setK] = useState('');
  return (
    <form className="sl-connect" onSubmit={(e) => { e.preventDefault(); net.setKey(k); }}>
      <b>{'Connect your screeners'}</b>
      <span>{'Every applicant is screened by a model on the Resonance network, all at once. Paste a node or logical node key — it stays in this browser.'}</span>
      <div className="sl-row"><input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="rk_…" aria-label="Resonance API key" autoComplete="off" /><button type="submit" className="sl-btn" disabled={!k.trim()}>{'Connect'}</button></div>
    </form>
  );
}
