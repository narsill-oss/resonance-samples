import React, { useMemo, useRef, useState } from 'react';
import { useSeo } from '@shared/lib/useSeo';
import { chat, chatJson, pool } from './api';
import { DevPanel, download, parseCsv, readText, toCsv, useMedia, useNetwork, useStored } from './network';
import { QuarryLogo } from './logos';
import './quarry.css';

// Quarry — ask a table questions in plain words. The model never sees the rows: it gets the
// schema and a profile, and writes a query plan (JSON); a small engine in this page runs the
// plan on the rows, so every number on a chart is computed, not generated. A second call
// writes the answer from the computed result. "Explore" runs six of these chains side by side,
// then one call writes the briefing. The sample data (a made-up coffee roaster) is generated in
// code; upload your own CSV and nothing but its schema, five example rows and the computed
// results are sent.

// ---- sample data ------------------------------------------------------------------------------
function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }
const PRODUCTS = [['Espresso Blend', 14, 0.34], ['Ethiopia Yirgacheffe', 19, 0.22], ['Decaf Night Owl', 15, 0.14], ['Cold Brew Kit', 32, 0.2], ['Burr Grinder', 129, 0.1]];
function sampleRows() {
  const r = rng(7);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const rows = [];
  let id = 10400;
  for (let day = 0; day < 304; day += 1) {
    const d = new Date(Date.UTC(2026, 0, 1 + day));
    const date = d.toISOString().slice(0, 10);
    const m = d.getUTCMonth() + 1;
    const n = 2 + Math.floor(r() * 3) + (d.getUTCDay() === 6 ? 1 : 0);
    for (let k = 0; k < n; k += 1) {
      const sub = 0.06 + (day / 304) * 0.26; // subscriptions grow all year
      const x = r();
      const channel = x < sub ? 'Subscription' : x < sub + 0.2 ? 'Wholesale' : x < sub + 0.5 ? 'Café' : 'Web';
      const summer = m >= 6 && m <= 8;
      const weights = PRODUCTS.map(([name, , w]) => (name === 'Cold Brew Kit' ? (summer ? w * 3 : w * 0.45) : w));
      let y = r() * weights.reduce((a, b) => a + b, 0);
      let pi = 0;
      while (y > weights[pi]) { y -= weights[pi]; pi += 1; }
      const [product, price] = PRODUCTS[Math.min(pi, PRODUCTS.length - 1)];
      const region = pick(['North', 'South', 'East', 'West']);
      const qty = channel === 'Wholesale' && product !== 'Burr Grinder' ? 6 + Math.floor(r() * 30) : 1 + Math.floor(r() * (product === 'Burr Grinder' ? 1 : 4));
      const discount = channel === 'Wholesale' ? 10 + Math.floor(r() * 4) * 5 : channel === 'Web' && m === 3 ? 20 : channel === 'Web' && r() < 0.2 ? 10 : 0;
      const defect = product === 'Burr Grinder' && region === 'West' && (m === 8 || m === 9);
      const returned = r() < (defect ? 0.45 : 0.025);
      const customer = channel === 'Subscription' || r() < 0.55 ? 'returning' : 'new';
      rows.push({ order_id: `EC-${id += 1}`, date, region, channel, product, qty, unit_price: price, discount_pct: discount, revenue: Math.round(qty * price * (1 - discount / 100) * 100) / 100, returned: returned ? 1 : 0, customer });
    }
  }
  // A little real-world dirt for the Quality view: a few empty cells and one order exported
  // twice. Small enough not to move any answer.
  [41, 377, 903, 1290, 1555, 1888].forEach((k) => { if (rows[k]) rows[k] = { ...rows[k], customer: null }; });
  [212, 1104, 1730].forEach((k) => { if (rows[k]) rows[k] = { ...rows[k], discount_pct: null }; });
  if (rows[640]) rows.splice(641, 0, { ...rows[640] });
  return rows;
}
const SAMPLE_COLS = [['order_id', 'text'], ['date', 'date'], ['region', 'category'], ['channel', 'category'], ['product', 'category'], ['qty', 'number'], ['unit_price', 'number'], ['discount_pct', 'number'], ['revenue', 'number'], ['returned', 'bool'], ['customer', 'category']];
const SAMPLE_ASKS = ['How did monthly revenue move this year, by channel?', 'Which product has the highest return rate in the West?', 'Average discount by channel', 'Top 5 products by revenue since July', 'New vs returning customers per quarter'];

