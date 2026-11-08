import React, { useMemo, useRef, useState } from 'react';
import { useSeo } from '@shared/lib/useSeo';
import { chat, chatJson, pool } from './api';
import { DevPanel, download, settled, useNetwork, useStored } from './network';
import { LintelLogo } from './logos';
import './lintel.css';

// Lintel — pull-request review on the network's coding models. Every file of the diff is
// reviewed in parallel (JSON findings tied to line numbers), one call weighs them into a
// verdict, and fixes and tests are streamed on demand. The sample PR is made up.
const SAMPLE = `diff --git a/src/server/auth.ts b/src/server/auth.ts
--- a/src/server/auth.ts
+++ b/src/server/auth.ts
@@ -1,8 +1,22 @@
 import { Request, Response, NextFunction } from 'express';
 import { getInvite } from './invites';
+import { logger } from '../lib/logger';

 export function requireUser(req: Request, res: Response, next: NextFunction) {
   if (!req.session?.userId) return res.status(401).end();
   next();
 }
+
+export async function verifyInviteToken(req: Request, res: Response, next: NextFunction) {
+  const token = String(req.query.token || '');
+  logger.info(\`verifying invite token \${token}\`);
+  const invite = await getInvite(req.params.id);
+  if (!invite) return res.status(404).json({ error: 'not found' });
+  if (invite.token === token) {
+    if (invite.expiresAt < Date.now()) {
+      req.invite = invite;
+      return next();
+    }
+  }
+  return res.status(403).json({ error: 'invalid token' });
+}
diff --git a/src/server/invites.ts b/src/server/invites.ts
new file mode 100644
--- /dev/null
+++ b/src/server/invites.ts
@@ -0,0 +1,24 @@
+import crypto from 'crypto';
+import { db } from '../lib/db';
+import { sendMail } from '../lib/mail';
+
+const THIRTY_DAYS = 30 * 24 * 3600 * 1000;
+
+export async function createInvite(teamId: string, email: string, invitedBy: string) {
+  const existing = await db.query(\`SELECT * FROM invites WHERE team_id = '\${teamId}' AND email = '\${email}'\`);
+  if (existing.rows.length) return existing.rows[0];
+  const token = crypto.randomBytes(4).toString('hex');
+  const invite = { teamId, email, invitedBy, token, expiresAt: Date.now() + THIRTY_DAYS };
+  await db.query('INSERT INTO invites (team_id, email, invited_by, token, expires_at) VALUES ($1, $2, $3, $4, $5)',
+    [teamId, email, invitedBy, token, invite.expiresAt]);
+  await sendMail(email, 'You are invited', \`Join here: https://app.wavelet.io/invite?token=\${token}\`);
+  return invite;
+}
+
+export async function getInvite(id: string) {
+  const r = await db.query('SELECT * FROM invites WHERE id = $1', [id]);
+  return r.rows[0];
+}
+
+export async function listInvites(teamId: string) {
+  return (await db.query('SELECT * FROM invites WHERE team_id = $1', [teamId])).rows;
+}
diff --git a/src/web/InviteList.tsx b/src/web/InviteList.tsx
new file mode 100644
--- /dev/null
+++ b/src/web/InviteList.tsx
@@ -0,0 +1,28 @@
+import { useEffect, useState } from 'react';
+import { paginate } from '../lib/paginate';
+
+type Invite = { id: string; email: string; invitedBy: string; expiresAt: number };
+
+export function InviteList({ teamId }: { teamId: string }) {
+  const [invites, setInvites] = useState<Invite[]>([]);
+  const [page, setPage] = useState(0);
+
+  useEffect(() => {
+    fetch(\`/api/teams/\${teamId}/invites\`).then((r) => r.json()).then(setInvites);
+  }, []);
+
+  return (
+    <div>
+      <h2>Pending invites ({invites.length})</h2>
+      <ul>
+        {paginate(invites, page, 10).map((inv) => (
+          <li>
+            <span dangerouslySetInnerHTML={{ __html: inv.email }} />
+            <small> invited by {inv.invitedBy}</small>
+          </li>
+        ))}
+      </ul>
+      <button onClick={() => setPage(page + 1)}>Next</button>
+    </div>
+  );
+}
diff --git a/src/lib/paginate.ts b/src/lib/paginate.ts
--- a/src/lib/paginate.ts
+++ b/src/lib/paginate.ts
@@ -1,3 +1,5 @@
 export function paginate<T>(items: T[], page: number, size: number): T[] {
-  return items.slice(page * size, (page + 1) * size);
+  if (size <= 0) return [];
+  const start = page * size + 1;
+  return items.slice(start, start + size);
 }
`;
const SEV = ['blocker', 'major', 'minor', 'nit'];
const REVIEW = 'You are a senior engineer reviewing ONE file of a pull request. Lines are prefixed with their new line number and +, - or space. Comment only on added (+) lines. Reply ONLY with JSON: {"findings": [{"line": <new line number>, "severity": "blocker" | "major" | "minor" | "nit", "kind": "bug" | "security" | "performance" | "maintainability" | "test", "title": <short>, "detail": <1-2 sentences: what goes wrong and when>, "suggestion": <replacement code for that line or "">}], "summary": <one sentence about the file>}. Be precise; no praise; [] if the file is fine.';
// The security pass: a second reviewer per file, in parallel with the first, that looks only
// for what an attacker would use. Its findings are tagged so they stand out in the diff.
const SECURITY = 'You are an application security reviewer looking at ONE file of a pull request. Lines are prefixed with their new line number and +, - or space. Comment only on added (+) lines, and ONLY on security: injection (SQL, shell, template), XSS, secrets or keys in code, missing authentication or authorization checks, unsafe deserialization, path traversal, SSRF, weak crypto or randomness, sensitive data in logs. Reply ONLY with JSON: {"findings": [{"line": <new line number>, "severity": "blocker" | "major" | "minor", "title": <short>, "detail": <how it can be exploited, 1-2 sentences>, "suggestion": <replacement code for that line or "">}]}. [] if there is nothing exploitable — do not pad.';
const VERDICT = 'You decide on a pull request from its per-file review findings. Reply ONLY with JSON: {"verdict": "approve" | "comment" | "request_changes", "risk": <1-5>, "headline": <one short sentence>, "summary": <2-3 sentences for the author>, "must_fix": [<titles of findings that block merging>]}.';

