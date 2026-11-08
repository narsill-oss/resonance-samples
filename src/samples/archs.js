// How each sample app sits on the Resonance network, drawn by the developer panel's
// Architecture tab. Same pattern for all eight — one cluster per app, one logical node per
// end user with a 24-hour scoped key minted by the app's backend — with what differs per app:
// who the users are, the calls each makes, and the choices worth copying.

export const REPO = 'https://github.com/narsill-oss/resonance-samples';

export const ARCHS = {
  crm: {
    app: 'Kestrel', cluster: 'kestrel', backend: 'Kestrel API',
    user: 'sales rep', seats: ['Marta Rossi · account exec', 'Aisha Khan · account exec', 'Jonas Lind · sales lead'],
    calls: [
      ['Rescore pipeline', 'fan-out · 1 JSON call per deal · 4 at a time'],
      ['Deal coach · call notes', '1 JSON call per action'],
      ['Follow-up · forecast · stale sweep', 'streamed prose / fan-out drafts'],
    ],
    why: 'Each rep is a logical node, so the forecast a manager runs and the follow-ups a rep drafts are metered and capped per person. The CRM server never hands out its own key: it mints a 24-hour key for the rep who is signed in.',
    budget: 'Cap each rep, e.g. 3 000 requests a month: read their logical node\'s usage before minting the next key, and stop the node when they leave the team.',
    example: { system: 'Score this deal. Reply ONLY with JSON: {"win_probability": 0-100, "risks": [string], "next_action": string}.', user: 'Brightmills · €48 000 · Negotiation · last touch 9 days ago' },
  },
  support: {
    app: 'Relay', cluster: 'relay', backend: 'Relay helpdesk server',
    user: 'support agent', seats: ['Marta · tier 1', 'Jonas · tier 2', 'Autopilot (server)'],
    calls: [
      ['Triage', 'fan-out · 1 JSON call per ticket · 5 at a time'],
      ['Incidents', 'reduce · 1 call over every triage'],
      ['Replies · translation · incident replies', 'streamed, in the customer\'s language'],
    ],
    why: 'Agents get their own logical nodes; the autopilot that triages new tickets on a schedule is a logical node too, so you can see — and cap — what the automation costs apart from the people.',
    budget: 'Give the autopilot its own budget and stop its logical node to pause automation without touching the agents.',
    example: { system: 'You triage support tickets. Reply ONLY with JSON: {"category", "priority", "language", "summary"}.', user: 'R-2043 · Cannot log in — SSO broken · None of our 40 users can sign in…' },
  },
  knowledge: {
    app: 'Folio', cluster: 'folio', backend: 'Folio wiki server',
    user: 'employee', seats: ['Priya · people ops', 'Leo · engineer', 'New hire'],
    calls: [
      ['Read', 'fan-out · 1 JSON call per page · 6 at a time'],
      ['Answer', '1 streamed call over the matching quotes'],
      ['Audit · fill the gap', 'fan-out per page / 1 drafted page'],
    ],
    why: 'Every employee asking questions is a logical node: heavy readers don\'t eat someone else\'s budget, and you can tell which teams rely on the handbook. The handbook itself never leaves your server except as the pages each question reads.',
    budget: 'For confidential handbooks, send the calls with "tier": "paid": they then run only on verified paid nodes, never on the open network.',
    example: { system: 'Does this page answer the question? Reply ONLY with JSON: {"relevance": 0-3, "quote": string}.', user: 'Question: how many days can I work abroad?\n\nPage: Remote work policy…' },
  },
  expenses: {
    app: 'Tally', cluster: 'tally', backend: 'Tally finance server',
    user: 'employee filing expenses', seats: ['Sam · field sales', 'Ines · engineer', 'Finance reviewer'],
    calls: [
      ['Scan receipts', 'fan-out · 1 vision call per photo · 5 at a time'],
      ['Policy · anomalies', 'plain code, then 1 JSON call over the report'],
      ['Report note', '1 streamed call'],
    ],
    why: 'Receipt photos are personal data: each employee\'s scans are metered to their own logical node, and the finance reviewer\'s anomaly pass to theirs. Vision calls are the heavy ones — downscale before sending and keep concurrency low.',
    budget: 'Run vision on a vision-tagged model, and send receipts with "tier": "paid" so they are read only by verified paid nodes.',
    example: { system: 'Read this receipt. Reply ONLY with JSON: {"merchant", "date", "currency", "total", "items"}.', user: '[image_url: receipt.jpg]' },
  },
  review: {
    app: 'Lintel', cluster: 'lintel', backend: 'CI runner',
    user: 'repository', seats: ['web-app repo', 'api repo', 'CI runner (nightly)'],
    calls: [
      ['Review · security pass', 'fan-out · 1 call per file, on a coding model'],
      ['Verdict', 'reduce · 1 call over every finding'],
      ['Fix · tests', 'streamed on demand'],
    ],
    why: 'Here the "users" are repositories: each one is a logical node, so review traffic per repo is visible and a noisy monorepo can be capped. CI holds the cluster owner token as a secret and mints a key per pipeline run.',
    budget: 'Mint keys that live one CI job: the key is useless once the job ends, even if a log leaks it.',
    example: { system: 'Review this file\'s diff. Reply ONLY with JSON: {"findings": [{"line", "severity", "message"}]}.', user: 'src/auth/session.ts\n@@ -12,7 +12,9 @@ …' },
  },
  localize: {
    app: 'Parlance', cluster: 'parlance', backend: 'Parlance build service',
    user: 'project', seats: ['Mobile app', 'Marketing site', 'Docs'],
    calls: [
      ['Translate', 'fan-out · 1 JSON call per language · 8 at once'],
      ['Review', 'fan-out · back-translation per language'],
      ['Glossary · fix a cell', '1 JSON call each'],
    ],
    why: 'Each product being localized is a logical node, so the docs team\'s 40 languages don\'t share a budget with the app\'s 8. The checks that must be exact — placeholders, lengths, glossary — are code, not model calls.',
    budget: 'When many languages fan out at once and the network is busy, requests wait for a free node instead of failing; the client still retries a few times with jitter.',
    example: { system: 'Translate these UI strings to German. Reply ONLY with JSON {key: translation}. Keep {placeholders}.', user: '[{"key": "cart.title", "source": "Your cart ({count})", "max": 24}]' },
  },
  data: {
    app: 'Quarry', cluster: 'quarry', backend: 'Quarry analytics server',
    user: 'analyst', seats: ['Nora · finance', 'Kai · growth', 'Scheduled report'],
    calls: [
      ['Plan', '1 JSON call · sees only the schema, never the rows'],
      ['Narrate · explore', '6 chains side by side, then 1 streamed briefing'],
      ['Data quality', 'code profiles the columns, 1 call explains'],
    ],
    why: 'Rows never leave the analyst\'s machine: only the schema, five sample rows and computed results do. Each analyst — and each scheduled report — is a logical node, so the weekly report\'s cost is separate from ad-hoc questions.',
    budget: 'Scheduled reports run from a server: give them their own logical node and a key minted per run.',
    example: { system: 'Plan a query for this question. Reply ONLY with JSON {"filters", "group_by", "metric"}.', user: 'Schema: date (date), region (text), revenue (number)…\nQuestion: which region grew fastest last quarter?' },
  },
  hiring: {
    app: 'Shortlist', cluster: 'shortlist', backend: 'Shortlist ATS server',
    user: 'hiring manager', seats: ['Alex · eng manager', 'Rosa · recruiter', 'Hiring panel'],
    calls: [
      ['Rubric from a job ad', '1 JSON call'],
      ['Screen', 'fan-out · 1 JSON call per CV · 5 at a time'],
      ['Compare · interview kit', '1 call / 1 streamed call'],
    ],
    why: 'CVs are personal data: blinding happens in code before anything is sent, and each hiring manager is a logical node, so who screened how many applicants is on record. Send CVs with "tier": "paid" to keep them off the open network.',
    budget: 'Keep the per-manager keys short-lived and revoke them when a role closes; store only scores and quotes, never the model\'s raw replies.',
    example: { system: 'Score this CV against the rubric. Reply ONLY with JSON {"criteria": [{"name", "score", "quote"}]}.', user: 'Rubric: …\n\nCV (blinded): …' },
  },
};