// ---- CSV ------------------------------------------------------------------------------------
const isoDate = (v) => {
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (!/[-/]/.test(v) || !/\d{4}/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};
const asNum = (v, comma) => {
  let t = String(v).replace(/[$€£%\s]/g, '');
  t = comma ? t.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.') : t.replace(/,(?=\d{3}\b)/g, '');
  const n = Number(t);
  return t !== '' && Number.isFinite(n) ? n : null;
};
/// Rows of strings → typed columns: number, bool (0/1), date (YYYY-MM-DD), category or text.
function typeTable(header, body, comma = false) {
  const names = header.map((h, i) => h.trim() || `column_${i + 1}`);
  const cols = names.map((name, i) => {
    const vals = body.map((r) => (r[i] || '').trim()).filter(Boolean).slice(0, 2000);
    let type = 'text';
    if (vals.length && vals.every((v) => /^(true|false|yes|no)$/i.test(v))) type = 'bool';
    else if (vals.length && vals.every((v) => asNum(v, comma) !== null)) type = 'number';
    else if (vals.length && vals.every((v) => isoDate(v))) type = 'date';
    else if (new Set(vals).size <= Math.max(24, vals.length * 0.2)) type = 'category';
    return { name, type, i };
  });
  const rows = body.map((r) => Object.fromEntries(cols.map((c) => {
    const v = (r[c.i] || '').trim();
    if (v === '') return [c.name, null];
    if (c.type === 'number') return [c.name, asNum(v, comma)];
    if (c.type === 'bool') return [c.name, /^(true|yes)$/i.test(v) ? 1 : 0];
    if (c.type === 'date') return [c.name, isoDate(v)];
    return [c.name, v];
  })));
  return { cols: cols.map(({ name, type }) => ({ name, type })), rows };
}
// ---- profile and prompt ---------------------------------------------------------------------
const fmtN = (x, pct) => {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  if (pct) return `${(x * 100).toFixed(x * 100 >= 10 ? 0 : 1)}%`;
  const a = Math.abs(x);
  if (a >= 1e6) return `${(x / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(x / 1e3).toFixed(1)}k`;
  if (Number.isInteger(x)) return x.toLocaleString('en-US');
  return x.toLocaleString('en-US', { maximumFractionDigits: a >= 100 ? 0 : 2 });
};
function profile(data) {
  return data.cols.map((c) => {
    const vals = data.rows.map((r) => r[c.name]).filter((v) => v !== null && v !== undefined);
    const p = { ...c, filled: vals.length };
    if (c.type === 'number' || c.type === 'bool') {
      let min = Infinity; let max = -Infinity; let sum = 0;
      vals.forEach((v) => { if (v < min) min = v; if (v > max) max = v; sum += v; });
      Object.assign(p, { min, max, mean: vals.length ? sum / vals.length : 0 });
      const bins = new Array(14).fill(0);
      vals.forEach((v) => { bins[max > min ? Math.min(13, Math.floor(((v - min) / (max - min)) * 14)) : 0] += 1; });
      p.bins = bins;
    } else if (c.type === 'date') {
      const s = [...vals].sort();
      Object.assign(p, { min: s[0], max: s[s.length - 1] });
      const by = {};
      vals.forEach((v) => { const k = v.slice(0, 7); by[k] = (by[k] || 0) + 1; });
      p.bins = Object.keys(by).sort().map((k) => by[k]);
    } else {
      const by = new Map();
      vals.forEach((v) => by.set(v, (by.get(v) || 0) + 1));
      p.distinct = by.size;
      p.top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    }
    return p;
  });
}
/// Data quality, found in code (deterministic, every row): missing values, extreme outliers,
/// categories that differ only by case or spaces, dates in the future, duplicate rows.
function quality(data, prof) {
  const out = [];
  const n = data.rows.length;
  prof.forEach((p) => {
    if (p.filled < n) out.push({ col: p.name, kind: 'missing', n: n - p.filled, detail: `${n - p.filled} of ${n} rows are empty (${(n - p.filled) / n < 0.01 ? '<1' : Math.round(((n - p.filled) / n) * 100)}%)` });
    if (p.type === 'number') {
      const v = data.rows.map((r) => r[p.name]).filter((x) => typeof x === 'number').sort((a, b) => a - b);
      if (v.length >= 8) {
        const q = (f) => v[Math.floor(f * (v.length - 1))];
        const [q1, q3] = [q(0.25), q(0.75)];
        const lo = q1 - 3 * (q3 - q1); const hi = q3 + 3 * (q3 - q1);
        const odd = v.filter((x) => x < lo || x > hi);
        // Rare values far out are worth a look; a long tail (wholesale vs retail orders) is not.
        if (q3 > q1 && odd.length && odd.length <= Math.max(1, v.length * 0.01)) out.push({ col: p.name, kind: 'outliers', n: odd.length, detail: `${odd.length} extreme value${odd.length === 1 ? '' : 's'} outside ${fmtN(lo)} … ${fmtN(hi)} (e.g. ${fmtN(odd[odd.length - 1])})` });
      }
    } else if (p.type === 'category' || p.type === 'text') {
      const groups = new Map();
      data.rows.forEach((r) => { const x = r[p.name]; if (typeof x !== 'string') return; const k = x.trim().toLowerCase().replace(/\s+/g, ' '); if (!groups.has(k)) groups.set(k, new Set()); groups.get(k).add(x); });
      const clash = [...groups.values()].filter((g) => g.size > 1);
      if (clash.length) out.push({ col: p.name, kind: 'inconsistent', n: clash.length, detail: `spelled several ways: ${clash.slice(0, 3).map((g) => [...g].map((x) => `"${x}"`).join(' / ')).join('; ')}` });
    } else if (p.type === 'date') {
      const today = new Date().toISOString().slice(0, 10);
      const fut = data.rows.filter((r) => typeof r[p.name] === 'string' && r[p.name] > today).length;
      if (fut) out.push({ col: p.name, kind: 'future dates', n: fut, detail: `${fut} row${fut === 1 ? '' : 's'} dated after today` });
    }
  });
  const seen = new Map();
  data.rows.forEach((r) => { const k = JSON.stringify(r); seen.set(k, (seen.get(k) || 0) + 1); });
  const dup = [...seen.values()].reduce((a, c) => a + (c > 1 ? c - 1 : 0), 0);
  if (dup) out.push({ col: '(whole row)', kind: 'duplicates', n: dup, detail: `${dup} row${dup === 1 ? ' repeats' : 's repeat'} an earlier row exactly` });
  return out;
}

function schemaText(name, data, prof) {
  const lines = prof.map((p) => {
    if (p.type === 'number') return `- ${p.name} (number): min ${fmtN(p.min)}, max ${fmtN(p.max)}, mean ${fmtN(p.mean)}`;
    if (p.type === 'bool') return `- ${p.name} (boolean stored as 0/1): ${fmtN(p.mean, true)} are 1`;
    if (p.type === 'date') return `- ${p.name} (date, YYYY-MM-DD): ${p.min} … ${p.max}`;
    if (p.type === 'category') return `- ${p.name} (category, ${p.distinct} values): ${p.top.map(([v, n]) => `${v} (${n})`).join(', ')}`;
    return `- ${p.name} (text, ${p.distinct} distinct values, e.g. ${p.top.slice(0, 3).map(([v]) => v).join(', ')})`;
  });
  const ex = data.rows.slice(0, 5).map((r) => JSON.stringify(r)).join('\n');
  return `Table "${name}", ${data.rows.length} rows. Columns:\n${lines.join('\n')}\nFive example rows:\n${ex}`;
}
const PLAN_SYS = (schema) => `You turn questions about a table into a query plan for a small engine that runs in the browser. You never see all the rows, only the schema below. Reply ONLY with JSON of this shape:
{"question": <the question in plain words>,
 "title": <short chart title>,
 "filter": [{"col": <column>, "op": "="|"!="|">"|">="|"<"|"<="|"in"|"not in"|"contains"|"between", "value": <value, or [values] for in/not in/between>}],
 "bucket": {"col": <date column>, "unit": "day"|"week"|"month"|"quarter"|"year"} or null,
 "groupBy": [<column>],
 "measures": [{"op": "count"|"sum"|"avg"|"min"|"max"|"median"|"distinct", "col": <column, omit for count>, "as": <short label>}],
 "sort": {"by": <a measure label>, "dir": "asc"|"desc"} or null,
 "limit": <number> or null,
 "chart": "line"|"bar"|"table"|"number"}
Rules: exact column names only. At most 2 dimensions in total (the bucket counts as one). 1–3 measures. Dates compare as YYYY-MM-DD strings. Booleans are 0/1, so "avg" gives a rate. For change over time, bucket by month unless asked otherwise. For "top N", sort desc and set limit.

${schema}`;
const NARRATE_SYS = 'You are a data analyst. You get a question, the query that was run, and its result, computed exactly from the data. Answer in at most 3 sentences, citing numbers from the result only (never invent any). Lead with the answer, then the most telling comparison. If the result cannot answer the question, say what is missing. Plain text, no headings.';
const LENSES = [
  'trend: how the main amount moves over time',
  'breakdown: the most important category split of the main amount',
  'change: which segment grew or shrank the most between the first and the last part of the period',
  'anomaly: an unusual rate (for example a return, discount or failure rate) in one segment',
  'mix: how the share of a category changes over time',
  'ranking: the top and the weakest items by the main amount',
];

// ---- the engine -----------------------------------------------------------------------------
const MEASURE_OPS = ['count', 'sum', 'avg', 'min', 'max', 'median', 'distinct'];
const FILTER_OPS = { '=': 1, '==': 1, '!=': 1, '>': 1, '>=': 1, '<': 1, '<=': 1, in: 1, 'not in': 1, contains: 1, between: 1 };
function bucketOf(d, unit) {
  if (!d) return '(blank)';
  if (unit === 'day') return d;
  if (unit === 'year') return d.slice(0, 4);
  if (unit === 'quarter') return `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
  if (unit === 'week') { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); }
  return d.slice(0, 7);
}
function passes(v, f, type) {
  const norm = (x) => (type === 'number' || type === 'bool' ? (x === true ? 1 : x === false ? 0 : Number(x)) : type === 'date' ? String(x).slice(0, 10) : String(x).toLowerCase());
  const val = v === null || v === undefined ? null : norm(v);
  const arr = Array.isArray(f.value) ? f.value.map(norm) : [norm(f.value)];
  const op = String(f.op).toLowerCase();
  if (val === null) return op === '!=' || op === 'not in';
  switch (op) {
    case '=': case '==': return val === arr[0];
    case '!=': return val !== arr[0];
    case '>': return val > arr[0];
    case '>=': return val >= arr[0];
    case '<': return val < arr[0];
    case '<=': return val <= arr[0];
    case 'in': return arr.includes(val);
    case 'not in': return !arr.includes(val);
    case 'contains': return String(val).includes(String(arr[0]));
    case 'between': return val >= arr[0] && val <= arr[arr.length - 1];
    default: return true;
  }
}
function aggregate(op, vals) {
  const xs = vals.filter((v) => v !== null && v !== undefined);
  if (op === 'count') return vals.length;
  if (op === 'distinct') return new Set(xs).size;
  if (!xs.length) return null;
  if (op === 'sum') return xs.reduce((a, b) => a + b, 0);
  if (op === 'avg') return xs.reduce((a, b) => a + b, 0) / xs.length;
  if (op === 'min') return Math.min(...xs);
  if (op === 'max') return Math.max(...xs);
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
/// Run a plan on the rows. Throws with a message the model can act on when the plan is invalid.
function runPlan(plan, data) {
  const colOf = (n, where) => { const c = data.cols.find((x) => x.name === n); if (!c) throw new Error(`unknown column "${n}" in ${where} — columns are: ${data.cols.map((x) => x.name).join(', ')}`); return c; };
  const filters = (Array.isArray(plan.filter) ? plan.filter : []).map((f) => {
    if (!FILTER_OPS[String(f.op).toLowerCase()]) throw new Error(`unknown filter op "${f.op}"`);
    return { ...f, type: colOf(f.col, 'filter').type };
  });
  const bucket = plan.bucket && plan.bucket.col ? { col: plan.bucket.col, unit: ['day', 'week', 'month', 'quarter', 'year'].includes(plan.bucket.unit) ? plan.bucket.unit : 'month' } : null;
  if (bucket && colOf(bucket.col, 'bucket').type !== 'date') throw new Error(`bucket column "${bucket.col}" is not a date`);
  const groupBy = (Array.isArray(plan.groupBy) ? plan.groupBy : plan.groupBy ? [plan.groupBy] : []).filter((g) => g && (!bucket || g !== bucket.col));
  groupBy.forEach((g) => colOf(g, 'groupBy'));
  const dims = [...(bucket ? [{ name: bucket.col, bucket: true }] : []), ...groupBy.map((g) => ({ name: g }))];
  if (dims.length > 2) throw new Error('at most 2 dimensions in total (the bucket counts as one)');
  const ms = (Array.isArray(plan.measures) && plan.measures.length ? plan.measures : [{ op: 'count', as: 'Rows' }]).slice(0, 3).map((m) => {
    const op = String(m.op || '').toLowerCase();
    if (!MEASURE_OPS.includes(op)) throw new Error(`unknown measure op "${m.op}"`);
    let pct = false;
    if (op !== 'count') {
      const c = colOf(m.col, 'measures');
      if (op !== 'distinct' && c.type !== 'number' && c.type !== 'bool') throw new Error(`column "${m.col}" is ${c.type}, so it can't be ${op}-ed`);
      pct = c.type === 'bool' && op === 'avg';
    }
    return { op, col: m.col, as: String(m.as || (op === 'count' ? 'Count' : `${op} of ${m.col}`)), pct };
  });
  const rows = data.rows.filter((r) => filters.every((f) => passes(r[f.col], f, f.type)));
  const groups = new Map();
  rows.forEach((r) => {
    const k = dims.map((d) => (d.bucket ? bucketOf(r[d.name], bucket.unit) : r[d.name] === null || r[d.name] === undefined ? '(blank)' : String(r[d.name])));
    const id = JSON.stringify(k);
    if (!groups.has(id)) groups.set(id, { k, rows: [] });
    groups.get(id).rows.push(r);
  });
  let out = [...groups.values()].map(({ k, rows: g }) => {
    const o = {};
    dims.forEach((d, i) => { o[d.name] = k[i]; });
    ms.forEach((m) => { o[m.as] = aggregate(m.op, m.op === 'count' ? g : g.map((r) => r[m.col])); });
    return o;
  });
  const first = ms[0].as;
  const sortBy = plan.sort && plan.sort.by && (ms.some((m) => m.as === plan.sort.by) || dims.some((d) => d.name === plan.sort.by)) ? plan.sort.by : null;
  const dir = plan.sort && String(plan.sort.dir).toLowerCase() === 'asc' ? 1 : -1;
  const timeFirst = dims[0] && dims[0].bucket;
  if (timeFirst && (!sortBy || sortBy === dims[0].name)) out.sort((a, b) => (a[dims[0].name] < b[dims[0].name] ? -1 : 1));
  else if (sortBy || dims.length) { const by = sortBy || first; out.sort((a, b) => ((a[by] ?? -Infinity) < (b[by] ?? -Infinity) ? 1 : -1) * (sortBy ? -dir : 1)); }
  const limit = Number(plan.limit) > 0 ? Math.floor(Number(plan.limit)) : null;
  let series = null;
  if (dims.length === 2) {
    // Keep the series (second dimension) with the largest totals.
    const tot = {};
    out.forEach((o) => { tot[o[dims[1].name]] = (tot[o[dims[1].name]] || 0) + (o[first] || 0); });
    series = Object.keys(tot).sort((a, b) => tot[b] - tot[a]).slice(0, Math.min(limit || 6, 8));
    out = out.filter((o) => series.includes(o[dims[1].name]));
  } else if (limit) out = out.slice(0, limit);
  else if (dims.length === 1 && !timeFirst) out = out.slice(0, 25);
  const kind = !dims.length ? 'number' : plan.chart === 'table' ? 'table' : timeFirst ? 'line' : 'bar';
  return { dims: dims.map((d) => d.name), measures: ms, rows: out, series, matched: rows.length, total: data.rows.length, kind };
}