const HOW = (
  <>
    <p>{'Lintel reviews like a team would — each file by its own reviewer, then a lead decides:'}</p>
    <ol>
      <li><b>{'Review'}</b>{' — one request per file, all at once, on a coding model. Each returns findings as JSON tied to a line number, so they render inline in the diff.'}</li>
      <li><b>{'Security pass'}</b>{' — a second reviewer per file, at the same time as the first, looking only for what an attacker would use. Its findings are tagged 🔒 in the diff.'}</li>
      <li><b>{'Verdict'}</b>{' — one request reads every finding and returns approve / comment / request changes, a 1–5 risk and the must-fix list.'}</li>
      <li><b>{'Write the fix'}</b>{' and '}<b>{'Generate tests'}</b>{' — streamed on demand, with the file\'s diff as context.'}</li>
    </ol>
    <h4>{'Make it yours'}</h4>
    <p>{'Call it from CI with the PR\'s diff (git diff origin/main...), post the findings as review comments, and give the CI runner a logical node key so review traffic is metered on its own.'}</p>
  </>
);

/// Unified diff → files with numbered lines.
function parseDiff(text) {
  const files = [];
  let f = null;
  let n = 0;
  let o = 0;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (raw.startsWith('diff --git')) { f = { path: (raw.match(/ b\/(.+)$/) || [])[1] || 'file', lines: [], add: 0, del: 0, isNew: false }; files.push(f); continue; }
    if (!f) continue;
    if (raw.startsWith('new file')) { f.isNew = true; continue; }
    if (raw.startsWith('+++ ')) { const p = raw.slice(4).replace(/^b\//, ''); if (p !== '/dev/null') f.path = p; continue; }
    if (raw.startsWith('--- ') || raw.startsWith('index ')) continue;
    const h = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (h) { o = Number(h[1]); n = Number(h[2]); f.lines.push({ t: 'hunk', text: raw }); continue; }
    if (raw.startsWith('+')) { f.lines.push({ t: 'add', n: n++, text: raw.slice(1) }); f.add++; }
    else if (raw.startsWith('-')) { f.lines.push({ t: 'del', o: o++, text: raw.slice(1) }); f.del++; }
    else if (raw.startsWith(' ') || raw === '') { if (f.lines.length) f.lines.push({ t: 'ctx', n: n++, o: o++, text: raw.slice(1) }); }
  }
  return files.filter((x) => x.lines.length);
}
const numbered = (f) => f.lines.filter((l) => l.t !== 'hunk').map((l) => `${String(l.n ?? '').padStart(4)} ${l.t === 'add' ? '+' : l.t === 'del' ? '-' : ' '} ${l.text}`).join('\n');
// Very large files are cut for the reviewer, so one file can't blow a model's context.
const MAX_LINES = 500;
const forReview = (f) => { const all = numbered(f).split('\n'); return all.length > MAX_LINES ? `${all.slice(0, MAX_LINES).join('\n')}\n… (${all.length - MAX_LINES} more lines not shown)` : all.join('\n'); };
const SAMPLE_PR = { diff: SAMPLE, title: '#482 Add team invites', repo: 'wavelet / web', branch: 'feat/invites → main' };

/// A public GitHub pull request: its title and branches, and its diff (GitHub's API allows
/// unauthenticated browser calls, about 60 an hour).
async function fetchPr(url) {
  const m = String(url).match(/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/);
  if (!m) throw new Error('expected a link like https://github.com/owner/repo/pull/123');
  const api = `https://api.github.com/repos/${m[1]}/${m[2]}/pulls/${m[3]}`;
  const [meta, diff] = await Promise.all([
    fetch(api, { headers: { accept: 'application/vnd.github+json' } }),
    fetch(api, { headers: { accept: 'application/vnd.github.v3.diff' } }),
  ]);
  if (!meta.ok || !diff.ok) throw new Error(meta.status === 404 ? 'not found — is the repository public?' : meta.status === 403 ? 'GitHub rate limit reached, try again later' : `GitHub said HTTP ${meta.status}`);
  const j = await meta.json();
  const text = await diff.text();
  if (text.length > 400000) throw new Error('this PR is too large for a sample (over 400 KB of diff)');
  return { diff: text, title: `#${j.number} ${j.title}`, repo: `${m[1]} / ${m[2]}`, branch: `${j.head && j.head.ref} → ${j.base && j.base.ref}`, url: j.html_url };
}
const lang = (p) => (/\.(tsx?|jsx?)$/.test(p) ? 'TypeScript' : /\.py$/.test(p) ? 'Python' : /\.rs$/.test(p) ? 'Rust' : /\.go$/.test(p) ? 'Go' : 'code');

export default function Review() {
  useSeo({ title: 'Lintel code review · a Resonance sample', description: 'Pull-request review on the Resonance network: every file reviewed in parallel, a verdict, and fixes and tests on demand.', path: '/samples/review' });
  const net = useNetwork({ prefer: 'coding' });
  const [pr, setPr] = useStored('lintel.pr', SAMPLE_PR);
  const diff = pr.diff;
  const files = useMemo(() => parseDiff(diff), [diff]);
  const [rev, setRev] = useStored('lintel.review', {}, settled); // path -> { pending } | { findings, summary } | { error }
  const [verdict, setVerdict] = useStored('lintel.verdict', null);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [paste, setPaste] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [secPass, setSecPass] = useStored('lintel.security', true);
  const refs = useRef({});

  const run = async () => {
    setError(''); setVerdict(null); setPhase('review');
    setRev(Object.fromEntries(files.map((f) => [f.path, { pending: true }])));
    const res = await pool(files.map((f) => async () => {
      try {
        const user = `File: ${f.path} (${lang(f.path)}${f.isNew ? ', new file' : ''})\n\n${forReview(f)}`;
        // Both reviewers of a file run at the same time: twice the requests, the same wait.
        const [j, sj] = await Promise.all([
          chatJson({ ...net.call, maxTokens: 900, temperature: 0.1, messages: [{ role: 'system', content: REVIEW }, { role: 'user', content: user }] }),
          secPass ? chatJson({ ...net.call, maxTokens: 700, temperature: 0.1, messages: [{ role: 'system', content: SECURITY }, { role: 'user', content: user }] }).catch(() => ({ findings: [] })) : Promise.resolve({ findings: [] }),
        ]);
        const lines = new Set(f.lines.filter((l) => l.n != null).map((l) => l.n));
        const sec = (Array.isArray(sj.findings) ? sj.findings : []).map((x) => ({ ...x, kind: 'security', pass: 'security' }));
        // A line the general reviewer already flagged as security keeps one finding, not two.
        const general = Array.isArray(j.findings) ? j.findings : [];
        const merged = [...general, ...sec.filter((x) => !general.some((g) => Number(g.line) === Number(x.line) && g.kind === 'security'))];
        const findings = merged.filter((x) => x && lines.has(Number(x.line))).map((x, k) => ({ ...x, id: `${f.path}:${k}`, line: Number(x.line), severity: SEV.includes(x.severity) ? x.severity : 'minor' }));
        const r = { findings, summary: String(j.summary || '') };
        setRev((s) => ({ ...s, [f.path]: r }));
        return r;
      } catch (e) { setRev((s) => ({ ...s, [f.path]: { error: e.message } })); throw e; }
    }), 6);
    const bad = res.filter((r) => !r.ok);
    if (bad.length) setError(`${bad.length} file(s) could not be reviewed: ${bad[0].error.message}`);
    const all = files.flatMap((f, i) => (res[i].ok ? res[i].value.findings.map((x) => `${f.path}:${x.line} [${x.severity}/${x.kind}] ${x.title} — ${x.detail}`) : []));
    if (res.some((r) => r.ok)) {
      setPhase('verdict');
      try {
        const v = await chatJson({ ...net.call, maxTokens: 400, temperature: 0.1, messages: [{ role: 'system', content: VERDICT }, { role: 'user', content: `PR: ${files.length} files, +${files.reduce((a, f) => a + f.add, 0)} -${files.reduce((a, f) => a + f.del, 0)}.\nFindings:\n${all.join('\n') || '(none)'}` }] });
        setVerdict({ ...v, risk: Math.max(1, Math.min(5, Math.round(Number(v.risk) || 1))) });
      } catch (e) { setError(e.message); }
    }
    setPhase('');
  };

  const counts = useMemo(() => {
    const c = { blocker: 0, major: 0, minor: 0, nit: 0 };
    Object.values(rev).forEach((r) => (r.findings || []).forEach((x) => { c[x.severity] += 1; }));
    return c;
  }, [rev]);
  const reviewed = files.filter((f) => rev[f.path] && rev[f.path].findings).length;
  // The whole review as Markdown, ready to paste as a PR comment.
  const asMarkdown = () => {
    const lines = [`## Lintel review — ${pr.title}`, ''];
    if (verdict) lines.push(`**${verdict.verdict === 'request_changes' ? 'Changes requested' : verdict.verdict === 'approve' ? 'Approved' : 'Comment'}** · risk ${verdict.risk}/5 — ${verdict.headline}`, '', verdict.summary || '', '');
    files.forEach((f) => {
      const r = rev[f.path];
      if (!r || !r.findings) return;
      lines.push(`### \`${f.path}\``, r.summary ? `_${r.summary}_` : '', '');
      r.findings.forEach((x) => { lines.push(`- **${x.severity}** · line ${x.line} · ${x.title} — ${x.detail}`); if (x.suggestion) lines.push(`  \`\`\`suggestion\n  ${String(x.suggestion).split('\n').join('\n  ')}\n  \`\`\``); });
      if (!r.findings.length) lines.push('- No findings.');
      lines.push('');
    });
    return lines.join('\n');
  };
  const use = (next) => { setPr(next); setRev({}); setVerdict(null); setPaste(false); };

  return (
    <div className="ln">
      <header className="ln-top">
        <div className="ln-brand"><LintelLogo size={30} /><b>{'Lintel'}</b></div>
        <div className="ln-pr">
          <span className="ln-repo">{pr.repo}</span>
          <b>{pr.url ? <a href={pr.url} target="_blank" rel="noreferrer">{pr.title}</a> : pr.title}</b>
          <span className="ln-branch">{pr.branch}</span>
        </div>
        <div className="ln-top-r">
          {net.key && <select value={net.model} onChange={(e) => net.setModel(e.target.value)} aria-label="Model">{net.models.map((m) => <option key={m} value={m}>{`${m}${net.tagsOf(m).includes('coding') ? ' · coding' : ''}`}</option>)}</select>}
          {reviewed > 0 && <button type="button" className="ln-btn ghost" onClick={() => download('lintel-review.md', asMarkdown(), 'text/markdown')}>{'Export review'}</button>}
          {diff !== SAMPLE && <button type="button" className="ln-btn ghost" onClick={() => use(SAMPLE_PR)}>{'Sample PR'}</button>}
          <button type="button" className="ln-btn ghost" onClick={() => setPaste(true)}>{'Review your PR'}</button>
        </div>
      </header>

      {net.loaded && !net.key && <Connect net={net} />}

      <section className={`ln-verdict${verdict ? ` v-${verdict.verdict}` : ''}`}>
        {verdict ? (
          <>
            <div className="ln-v-h">
              <span className="ln-v-badge">{verdict.verdict === 'request_changes' ? 'Changes requested' : verdict.verdict === 'approve' ? 'Approved' : 'Commented'}</span>
              <div className="ln-risk" aria-label={`Risk ${verdict.risk} of 5`}>{[1, 2, 3, 4, 5].map((k) => <i key={k} className={k <= verdict.risk ? `on r${verdict.risk}` : ''} />)}<span>{`risk ${verdict.risk}/5`}</span></div>
            </div>
            <h1>{verdict.headline}</h1>
            <p>{verdict.summary}</p>
            {Array.isArray(verdict.must_fix) && verdict.must_fix.length > 0 && <ul className="ln-must">{verdict.must_fix.map((m, i) => <li key={i}>{m}</li>)}</ul>}
          </>
        ) : (
          <div className="ln-start">
            <div>
              <h1>{phase === 'review' ? `Reviewing ${files.length} files at once…` : phase === 'verdict' ? 'Weighing the findings…' : `${files.length} files, +${files.reduce((a, f) => a + f.add, 0)} −${files.reduce((a, f) => a + f.del, 0)}`}</h1>
              <p>{phase ? `${reviewed}/${files.length} files back` : 'Each file gets its own reviewer on the network, in parallel; then a lead reviewer decides.'}</p>
            </div>
            <button type="button" className="ln-btn" disabled={!net.ready || Boolean(phase) || !files.length} onClick={run}>{phase ? 'Reviewing…' : 'Run review'}</button>
          </div>
        )}
        <div className="ln-counts">{SEV.map((s) => <span key={s} className={`s-${s}`}><b>{counts[s]}</b>{` ${s}`}</span>)}</div>
      </section>
      {error && <p className="ln-err">{error}</p>}
      {net.key && net.model && !net.tagsOf(net.model).includes('coding') && <p className="ln-note">{'Tip: a model tagged "coding" gives sharper reviews.'}</p>}

      <div className="ln-body">
        <nav className="ln-files" aria-label="Files">
          <label className="ln-only"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />{'Only lines with findings'}</label>
          <label className="ln-only" title="A second reviewer per file, in parallel, looking only for security issues"><input type="checkbox" checked={secPass} onChange={(e) => setSecPass(e.target.checked)} disabled={Boolean(phase)} />{'Security pass'}</label>
          {files.map((f) => {
            const r = rev[f.path];
            return (
              <button type="button" key={f.path} onClick={() => refs.current[f.path] && refs.current[f.path].scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                <span className="ln-fname">{f.path.split('/').pop()}<em>{f.path.split('/').slice(0, -1).join('/')}</em></span>
                <span className="ln-fstat">
                  {r && r.pending ? <i className="ln-spin" /> : r && r.findings ? (r.findings.length ? SEV.filter((s) => r.findings.some((x) => x.severity === s)).map((s) => <i key={s} className={`dot s-${s}`} />) : <i className="ok">{'✓'}</i>) : null}
                  <span className="add">{`+${f.add}`}</span><span className="del">{`−${f.del}`}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="ln-diffs">
          {files.map((f) => <FileDiff key={f.path} f={f} r={rev[f.path]} net={net} onlyIssues={onlyIssues} refFn={(el) => { refs.current[f.path] = el; }} />)}
        </div>
      </div>

      {paste && <PasteDiff onClose={() => setPaste(false)} onUse={use} />}
      <DevPanel net={net} app="Lintel" how={HOW} slug="review" />
    </div>
  );
}

function FileDiff({ f, r, net, onlyIssues, refFn }) {
  const [tests, setTests] = useState('');
  const [busy, setBusy] = useState(false);
  const byLine = useMemo(() => {
    const m = {};
    ((r && r.findings) || []).forEach((x) => { (m[x.line] = m[x.line] || []).push(x); });
    return m;
  }, [r]);
  const writeTests = async () => {
    setBusy(true); setTests('');
    try {
      await chat({ ...net.call, maxTokens: 700, temperature: 0.2, messages: [{ role: 'system', content: 'Write focused unit tests (vitest) for the changed code in this file: the edge cases a reviewer would worry about. Output one code block, then nothing else.' }, { role: 'user', content: `File: ${f.path}\n\n${numbered(f)}` }], onDelta: (_, all) => setTests(all) });
    } catch (e) { setTests(`// ${e.message}`); } finally { setBusy(false); }
  };
  const flagged = new Set(Object.keys(byLine).map(Number));
  return (
    <section className="ln-file" ref={refFn}>
      <header>
        <b>{f.path}</b>{f.isNew && <span className="ln-new">{'new'}</span>}
        <span className="ln-fsum">{r && r.summary}</span>
        <button type="button" className="ln-btn ghost sm" disabled={!net.ready || busy} onClick={writeTests}>{busy ? 'Writing tests…' : 'Generate tests'}</button>
      </header>
      {r && r.error && <p className="ln-err in">{`Review failed: ${r.error}`}</p>}
      <div className="ln-code" role="table">
        {f.lines.map((l, i) => {
          if (onlyIssues && !(l.n != null && flagged.has(l.n))) return null;
          return (
            <React.Fragment key={i}>
              <div className={`ln-line ${l.t}${l.n != null && flagged.has(l.n) ? ' flag' : ''}`} role="row">
                <span className="ln-no">{l.t === 'hunk' ? '' : l.t === 'del' ? l.o : l.n}</span>
                <span className="ln-sign">{l.t === 'add' ? '+' : l.t === 'del' ? '−' : ''}</span>
                <code>{l.text || ' '}</code>
              </div>
              {l.n != null && l.t !== 'del' && byLine[l.n] && byLine[l.n].map((x) => <Finding key={x.id} x={x} f={f} net={net} />)}
            </React.Fragment>
          );
        })}
      </div>
      {(tests || busy) && <pre className="ln-out"><span>{`tests for ${f.path.split('/').pop()}`}</span>{strip(tests)}{busy && <i className="ln-caret" />}</pre>}
    </section>
  );
}

function Finding({ x, f, net }) {
  const [fix, setFix] = useState('');
  const [busy, setBusy] = useState(false);
  const write = async () => {
    setBusy(true); setFix('');
    try {
      await chat({ ...net.call, maxTokens: 500, temperature: 0.1, messages: [{ role: 'system', content: 'Fix exactly this review finding. Output the corrected code for the affected lines in one code block, then one sentence on why it is safe now.' }, { role: 'user', content: `File: ${f.path}\nFinding at line ${x.line}: ${x.title} — ${x.detail}\n\n${numbered(f)}` }], onDelta: (_, all) => setFix(all) });
    } catch (e) { setFix(`// ${e.message}`); } finally { setBusy(false); }
  };
  return (
    <div className={`ln-find s-${x.severity}`}>
      <div className="ln-find-h"><span className={`ln-sev s-${x.severity}`}>{x.severity}</span><span className={`ln-kind${x.kind === 'security' ? ' sec' : ''}`}>{x.kind === 'security' ? '🔒 security' : x.kind}</span><b>{x.title}</b></div>
      <p>{x.detail}</p>
      {x.suggestion && <pre className="ln-sugg">{x.suggestion}</pre>}
      <button type="button" className="ln-btn ghost sm" disabled={!net.ready || busy} onClick={write}>{busy ? 'Writing the fix…' : fix ? 'Rewrite the fix' : 'Write the fix'}</button>
      {(fix || busy) && <pre className="ln-out">{strip(fix)}{busy && <i className="ln-caret" />}</pre>}
    </div>
  );
}

function PasteDiff({ onClose, onUse }) {
  const [t, setT] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const n = parseDiff(t).length;
  const load = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { onUse(await fetchPr(url.trim())); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="ln-modal" onClick={onClose}>
      <div className="ln-modal-b" onClick={(e) => e.stopPropagation()}>
      <form className="ln-prurl" onSubmit={load}>
        <b>{'A public GitHub pull request'}</b>
        <div className="ln-row"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repo/pull/123" aria-label="Pull request URL" /><button type="submit" className="ln-btn" disabled={!url.trim() || busy}>{busy ? 'Loading…' : 'Load'}</button></div>
        {err && <p className="ln-err in">{err}</p>}
      </form>
      <div className="ln-or"><span>{'or'}</span></div>
      <form onSubmit={(e) => { e.preventDefault(); if (n) onUse({ diff: t, title: 'Your diff', repo: 'pasted', branch: `${n} file${n === 1 ? '' : 's'}` }); }}>
        <b>{'Paste a diff'}</b>
        <p>{'The output of '}<code>{'git diff main...your-branch'}</code>{'. It is sent only to the Resonance API with your key, and kept in this browser.'}</p>
        <textarea value={t} onChange={(e) => setT(e.target.value)} placeholder="diff --git a/… b/…" rows={14} spellCheck={false} />
        <div className="ln-row"><span>{t ? `${n} file(s) found` : ''}</span><button type="button" className="ln-btn ghost" onClick={onClose}>{'Cancel'}</button><button type="submit" className="ln-btn" disabled={!n}>{'Use this diff'}</button></div>
      </form>
      </div>
    </div>
  );
}

function Connect({ net }) {
  const [k, setK] = useState('');
  return (
    <form className="ln-connect" onSubmit={(e) => { e.preventDefault(); net.setKey(k); }}>
      <div><b>{'Connect a reviewer'}</b><span>{'Lintel reviews on coding models on the Resonance network. Paste a node or logical node key — it stays in this browser.'}</span></div>
      <div className="ln-row"><input type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder="rk_…" aria-label="Resonance API key" autoComplete="off" /><button type="submit" className="ln-btn" disabled={!k.trim()}>{'Connect'}</button></div>
    </form>
  );
}

const strip = (s) => s.replace(/```[a-z]*\n?/gi, '');
