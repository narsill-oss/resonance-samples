import React, { useEffect, useMemo, useState } from 'react';
import { useSeo } from '@shared/lib/useSeo';
import { chat, chatJson, pool } from './api';
import { DevPanel, download, settled, toCsv, useNetwork, useStored } from './network';
import { TallyLogo } from './logos';
import './tally.css';

// Tally — expense reports from receipt photos. A vision model on the network reads every
// receipt in parallel into typed JSON; the travel policy is then applied in plain code
// (caps, alcohol, duplicates, currency), and one streamed call writes the note for the
// approver. The receipts are drawn in the browser as sample data; you can add real photos.
const SPECS = [
  { id: 'r1', merchant: 'TRATTORIA DA ENZO', head: ['Via dei Vascellari 29', '00153 Roma', 'P.IVA 01234567890'], date: '14/10/2026  21:42', items: [['2 x Carbonara', '28,00'], ['1 x Acqua frizzante', '3,00'], ['1 x Cesanese 0,75L', '24,00'], ['2 x Coperto', '5,00']], tax: 'IVA 10% inclusa  5,45', total: 'EUR 60,00', pay: 'VISA ****4417', foot: 'Grazie e arrivederci!' },
  { id: 'r2', merchant: 'HOTEL LUMIERE', head: ['12 rue de Rivoli', '75004 Paris'], date: 'Arr. 15/10/2026  Dep. 17/10/2026', items: [['Chambre Deluxe 2 nuits', '378,00'], ['Taxe de sejour', '8,60'], ['Petit-dejeuner x2', '36,00']], tax: 'TVA 10% incluse  38,42', total: 'EUR 422,60', pay: 'MASTERCARD ****0921', foot: 'Merci de votre visite' },
  { id: 'r3', merchant: 'SNCF  TGV INOUI', head: ['Paris Gare de Lyon > Lyon Part-Dieu', 'Voiture 14  Place 62'], date: '17/10/2026  09:04', items: [['Billet 2nde classe', '89,00']], tax: 'TVA 10% incluse  8,09', total: 'EUR 89,00', pay: 'CB ****0921', foot: 'Bon voyage' },
  { id: 'r4', merchant: 'BACKEREI KRAUSE', head: ['Oranienstr. 18', '10999 Berlin'], date: '18.10.2026  08:12', items: [['Milchkaffee', '3,40'], ['Croissant', '2,80']], tax: 'MwSt 7% enth.  0,41', total: 'EUR 6,20', pay: 'BAR', foot: 'Danke!' },
  { id: 'r5', merchant: 'Uber', head: ['Trip receipt', 'London'], date: '20 Oct 2026  18:31', items: [['UberX  7.4 mi', '£21.10'], ['Booking fee', '£2.50']], tax: '', total: 'GBP 23.60', pay: 'Apple Pay', foot: 'Thanks for riding' },
  { id: 'r6', copyOf: 'r4' },
];
const CAPITALS = ['rome', 'roma', 'paris', 'berlin', 'london', 'madrid', 'lisbon', 'amsterdam', 'vienna', 'brussels'];
const RATES = { EUR: 1, GBP: 1.17, USD: 0.92, CHF: 1.05 };
const MEAL_CAP = 45;

const READ = 'You read ONE receipt photo for an expense report. Reply ONLY with JSON: {"merchant": <string>, "city": <string or null>, "date": <"YYYY-MM-DD" or null; the first date if it is a stay>, "currency": <ISO code>, "total": <number>, "tax": <number or null>, "category": "meals" | "lodging" | "transport" | "office" | "other", "nights": <number of nights for lodging, else null>, "items": [{"name": <string>, "amount": <number>, "alcohol": <true if an alcoholic drink>}], "payment": <string or null>, "confidence": <0..1>}. Use dots for decimals.';