// ---- charts ---------------------------------------------------------------------------------
const PAL = ['#0E7490', '#DB2777', '#D97706', '#7C3AED', '#4D7C0F', '#475569', '#0369A1', '#BE123C'];
function Chart({ res }) {
  if (!res.rows.length) return <p className="qy-dim">{'No rows match this query.'}</p>;
  if (res.kind === 'number') return <Kpis res={res} />;
  if (res.kind === 'table') return <ResultTable res={res} />;
  if (res.kind === 'line') return <LineChart res={res} />;
  return <BarChart res={res} />;
}
function Kpis({ res }) {
  return <div className="qy-kpis">{res.measures.map((m) => <div key={m.as}><b>{fmtN(res.rows[0][m.as], m.pct)}</b><span>{m.as}</span></div>)}</div>;
}
function Legend({ names }) {
  return <div className="qy-legend">{names.map((n, i) => <span key={n}><i style={{ background: PAL[i % PAL.length] }} />{n}</span>)}</div>;
}
function LineChart({ res }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const m = res.measures[0];
  const [x, s] = res.dims;
  const xs = [...new Set(res.rows.map((r) => r[x]))].sort();
  const names = s ? res.series : [m.as];
  const val = (xi, name) => { const r = res.rows.find((o) => o[x] === xs[xi] && (!s || o[s] === name)); return r ? r[m.as] : null; };
  const all = xs.flatMap((_, i) => names.map((n) => val(i, n))).filter((v) => v !== null);
  const lo = Math.min(0, ...all);
  const hi = Math.max(...all, lo + 1);
  const W = 640; const H = 240; const L = 52; const R = 12; const T = 12; const B = 28;
  const px = (i) => L + (xs.length > 1 ? (i / (xs.length - 1)) * (W - L - R) : (W - L - R) / 2);
  const py = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + t * (hi - lo));
  const every = Math.ceil(xs.length / 8);
  const move = (e) => {
    const b = ref.current.getBoundingClientRect();
    const fx = ((e.clientX - b.left) / b.width) * W;
    let best = 0;
    xs.forEach((_, i) => { if (Math.abs(px(i) - fx) < Math.abs(px(best) - fx)) best = i; });
    setHover(best);
  };
  return (
    <div className="qy-chart">
      {names.length > 1 && <Legend names={names} />}
      <div className="qy-plot">
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${m.as} by ${x}`} onMouseMove={move} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={py(t)} y2={py(t)} className="qy-gl" /><text x={L - 8} y={py(t) + 4} textAnchor="end" className="qy-ax">{fmtN(t, m.pct)}</text></g>)}
          {xs.map((v, i) => (i % every === 0 ? <text key={v} x={px(i)} y={H - 8} textAnchor="middle" className="qy-ax">{v}</text> : null))}
          {names.map((n, si) => {
            const pts = xs.map((_, i) => [i, val(i, n)]).filter(([, v]) => v !== null);
            return (
              <g key={n}>
                <path d={pts.map(([i, v], k) => `${k ? 'L' : 'M'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(' ')} fill="none" stroke={PAL[si % PAL.length]} strokeWidth="2.2" strokeLinejoin="round" />
                {xs.length <= 24 && pts.map(([i, v]) => <circle key={i} cx={px(i)} cy={py(v)} r={hover === i ? 4.5 : 2.6} fill={PAL[si % PAL.length]} />)}
              </g>
            );
          })}
          {hover !== null && <line x1={px(hover)} x2={px(hover)} y1={T} y2={H - B} className="qy-rule" />}
        </svg>
        {hover !== null && (
          <div className="qy-tip" style={{ left: `${(px(hover) / W) * 100}%` }}>
            <b>{xs[hover]}</b>
            {names.map((n, si) => <span key={n}><i style={{ background: PAL[si % PAL.length] }} />{names.length > 1 ? `${n} ` : ''}<em>{fmtN(val(hover, n), m.pct)}</em></span>)}
          </div>
        )}
      </div>
    </div>
  );
}
function BarChart({ res }) {
  const [hover, setHover] = useState(null);
  const m = res.measures[0];
  const [x, s] = res.dims;
  if (!s) {
    const max = Math.max(...res.rows.map((r) => Math.abs(r[m.as] || 0)), 1e-9);
    return (
      <ol className="qy-bars">
        {res.rows.map((r, i) => (
          <li key={r[x]} className={hover === i ? 'on' : ''} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="qy-bl" title={r[x]}>{r[x]}</span>
            <span className="qy-bt"><span style={{ width: `${(Math.abs(r[m.as] || 0) / max) * 100}%`, background: PAL[0] }} /></span>
            <span className="qy-bv">{fmtN(r[m.as], m.pct)}</span>
          </li>
        ))}
      </ol>
    );
  }
  const cats = [...new Set(res.rows.map((r) => r[x]))];
  const tot = (c) => res.rows.filter((r) => r[x] === c).reduce((a, r) => a + Math.max(0, r[m.as] || 0), 0);
  const max = Math.max(...cats.map(tot), 1e-9);
  return (
    <div className="qy-chart">
      <Legend names={res.series} />
      <ol className="qy-bars">
        {cats.slice(0, 20).map((c) => (
          <li key={c}>
            <span className="qy-bl" title={c}>{c}</span>
            <span className="qy-bt stack">
              {res.series.map((n, si) => {
                const r = res.rows.find((o) => o[x] === c && o[s] === n);
                const v = r ? Math.max(0, r[m.as] || 0) : 0;
                return v ? <span key={n} style={{ width: `${(v / max) * 100}%`, background: PAL[si % PAL.length] }} title={`${n}: ${fmtN(v, m.pct)}`} /> : null;
              })}
            </span>
            <span className="qy-bv">{fmtN(tot(c), m.pct)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
function ResultTable({ res }) {
  return (
    <div className="qy-tablewrap">
      <table className="qy-table">
        <thead><tr>{res.dims.map((d) => <th key={d}>{d}</th>)}{res.measures.map((m) => <th key={m.as} className="n">{m.as}</th>)}</tr></thead>
        <tbody>{res.rows.slice(0, 200).map((r, i) => <tr key={i}>{res.dims.map((d) => <td key={d}>{r[d]}</td>)}{res.measures.map((m) => <td key={m.as} className="n">{fmtN(r[m.as], m.pct)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/// The words of a plan, readable: what was filtered, grouped and measured.
function planLine(p) {
  const parts = [];
  (p.measures || []).forEach((m) => parts.push(m.op === 'count' ? 'count rows' : `${m.op} of ${m.col}`));
  if (p.bucket && p.bucket.col) parts.push(`per ${p.bucket.unit || 'month'} of ${p.bucket.col}`);
  (Array.isArray(p.groupBy) ? p.groupBy : []).forEach((g) => parts.push(`by ${g}`));
  (Array.isArray(p.filter) ? p.filter : []).forEach((f) => parts.push(`where ${f.col} ${f.op} ${Array.isArray(f.value) ? f.value.join('–') : f.value}`));
  if (p.limit) parts.push(`top ${p.limit}`);
  return parts.join(' · ');
}

const HOW = (
  <>
    <p>{'Quarry splits the work so numbers are never made up:'}</p>
    <ol>
      <li><b>{'Plan'}</b>{' — the model gets the question and the table\'s schema (column types, ranges, top values, five example rows) — never the rows — and replies with a query plan in JSON.'}</li>
      <li><b>{'Compute'}</b>{' — a small engine in this page validates the plan and runs it on every row: filters, time buckets, groups, sums, rates, medians. An invalid plan goes back to the model once with the error, so it can fix it.'}</li>
      <li><b>{'Narrate'}</b>{' — a second call gets only the computed result and writes the answer, citing those numbers.'}</li>
      <li><b>{'Quality'}</b>{' — the page checks every row for empty cells, extreme outliers, inconsistent spellings, future dates and duplicates; one call sees only the schema and those findings and says what to fix first.'}</li>
      <li><b>{'Explore'}</b>{' — six of these chains (trend, breakdown, change, anomaly, mix, ranking) run side by side, then one streamed call turns the six results into a briefing.'}</li>
    </ol>
    <h4>{'Your data'}</h4>
    <p>{'Upload a CSV: types are inferred in the page. Only the schema, five example rows and the computed results are sent to the network.'}</p>
    <h4>{'Make it yours'}</h4>
    <p>{'Point the engine at your warehouse instead: have the model write the same JSON plan, compile it to SQL with a whitelist of tables and columns, and keep the narrate step.'}</p>
  </>
);

// ---- the app --------------------------------------------------------------------------------
const uid = () => Math.random().toString(36).slice(2, 9);
const SAMPLE_NAME = 'ember_orders_2026';

export default function Quarry() {
  useSeo({ title: 'Quarry data analyst · a Resonance sample', description: 'Ask a table questions in plain words: a model on the Resonance network plans the query, the page computes it on every row, and charts and answers cite real numbers. Six analyses side by side, then a briefing. Bring your own CSV.', path: '/samples/data' });
  const net = useNetwork({ prefer: 'text-generation' });
  const narrow = useMedia('(max-width: 900px)');
  const [saved, setSaved] = useStored('quarry.upload', null); // { name, csv } of an uploaded CSV
  const [temp, setTemp] = useState(null); // an upload too large to keep in this browser
  const [thread, setThread] = useStored('quarry.thread', [], (t) => (t || []).filter((a) => !a.busy));
  const [pins, setPins] = useStored('quarry.pins', []);
  const [view, setView] = useState('ask'); // ask | explore | board
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [explore, setExplore] = useState([]); // [{ id, lens, plan?, text?, error?, busy }]
  const [brief, setBrief] = useState('');
  const [qNote, setQNote] = useState('');
  const [qBusy, setQBusy] = useState(false);
  const [briefing, setBriefing] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [msg, setMsg] = useState('');

  const source = temp || saved;
  const data = useMemo(() => {
    if (source) { const rows = parseCsv(source.csv); return { name: source.name, ...typeTable(rows[0] || [], rows.slice(1), rows.delim === ';') }; }
    return { name: SAMPLE_NAME, cols: SAMPLE_COLS.map(([name, type]) => ({ name, type })), rows: sampleRows() };
  }, [source]);
  const prof = useMemo(() => profile(data), [data]);
  const issues = useMemo(() => quality(data, prof), [data, prof]);
  // The model sees the schema and the issues found in code — never the rows.
  const explainQuality = async () => {
    setQBusy(true); setQNote('');
    try {
      await chat({ ...net.call, maxTokens: 700, temperature: 0.3, onDelta: (_, all) => setQNote(all), messages: [
        { role: 'system', content: 'You are a data engineer. Given a table schema and the data-quality issues found by code, explain in markdown which issues would distort which kinds of analysis, the order to fix them in, and how (one concrete step each, e.g. a cleaning rule). Be brief: a short list, no preamble. Do not invent issues.' },
        { role: 'user', content: `${schemaText(data.name, data, prof)}\n\nIssues found:\n${issues.map((i) => `- ${i.col}: ${i.kind} — ${i.detail}`).join('\n') || 'none'}` },
      ] });
    } catch (e) { setQNote(`Could not explain: ${e.message}`); }
    setQBusy(false);
  };
  const schema = useMemo(() => schemaText(data.name, data, prof), [data, prof]);

  // Plan → compute (one repair round if the plan is invalid) → narrate.
  const answer = async (question, extra = {}) => {
    const messages = [{ role: 'system', content: PLAN_SYS(schema) }, { role: 'user', content: extra.lens ? `Lens: ${extra.lens}. Pick the single most revealing question for this lens on this table, and plan it.` : question }];
    let plan = await chatJson({ ...net.call, maxTokens: 500, temperature: 0.1, messages });
    let res;
    try { res = runPlan(plan, data); } catch (e) {
      plan = await chatJson({ ...net.call, maxTokens: 500, temperature: 0.1, messages: [...messages, { role: 'assistant', content: JSON.stringify(plan) }, { role: 'user', content: `That plan failed: ${e.message}. Reply with the corrected JSON plan only.` }] });
      res = runPlan(plan, data);
    }
    const text = await chat({
      ...net.call, maxTokens: 220, temperature: 0.3, onDelta: extra.onDelta,
      messages: [{ role: 'system', content: NARRATE_SYS }, { role: 'user', content: JSON.stringify({ question: plan.question || question, query: planLine(plan), matched_rows: res.matched, total_rows: res.total, result: res.rows.slice(0, 40).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => { const m = res.measures.find((x) => x.as === k); return [k, m && m.pct && v !== null ? `${(v * 100).toFixed(1)}%` : v]; }))) }) }],
    });
    return { plan, text };
  };

  const ask = async (question) => {
    const qq = question.trim();
    if (!qq || !net.ready) return;
    const id = uid();
    setQ(''); setBusy(true); setView('ask');
    setThread((t) => [{ id, q: qq, busy: true, data: data.name }, ...t].slice(0, 16));
    const patch = (p) => setThread((t) => t.map((a) => (a.id === id ? { ...a, ...p } : a)));
    try {
      const { plan, text } = await answer(qq, { onDelta: (_, all) => patch({ text: all }) });
      patch({ plan, text, busy: false });
    } catch (e) { patch({ error: e.message, busy: false }); } finally { setBusy(false); }
  };

  const runExplore = async () => {
    setView('explore'); setBrief('');
    const cards = LENSES.map((lens) => ({ id: uid(), lens, busy: true }));
    setExplore(cards);
    const patch = (id, p) => setExplore((xs) => xs.map((c) => (c.id === id ? { ...c, ...p } : c)));
    const res = await pool(cards.map((c) => async () => {
      try { const r = await answer('', { lens: c.lens }); patch(c.id, { ...r, busy: false }); return r; } catch (e) { patch(c.id, { error: e.message, busy: false }); throw e; }
    }), 6);
    const ok = res.filter((r) => r.ok).map((r) => r.value);
    if (!ok.length) return;
    setBriefing(true);
    try {
      await chat({
        ...net.call, maxTokens: 450, temperature: 0.3, onDelta: (_, all) => setBrief(all),
        messages: [{ role: 'system', content: 'You write a short data briefing for a team. You get several analyses, each with its question and its computed answer. Write 4 bullet points ("- "), each one finding with its number, most important first, then one line starting with "Worth checking:" naming what to dig into next. Use only the numbers given.' }, { role: 'user', content: JSON.stringify(ok.map((r) => ({ question: r.plan.question, answer: r.text }))) }],
      });
    } catch (e) { setBrief((b) => `${b}\n\n(${e.message})`); } finally { setBriefing(false); }
  };

  const pin = (a) => setPins((ps) => (ps.some((p) => p.id === a.id) ? ps.filter((p) => p.id !== a.id) : [{ id: a.id, q: a.q || (a.plan && a.plan.question), plan: a.plan, text: a.text, data: data.name }, ...ps]));
  const pinned = (id) => pins.some((p) => p.id === id);

  const onFile = async (file) => {
    if (!file) return;
    try {
      const csv = await readText(file);
      const rows = parseCsv(csv);
      if (rows.length < 2) throw new Error('needs a header row and at least one data row');
      const next = { name: file.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_'), csv };
      // Keep it for next time only if it fits comfortably in this browser's storage.
      const small = csv.length < 1500000;
      setSaved(small ? next : null);
      setTemp(small ? null : next);
      setMsg(small ? `Loaded ${rows.length - 1} rows from ${file.name}.` : 'Large file: used for this visit only, not saved in this browser.');
      setExplore([]); setBrief('');
    } catch (e) { setMsg(`Could not read that file: ${e.message}`); }
  };
  const toSample = () => { setSaved(null); setTemp(null); setExplore([]); setBrief(''); setMsg('Back to the sample data.'); };

  const rail = (
    <aside className={`qy-rail${narrow && !railOpen ? ' closed' : ''}`}>
      <button type="button" className="qy-railh" onClick={() => setRailOpen((o) => !o)} aria-expanded={!narrow || railOpen}>
        <span className="qy-k">{'Dataset'}</span>
        <b>{data.name}</b>
        <span className="qy-dim">{`${data.rows.length.toLocaleString('en-US')} rows · ${data.cols.length} columns`}</span>
      </button>
      <div className="qy-railb">
        <div className="qy-row">
          <label className="qy-btn ghost file">{'Upload CSV'}<input type="file" accept=".csv,.tsv,text/csv" onChange={(e) => onFile(e.target.files[0])} /></label>
          {data.name !== SAMPLE_NAME && <button type="button" className="qy-btn ghost" onClick={toSample}>{'Use sample'}</button>}
          <button type="button" className="qy-btn ghost" onClick={() => download(`${data.name}.csv`, toCsv(data.cols.map((c) => c.name), data.rows), 'text/csv')}>{'Download'}</button>
        </div>
        {msg && <p className="qy-msg">{msg}</p>}
        {data.name === SAMPLE_NAME && <p className="qy-dim">{'Orders of Ember, a made-up coffee roaster, Jan–Oct 2026 — generated in this page.'}</p>}
        <ul className="qy-cols">
          {prof.map((p) => (
            <li key={p.name}>
              <div><b>{p.name}</b><span className={`qy-type t-${p.type}`}>{p.type}</span></div>
              {p.bins ? <Spark bins={p.bins} /> : p.top ? <span className="qy-dim">{p.top.slice(0, 3).map(([v]) => v).join(' · ')}{p.distinct > 3 ? ` · +${p.distinct - 3}` : ''}</span> : null}
              <span className="qy-dim sm">{p.type === 'number' ? `${fmtN(p.min)} – ${fmtN(p.max)} · mean ${fmtN(p.mean)}` : p.type === 'bool' ? `${fmtN(p.mean, true)} true` : p.type === 'date' ? `${p.min} → ${p.max}` : `${p.distinct} values`}</span>
            </li>
          ))}
        </ul>
        <p className="qy-dim sm">{'The model sees this schema and five example rows. The rows themselves stay in this page.'}</p>
      </div>
    </aside>
  );

  const shownThread = thread.filter((a) => a.data === data.name);
  return (
    <div className="qy">
      <header className="qy-top">
        <div className="qy-brand"><QuarryLogo size={32} /><b>{'Quarry'}</b></div>
        <nav className="qy-tabs" aria-label="View">
          {[['ask', 'Ask'], ['explore', 'Explore'], ['quality', `Quality${issues.length ? ` · ${issues.length}` : ''}`], ['board', `Board${pins.length ? ` · ${pins.length}` : ''}`]].map(([id, label]) => <button type="button" key={id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>{label}</button>)}
        </nav>
        {net.key && <select className="qy-model" value={net.model} onChange={(e) => net.setModel(e.target.value)} aria-label="Model">{net.models.map((m) => <option key={m} value={m}>{m}</option>)}</select>}
      </header>

      <div className="qy-body">
        {rail}
        <main className="qy-main">
          <h1 className="qy-h">{view === 'ask' ? 'Ask your data' : view === 'explore' ? 'Explore' : view === 'quality' ? 'Data quality' : 'Board'}</h1>
          {net.loaded && !net.key && <Connect net={net} />}

          {view === 'ask' && (
            <>
              <form className="qy-ask" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask anything about ${data.name}…`} aria-label="Question" />
                <button type="submit" className="qy-btn" disabled={!net.ready || busy || !q.trim()}>{busy ? 'Working…' : 'Ask'}</button>
              </form>
              {data.name === SAMPLE_NAME && <div className="qy-sugg">{SAMPLE_ASKS.map((s) => <button type="button" key={s} disabled={!net.ready || busy} onClick={() => ask(s)}>{s}</button>)}</div>}
              {!shownThread.length && <Empty title="Questions become charts" body="Ask in plain words. The answer comes with the chart it was computed from, the query that produced it and the rows it matched." />}
              <div className="qy-thread">{shownThread.map((a) => <Answer key={a.id} a={a} data={data} pinned={pinned(a.id)} onPin={() => pin(a)} onRetry={() => { setThread((t) => t.filter((x) => x.id !== a.id)); ask(a.q); }} onRemove={() => setThread((t) => t.filter((x) => x.id !== a.id))} />)}</div>
            </>
          )}

          {view === 'explore' && (
            <>
              <div className="qy-explore-h">
                <p>{'Six analysts take a different lens on the table — trend, breakdown, change, anomaly, mix, ranking — all at once. Each plans its query, the page computes it, and one call writes the briefing.'}</p>
                <button type="button" className="qy-btn" disabled={!net.ready || explore.some((c) => c.busy) || briefing} onClick={runExplore}>{explore.length ? 'Explore again' : 'Explore this table'}</button>
              </div>
              {(brief || briefing) && <section className="qy-brief"><span className="qy-k">{briefing ? 'Writing the briefing…' : 'Briefing'}</span><Md text={brief} /></section>}
              {!explore.length && <Empty title="Six angles at once" body="Each card is its own chain of calls — plan, compute, narrate — and the six run side by side on the network." />}
              <div className="qy-grid">{explore.map((c) => <Answer key={c.id} a={{ ...c, q: c.plan && c.plan.question }} lens={c.lens} data={data} pinned={pinned(c.id)} onPin={() => pin(c)} compact />)}</div>
            </>
          )}

          {view === 'quality' && (
            <>
              <div className="qy-explore-h">
                <p>{'The checks run in this page on every row — nothing is sent for them. Then one call reads only the schema and these findings, and says what they would distort and how to fix them.'}</p>
                <button type="button" className="qy-btn" disabled={!net.ready || qBusy || !issues.length} onClick={explainQuality}>{qBusy ? 'Explaining…' : 'Explain and suggest fixes'}</button>
              </div>
              {!issues.length && <Empty title="No issues found" body="No empty cells, extreme outliers, inconsistent spellings, future dates or duplicate rows." />}
              {issues.length > 0 && (
                <table className="qy-qtable">
                  <thead><tr><th>{'Column'}</th><th>{'Issue'}</th><th>{'Detail'}</th></tr></thead>
                  <tbody>{issues.map((i) => <tr key={`${i.col}|${i.kind}`}><td><code>{i.col}</code></td><td><span className="qy-k">{i.kind}</span></td><td>{i.detail}</td></tr>)}</tbody>
                </table>
              )}
              {qNote && <section className="qy-brief"><span className="qy-k">{qBusy ? 'Writing…' : 'What to fix first'}</span><Md text={qNote} /></section>}
            </>
          )}

          {view === 'board' && (
            <>
              {!pins.length && <Empty title="Nothing pinned yet" body="Pin an answer or an Explore card and it lands here, recomputed from your data every time you open it." />}
              <div className="qy-grid">{pins.map((p) => (p.data === data.name ? <Answer key={p.id} a={p} data={data} pinned onPin={() => pin(p)} compact /> : <div key={p.id} className="qy-card off"><b>{p.q}</b><span className="qy-dim">{`Pinned on ${p.data} — load that dataset to see it.`}</span><button type="button" className="qy-link" onClick={() => setPins((ps) => ps.filter((x) => x.id !== p.id))}>{'Remove'}</button></div>))}</div>
            </>
          )}
        </main>
      </div>
      <DevPanel net={net} app="Quarry" how={HOW} slug="data" />
    </div>
  );
}

function Answer({ a, data, pinned, onPin, onRetry, onRemove, lens, compact }) {
  const [show, setShow] = useState('chart'); // chart | table | plan
  const res = useMemo(() => { if (!a.plan) return null; try { return runPlan(a.plan, data); } catch (e) { return { error: e.message }; } }, [a.plan, data]);
  return (
    <article className={`qy-card${compact ? ' compact' : ''}${a.busy ? ' busy' : ''}`}>
      <header>
        <div>
          {lens && <span className="qy-k">{lens.split(':')[0]}</span>}
          <h3>{(a.plan && a.plan.title) || a.q || (a.busy ? 'Planning…' : 'Untitled')}</h3>
          {a.q && a.plan && a.plan.title && <p className="qy-q">{a.q}</p>}
        </div>
        {a.plan && <button type="button" className={`qy-pin${pinned ? ' on' : ''}`} onClick={onPin} aria-pressed={pinned} title={pinned ? 'Unpin' : 'Pin to board'}>{pinned ? '★' : '☆'}</button>}
      </header>
      {a.busy && !a.plan && <div className="qy-skel"><span /><span /><span /></div>}
      {a.error && <p className="qy-err">{a.error}{onRetry && <button type="button" className="qy-link" onClick={onRetry}>{'Try again'}</button>}</p>}
      {res && res.error && <p className="qy-err">{`This query no longer runs on ${data.name}: ${res.error}`}</p>}
      {res && !res.error && (
        <>
          <nav className="qy-seg" aria-label="Show">
            {[['chart', res.kind === 'number' ? 'Number' : 'Chart'], ['table', 'Table'], ['plan', 'Query']].map(([id, l]) => <button type="button" key={id} className={show === id ? 'on' : ''} onClick={() => setShow(id)}>{l}</button>)}
            <span className="qy-dim sm">{`${res.matched.toLocaleString('en-US')} of ${res.total.toLocaleString('en-US')} rows`}</span>
          </nav>
          {show === 'chart' && <Chart res={res} />}
          {show === 'table' && <><ResultTable res={res} /><button type="button" className="qy-link" onClick={() => download('result.csv', toCsv([...res.dims, ...res.measures.map((m) => m.as)], res.rows), 'text/csv')}>{'Download result as CSV'}</button></>}
          {show === 'plan' && <><p className="qy-planline">{planLine(a.plan)}</p><pre className="qy-pre">{JSON.stringify(a.plan, null, 2)}</pre><p className="qy-dim sm">{'Written by the model from the schema; validated and run on every row by this page.'}</p></>}
        </>
      )}
      {a.text && <p className="qy-text">{a.text}</p>}
      {onRemove && !a.busy && <button type="button" className="qy-link mute" onClick={onRemove}>{'Remove'}</button>}
    </article>
  );
}

function Spark({ bins }) {
  const max = Math.max(...bins, 1);
  return <svg className="qy-spark" viewBox={`0 0 ${bins.length * 6} 20`} preserveAspectRatio="none" aria-hidden="true">{bins.map((b, i) => <rect key={i} x={i * 6} y={20 - (b / max) * 20} width="5" height={(b / max) * 20} />)}</svg>;
}
function Md({ text }) {
  const lines = String(text || '').split('\n').filter((l) => l.trim());
  const bold = (s) => s.split(/(\*\*[^*]+\*\*)/).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p));
  const items = lines.filter((l) => /^\s*[-*•]\s/.test(l));
  const rest = lines.filter((l) => !/^\s*[-*•]\s/.test(l));
  return <>{items.length > 0 && <ul>{items.map((l, i) => <li key={i}>{bold(l.replace(/^\s*[-*•]\s/, ''))}</li>)}</ul>}{rest.map((l, i) => <p key={i}>{bold(l)}</p>)}</>;
}
function Empty({ title, body }) {
  return <div className="qy-empty"><svg viewBox="0 0 120 60" aria-hidden="true"><path d="M4 52 L30 30 L52 40 L78 14 L116 26" fill="none" strokeWidth="3" /><circle cx="78" cy="14" r="5" /></svg><b>{title}</b><span>{body}</span></div>;
}
function Connect({ net }) {
  const [k, setK] = useState('');
  return (
    <form className="qy-connect" onSubmit={(e) => { e.preventDefault(); net.setKey(k); }}>
      <div><b>{'Connect an analyst'}</b><span>{'Plans and answers are written by models on the Resonance network. Paste a node or logical node key — it stays in this browser.'}</span></div>
      <div className="qy-row"><input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="rk_…" aria-label="Resonance API key" autoComplete="off" /><button type="submit" className="qy-btn" disabled={!k.trim()}>{'Connect'}</button></div>
    </form>
  );
}