const HOW = (
  <>
    <p>{'Tally mixes AI where it shines with plain code where rules must be exact:'}</p>
    <ol>
      <li><b>{'Scan all'}</b>{' — one vision request per receipt, five at a time: the photo goes as an '}<code>{'image_url'}</code>{' data URL in the message, the reply is typed JSON (merchant, date, currency, total, items, alcohol flags).'}</li>
      <li><b>{'Policy'}</b>{' — no model involved: hotel caps per night, the meal cap, alcohol, currency conversion and duplicate detection run in JavaScript, so the numbers are deterministic and auditable.'}</li>
      <li><b>{'Finance review'}</b>{' — code finds patterns across the report (split bills, weekend spending, round totals); one call reads only those and the receipts\' fields, never the photos, and tells the reviewer what to ask.'}</li>
      <li><b>{'Report note'}</b>{' — one streamed request turns the checked report into a note for the approver.'}</li>
    </ol>
    <h4>{'Make it yours'}</h4>
    <p>{'Swap the drawn receipts for uploads from your app, keep the JSON schema, and put the policy in your own code. Vision requests are larger: cap concurrency and downscale photos first (Tally keeps them under 1100 px).'}</p>
  </>
);

const eur = (n) => `€${(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Compare merchant names loosely: case, accents and punctuation don't matter (Bäckerei = BACKEREI).
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export default function Expenses() {
  useSeo({ title: 'Tally expenses · a Resonance sample', description: 'Snap receipts, and a vision model on the Resonance network reads them all in parallel; policy checks and the approver note follow.', path: '/samples/expenses' });
  const net = useNetwork({ prefer: 'vision' });
  const [samples, setSamples] = useState([]); // drawn in the page on load
  // Your photos (downscaled), readings, fixes and the report header are kept in this browser.
  const [own, setOwn] = useStored('tally.receipts', []);
  const [scan, setScan] = useStored('tally.scan', {}, settled); // id -> { pending } | { data, fixed? } | { error }
  const [client, setClient] = useStored('tally.client', {}); // id -> client entertainment
  const [report, setReport] = useStored('tally.report', { who: 'Marta Rossi', trip: 'Europe sales trip — October' });
  const [sel, setSel] = useState(null);
  const [editing, setEditing] = useState(false); // false | 'fields' | 'report'
  const receipts = useMemo(() => [...samples, ...own], [samples, own]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const list = SPECS.map((s) => {
      const spec = s.copyOf ? SPECS.find((x) => x.id === s.copyOf) : s;
      const img = drawReceipt(spec, s.copyOf ? -1.6 : (s.id.charCodeAt(1) % 3) - 1);
      return { id: s.id, img, label: spec.merchant, sample: true };
    });
    setSamples(list);
    // On wide screens the first receipt is open beside the list; on phones the list comes first.
    setSel(window.matchMedia('(min-width: 1021px)').matches ? list[0].id : null);
  }, []);

  const read = async (r) => {
    setScan((s) => ({ ...s, [r.id]: { pending: true } }));
    try {
      const data = await chatJson({
        ...net.call, maxTokens: 600, temperature: 0.1,
        messages: [{ role: 'system', content: READ }, { role: 'user', content: [{ type: 'text', text: 'Read this receipt.' }, { type: 'image_url', image_url: { url: r.img } }] }],
      });
      setScan((s) => ({ ...s, [r.id]: { data } }));
    } catch (e) { setScan((s) => ({ ...s, [r.id]: { error: e.message } })); throw e; }
  };
  const scanAll = async () => {
    setError(''); setBusy('scan');
    const todo = receipts.filter((r) => !(scan[r.id] && scan[r.id].data));
    const res = await pool(todo.map((r) => () => read(r)), 5);
    const bad = res.filter((x) => !x.ok);
    if (bad.length) setError(`${bad.length} receipt(s) could not be read: ${bad[0].error.message}`);
    setBusy('');
  };
  const add = async (file) => {
    if (!file) return;
    const img = await downscale(file);
    const id = `u${Date.now()}`;
    const r = { id, img, label: file.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'Your receipt' };
    // Photos are kept only while they fit this browser's storage (about 2.5 MB in all).
    if (JSON.stringify(own).length + img.length > 2500000) setError('This photo is used for this visit only — saved photos are full. Remove some to keep new ones.');
    setOwn((rs) => [...rs, r]);
    setSel(id);
  };
  const removeReceipt = (id) => { setOwn((rs) => rs.filter((r) => r.id !== id)); setScan((s) => { const n = { ...s }; delete n[id]; return n; }); setSel(null); };
  const fix = (id, p) => setScan((s) => ({ ...s, [id]: { ...s[id], data: { ...s[id].data, ...p }, fixed: true } }));

  const checked = useMemo(() => check(receipts, scan, client), [receipts, scan, client]);
  const scanned = checked.filter((c) => c.x);
  const submitted = scanned.reduce((a, c) => a + c.eur, 0);
  const claimable = scanned.reduce((a, c) => a + c.claimable, 0);
  const flags = scanned.filter((c) => c.status !== 'ok').length;
  const cur = checked.find((c) => c.r.id === sel);
  const visionOk = !net.model || net.tagsOf(net.model).includes('vision');

  // Anomaly review for finance: code finds the patterns across the whole report, one call
  // reads only those findings and the receipts' fields (never the photos) and writes the note.
  const anomalies = useMemo(() => patterns(scanned), [scanned]);
  const [review, setReview] = useState('');
  const writeReview = async () => {
    setError(''); setBusy('review'); setReview('');
    try {
      await chat({
        ...net.call, maxTokens: 360, temperature: 0.2,
        messages: [
          { role: 'system', content: 'You assist a finance reviewer. Given an expense report\'s receipts (already checked against policy) and patterns found by code, write a short markdown list: which receipts deserve a second look and why, and what to ask the employee. Never accuse; most patterns have innocent explanations. Do not invent facts.' },
          { role: 'user', content: `Employee: ${report.who}. Trip: ${report.trip}.\nPatterns found by code:\n${anomalies.map((a) => `- ${a.text}`).join('\n') || '- none'}\nReceipts:\n${scanned.map((c) => `${c.x.merchant} · ${c.x.date || 'no date'} · ${c.x.category} · ${eur(c.eur)} · ${c.status}`).join('\n')}` },
        ],
        onDelta: (_, all) => setReview(all),
      });
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  const writeNote = async () => {
    setError(''); setBusy('note'); setNote('');
    const lines = scanned.map((c) => `${c.x.merchant} (${c.x.date || 'no date'}, ${c.x.category}): ${c.x.currency} ${c.x.total} = ${eur(c.eur)}, claimable ${eur(c.claimable)}${c.checks.filter((k) => k.level !== 'ok').map((k) => `; ${k.text}`).join('')}`).join('\n');
    try {
      await chat({
        ...net.call, maxTokens: 320,
        messages: [
          { role: 'system', content: 'You write the note an employee attaches to an expense report for their approver: 3 short paragraphs — what the trip was and the total claimed, what was adjusted by policy and why, anything the approver must decide. Plain, specific, no invented facts.' },
          { role: 'user', content: `Employee: ${report.who}. Trip: ${report.trip}.\nSubmitted ${eur(submitted)}, claimable ${eur(claimable)}.\n${lines}` },
        ],
        onDelta: (_, all) => setNote(all),
      });
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const exportCsv = () => download('tally-expense-report.csv', toCsv(['merchant', 'date', 'category', 'currency', 'total', 'eur', 'claimable', 'status', 'corrected', 'notes'], scanned.map((c) => ({ ...c.x, eur: c.eur.toFixed(2), claimable: c.claimable.toFixed(2), status: c.status, corrected: scan[c.r.id] && scan[c.r.id].fixed ? 'yes' : '', notes: c.checks.filter((k) => k.level !== 'ok').map((k) => k.text).join(' | ') }))), 'text/csv');

  return (
    <div className="tl">
      <header className="tl-top">
        <div className="tl-brand"><TallyLogo size={34} /><b>{'Tally'}</b></div>
        <div className="tl-report">
          {editing === 'report' ? (
            <form className="tl-repedit" onSubmit={(e) => { e.preventDefault(); setEditing(false); }}>
              <input className="tl-inline" value={report.who} onChange={(e) => setReport({ ...report, who: e.target.value })} aria-label="Employee" />
              <input className="tl-inline big" value={report.trip} onChange={(e) => setReport({ ...report, trip: e.target.value })} aria-label="Trip" />
              <button type="submit" className="tl-link light">{'Done'}</button>
            </form>
          ) : (
            <>
              <span>{`Expense report · ${report.who}`}<button type="button" className="tl-link light" onClick={() => setEditing('report')}>{'Edit'}</button></span>
              <h1>{report.trip}</h1>
            </>
          )}
        </div>
        {net.key && (
          <label className="tl-model"><span>{'Reader'}</span>
            <select value={net.model} onChange={(e) => net.setModel(e.target.value)}>{net.models.map((m) => <option key={m} value={m}>{`${m}${net.tagsOf(m).includes('vision') ? ' · vision' : ''}`}</option>)}</select>
          </label>
        )}
      </header>

      <section className="tl-sum">
        <div className="tl-big"><span>{'Claimable'}</span><b>{scanned.length ? eur(claimable) : '—'}</b><em>{scanned.length ? `of ${eur(submitted)} submitted` : `${receipts.length} receipts to scan`}</em></div>
        <div className="tl-chips">
          <span><b>{`${scanned.length}/${receipts.length}`}</b>{' scanned'}</span>
          <span className={flags ? 'warn' : ''}><b>{flags}</b>{' need attention'}</span>
          <span><b>{scanned.filter((c) => c.status === 'duplicate').length}</b>{' duplicates'}</span>
        </div>
        <div className="tl-bar"><i style={{ width: `${receipts.length ? (scanned.length / receipts.length) * 100 : 0}%` }} /></div>
      </section>

      <div className="tl-tools">
        <button type="button" className="tl-btn coral" disabled={!net.ready || Boolean(busy) || !receipts.length} onClick={scanAll}>{busy === 'scan' ? `Reading ${Object.values(scan).filter((s) => s.pending).length} receipts…` : 'Scan all receipts'}</button>
        <label className="tl-btn">
          {'+ Add receipt'}
          <input type="file" accept="image/*" capture="environment" onChange={(e) => { add(e.target.files && e.target.files[0]); e.target.value = ''; }} />
        </label>
        <button type="button" className="tl-btn" disabled={!net.ready || !scanned.length || Boolean(busy)} onClick={writeNote}>{busy === 'note' ? 'Writing…' : 'Write approver note'}</button>
        <button type="button" className="tl-btn" disabled={!net.ready || scanned.length < 2 || Boolean(busy)} onClick={writeReview} title="Patterns across the whole report, for the finance reviewer">{busy === 'review' ? 'Reviewing…' : `Finance review${anomalies.length ? ` · ${anomalies.length}` : ''}`}</button>
        <button type="button" className="tl-btn" disabled={!scanned.length} onClick={exportCsv}>{'Export CSV'}</button>
      </div>
      {net.loaded && !net.key && <Connect net={net} />}
      {net.key && !visionOk && <p className="tl-warn">{'The selected model can\'t see images — pick one marked "vision" as the reader.'}</p>}
      {error && <p className="tl-err">{error}</p>}

      <div className="tl-grid">
        <div className="tl-list">
          {checked.map((c) => (
            <button type="button" key={c.r.id} className={`tl-card ${c.status}${sel === c.r.id ? ' on' : ''}`} onClick={() => { setSel(c.r.id); setEditing(false); }}>
              <span className="tl-thumb"><img src={c.r.img} alt="" />{scan[c.r.id] && scan[c.r.id].pending && <i className="tl-scanline" />}</span>
              <span className="tl-card-b">
                <b>{c.x ? c.x.merchant : c.r.label}</b>
                <span>{c.x ? `${c.x.date || 'no date'} · ${c.x.category}` : scan[c.r.id] && scan[c.r.id].error ? 'could not read' : 'not scanned'}</span>
                {c.x && <span className="tl-amt">{eur(c.claimable)}{c.claimable < c.eur - 0.005 && <s>{eur(c.eur)}</s>}</span>}
              </span>
              {c.x && <span className={`tl-status ${c.status}`}>{c.status === 'ok' ? '✓' : c.status === 'duplicate' ? 'dup' : '!'}</span>}
            </button>
          ))}
        </div>

        {cur && (
          <section className={`tl-detail${sel ? ' open' : ''}`}>
            <button type="button" className="tl-back" onClick={() => { setSel(null); setEditing(false); }}>{'← Receipts'}</button>
            <div className="tl-photo"><img src={cur.r.img} alt="Receipt" /></div>
            <div className="tl-fields">
              {cur.x ? (
                <>
                  <div className="tl-fh"><b>{cur.x.merchant}</b><span className={`tl-status ${cur.status}`}>{cur.status === 'ok' ? 'Within policy' : cur.status === 'duplicate' ? 'Duplicate' : 'Needs attention'}</span></div>
                  <div className="tl-fixbar">
                    {scan[cur.r.id] && scan[cur.r.id].fixed ? <span className="tl-fixed">{'Corrected by you — the checks use your values'}</span> : <span>{'Read by the model. Wrong? Fix it — the checks rerun at once.'}</span>}
                    <button type="button" className="tl-link" onClick={() => setEditing((v) => (v === 'fields' ? false : 'fields'))}>{editing === 'fields' ? 'Done' : 'Fix fields'}</button>
                  </div>
                  {editing === 'fields' ? (
                    <div className="tl-editf">
                      <label><span>{'Merchant'}</span><input value={cur.x.merchant || ''} onChange={(e) => fix(cur.r.id, { merchant: e.target.value })} /></label>
                      <label><span>{'Date'}</span><input type="date" value={cur.x.date || ''} onChange={(e) => fix(cur.r.id, { date: e.target.value })} /></label>
                      <label><span>{'City'}</span><input value={cur.x.city || ''} onChange={(e) => fix(cur.r.id, { city: e.target.value })} /></label>
                      <label><span>{'Category'}</span><select value={cur.x.category} onChange={(e) => fix(cur.r.id, { category: e.target.value })}>{['meals', 'lodging', 'transport', 'office', 'other'].map((c) => <option key={c}>{c}</option>)}</select></label>
                      <label><span>{'Currency'}</span><select value={cur.x.currency} onChange={(e) => fix(cur.r.id, { currency: e.target.value })}>{Object.keys(RATES).map((c) => <option key={c}>{c}</option>)}</select></label>
                      <label><span>{'Total'}</span><input inputMode="decimal" value={cur.x.total} onChange={(e) => fix(cur.r.id, { total: e.target.value.replace(',', '.') })} /></label>
                      {cur.x.category === 'lodging' && <label><span>{'Nights'}</span><input inputMode="numeric" value={cur.x.nights || ''} onChange={(e) => fix(cur.r.id, { nights: Number(e.target.value) || null })} /></label>}
                    </div>
                  ) : (
                  <dl>
                    <dt>{'Date'}</dt><dd>{cur.x.date || '—'}</dd>
                    <dt>{'City'}</dt><dd>{cur.x.city || '—'}</dd>
                    <dt>{'Category'}</dt><dd>{cur.x.category}{cur.x.nights ? ` · ${cur.x.nights} nights` : ''}</dd>
                    <dt>{'Total'}</dt><dd>{`${cur.x.currency} ${Number(cur.x.total).toFixed(2)}`}{cur.x.currency !== 'EUR' && ` = ${eur(cur.eur)}`}</dd>
                    <dt>{'Paid with'}</dt><dd>{cur.x.payment || '—'}</dd>
                    <dt>{'Confidence'}</dt><dd>{cur.x.confidence != null ? `${Math.round(Number(cur.x.confidence) * 100)}%` : '—'}</dd>
                  </dl>
                  )}
                  {Array.isArray(cur.x.items) && cur.x.items.length > 0 && (
                    <table className="tl-items"><tbody>{cur.x.items.map((it, i) => <tr key={i} className={it.alcohol ? 'alc' : ''}><td>{it.name}{it.alcohol && <em>{' alcohol'}</em>}</td><td>{Number(it.amount).toFixed(2)}</td></tr>)}</tbody></table>
                  )}
                  <ul className="tl-checks">{cur.checks.map((k, i) => <li key={i} className={k.level}><i>{k.level === 'ok' ? '✓' : k.level === 'warn' ? '!' : '×'}</i>{k.text}</li>)}</ul>
                  {cur.x.category === 'meals' && (
                    <label className="tl-toggle"><input type="checkbox" checked={Boolean(client[cur.r.id])} onChange={(e) => setClient((c) => ({ ...c, [cur.r.id]: e.target.checked }))} /><span>{'Client entertainment (lifts the meal cap and allows alcohol)'}</span></label>
                  )}
                  <div className="tl-claim"><span>{'Claimable'}</span><b>{eur(cur.claimable)}</b></div>
                  <div className="tl-row">
                    <button type="button" className="tl-link" disabled={!net.ready || Boolean(scan[cur.r.id] && scan[cur.r.id].pending)} onClick={() => read(cur.r).catch((e) => setError(e.message))}>{'Scan again'}</button>
                    {!cur.r.sample && <button type="button" className="tl-link" onClick={() => removeReceipt(cur.r.id)}>{'Remove receipt'}</button>}
                  </div>
                </>
              ) : (
                <div className="tl-empty">
                  <p>{scan[cur.r.id] && scan[cur.r.id].pending ? 'Reading the receipt…' : scan[cur.r.id] && scan[cur.r.id].error ? `Could not read it: ${scan[cur.r.id].error}` : 'Not scanned yet. Tally reads the merchant, date, currency, total and every line, and flags drinks.'}</p>
                  <button type="button" className="tl-btn coral" disabled={!net.ready || Boolean(scan[cur.r.id] && scan[cur.r.id].pending)} onClick={() => read(cur.r).catch((e) => setError(e.message))}>{'Scan this receipt'}</button>
                  {!cur.r.sample && <button type="button" className="tl-link" onClick={() => removeReceipt(cur.r.id)}>{'Remove receipt'}</button>}
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {(review || busy === 'review') && (
        <section className="tl-note">
          <span>{'Finance review'}</span>
          {anomalies.length > 0 && <ul className="tl-anom">{anomalies.map((a) => <li key={a.text}>{a.text}</li>)}</ul>}
          <div>{review}{busy === 'review' && <i className="tl-caret" />}</div>
        </section>
      )}
      {(note || busy === 'note') && (
        <section className="tl-note">
          <span>{'Note for the approver'}</span>
          <div>{note}{busy === 'note' && <i className="tl-caret" />}</div>
        </section>
      )}
      <DevPanel net={net} app="Tally" how={HOW} slug="expenses" />
    </div>
  );
}

function Connect({ net }) {
  const [k, setK] = useState('');
  return (
    <form className="tl-connect" onSubmit={(e) => { e.preventDefault(); net.setKey(k); }}>
      <b>{'Connect Tally to the network'}</b>
      <span>{'Receipts are read by a vision model on Resonance. Paste your node key or a logical node key — it stays in this browser.'}</span>
      <div><input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="rk_…" aria-label="Resonance API key" autoComplete="off" /><button type="submit" className="tl-btn coral" disabled={!k.trim()}>{'Connect'}</button></div>
    </form>
  );
}

/// Apply the travel policy to the scanned receipts: plain code, so every number is exact.
/// Patterns across a report that a per-receipt check can't see: several receipts at one place
/// on one day (a split bill), weekend spending, round totals, and the same merchant again and
/// again. Plain code over the scanned fields; the finance review explains them.
function patterns(all) {
  const out = [];
  // Duplicates are already refused by the policy check; look at what is left.
  const scanned = all.filter((c) => c.status !== 'duplicate');
  const byPlaceDay = new Map();
  scanned.forEach((c) => { const k = `${norm(c.x.merchant)}|${c.x.date}`; byPlaceDay.set(k, [...(byPlaceDay.get(k) || []), c]); });
  byPlaceDay.forEach((cs) => { if (cs.length > 1 && cs[0].x.date) out.push({ text: `${cs.length} receipts at ${cs[0].x.merchant} on ${cs[0].x.date} (${cs.map((c) => eur(c.eur)).join(' + ')}) — a split bill?` }); });
  scanned.forEach((c) => {
    const d = c.x.date && new Date(`${c.x.date}T12:00:00`);
    if (d && !Number.isNaN(d.getTime()) && (d.getDay() === 0 || d.getDay() === 6) && c.x.category !== 'lodging') out.push({ text: `${c.x.merchant} on a ${d.getDay() === 0 ? 'Sunday' : 'Saturday'} (${c.x.date}), ${eur(c.eur)}` });
    if (c.eur >= 50 && Math.abs(c.eur - Math.round(c.eur / 10) * 10) < 0.005) out.push({ text: `${c.x.merchant}: a round ${eur(c.eur)} — check it isn't an estimate` });
  });
  return out.filter((o, i) => out.findIndex((p) => p.text === o.text) === i);
}

function check(receipts, scan, client) {
  const seen = new Map();
  return receipts.map((r) => {
    const x = scan[r.id] && scan[r.id].data;
    if (!x) return { r, x: null, eur: 0, claimable: 0, status: 'pending', checks: [] };
    const cur = String(x.currency || 'EUR').toUpperCase();
    const rate = RATES[cur] || 1;
    const total = Number(x.total) || 0;
    const value = total * rate;
    const checks = [];
    let claimable = value;
    let status = 'ok';
    if (cur !== 'EUR') checks.push({ level: RATES[cur] ? 'ok' : 'warn', text: RATES[cur] ? `Converted ${cur} at ${rate} → ${eur(value)}` : `No rate for ${cur}; counted 1:1 — check it` });
    if (!x.date || !total) { checks.push({ level: 'warn', text: 'Date or total missing — needs a manual look' }); status = 'review'; }
    const key = `${norm(x.merchant)}|${total.toFixed(2)}|${x.date}`;
    if (seen.has(key)) { checks.push({ level: 'bad', text: `Same merchant, date and total as ${seen.get(key)} — duplicate, not claimable` }); return { r, x, eur: value, claimable: 0, status: 'duplicate', checks }; }
    seen.set(key, x.merchant);
    const capital = CAPITALS.includes(norm(x.city));
    if (x.category === 'lodging') {
      const nights = Math.max(1, Number(x.nights) || 1);
      const cap = capital ? 160 : 120;
      const room = (Array.isArray(x.items) ? x.items.filter((i) => /chambre|room|night|nuit|zimmer|camera/i.test(i.name)).reduce((a, i) => a + Number(i.amount || 0), 0) : 0) * rate || value;
      if (room / nights > cap) {
        const over = room - cap * nights;
        claimable = value - over;
        checks.push({ level: 'warn', text: `${eur(room / nights)}/night is over the ${eur(cap)} cap${capital ? ' for capitals' : ''} — ${eur(over)} not claimable` });
        status = 'flagged';
      } else checks.push({ level: 'ok', text: `Within the ${eur(cap)}/night hotel cap` });
    }
    if (x.category === 'meals') {
      const alcohol = Array.isArray(x.items) ? x.items.filter((i) => i.alcohol).reduce((a, i) => a + Number(i.amount || 0), 0) * rate : 0;
      if (client[r.id]) checks.push({ level: 'ok', text: 'Client entertainment: no meal cap, drinks allowed' });
      else {
        if (alcohol > 0) { claimable -= alcohol; checks.push({ level: 'warn', text: `Alcohol (${eur(alcohol)}) isn't reimbursed outside client entertainment` }); status = 'flagged'; }
        if (claimable > MEAL_CAP) { checks.push({ level: 'warn', text: `Over the ${eur(MEAL_CAP)} daily meal cap — ${eur(claimable - MEAL_CAP)} not claimable` }); claimable = MEAL_CAP; status = 'flagged'; }
        if (status === 'ok') checks.push({ level: 'ok', text: `Within the ${eur(MEAL_CAP)} daily meal cap` });
      }
    }
    if (x.category === 'transport') checks.push({ level: 'ok', text: 'Transport: reimbursed in full' });
    if (Number(x.confidence) < 0.6) { checks.push({ level: 'warn', text: 'Low reading confidence — compare with the photo' }); if (status === 'ok') status = 'review'; }
    return { r, x, eur: value, claimable: Math.max(0, claimable), status, checks };
  });
}

/// Draw a sample receipt on a canvas and return it as a JPEG data URL.
function drawReceipt(s, tilt) {
  const W = 420;
  const lineH = 26;
  const H = 150 + (s.head.length + s.items.length) * lineH + 170;
  const c = document.createElement('canvas');
  c.width = W + 40; c.height = H + 40;
  const g = c.getContext('2d');
  g.fillStyle = '#D9D6CF'; g.fillRect(0, 0, c.width, c.height);
  g.translate(c.width / 2, c.height / 2); g.rotate((tilt * Math.PI) / 180); g.translate(-W / 2, -H / 2);
  g.shadowColor = 'rgba(0,0,0,0.25)'; g.shadowBlur = 14;
  g.fillStyle = '#FCFBF6'; g.fillRect(0, 0, W, H);
  g.shadowBlur = 0;
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; g.fillRect(Math.random() * W, Math.random() * H, 1.4, 1.4); }
  g.fillStyle = '#1C1C1C';
  let y = 46;
  const center = (t, f) => { g.font = f; g.textAlign = 'center'; g.fillText(t, W / 2, y); y += lineH; };
  const row = (l, r, f = '18px "Courier New", monospace') => { g.font = f; g.textAlign = 'left'; g.fillText(l, 28, y); g.textAlign = 'right'; g.fillText(r, W - 28, y); y += lineH; };
  const rule = () => { g.font = '18px "Courier New", monospace'; g.textAlign = 'center'; g.fillText('- - - - - - - - - - - - - - - - -', W / 2, y); y += lineH; };
  center(s.merchant, 'bold 24px "Courier New", monospace');
  s.head.forEach((h) => center(h, '16px "Courier New", monospace'));
  y += 6; center(s.date, '16px "Courier New", monospace');
  rule();
  s.items.forEach(([l, r]) => row(l, r));
  rule();
  row('TOTAL', s.total, 'bold 21px "Courier New", monospace');
  if (s.tax) row(s.tax, '', '15px "Courier New", monospace');
  row(s.pay, '', '15px "Courier New", monospace');
  y += 8; center(s.foot, 'italic 15px "Courier New", monospace');
  return c.toDataURL('image/jpeg', 0.86);
}

/// A photo as a JPEG data URL no wider/taller than 1100 px.
function downscale(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1100 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('could not open that image'));
    img.src = URL.createObjectURL(file);
  });
}
