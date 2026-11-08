import React from 'react';
import { Link } from './Link';
import { SAMPLES } from './samples/catalog';
import { LOGOS } from './samples/logos';
import './samples/gallery.css';

// The list of apps. Open one, connect it (an API key, or the session server in server/),
// then click "Runs on Resonance" for the developer view: how it works, its architecture on the
// network, every request on a timeline, and the code of each.
export default function Home() {
  React.useEffect(() => { document.title = 'Resonance sample apps'; }, []);
  return (
    <div style={{ background: '#0B0B0B', color: '#FFFFFF', fontFamily: "'Public Sans', 'Helvetica Neue', sans-serif", minHeight: '100vh' }}>
      <main className="smpg">
        <h1 className="smpg-h">{'Sample'}<span>{'apps'}</span></h1>
        <p className="smpg-lead">
          {'Eight products, each with its own design, all running on the Resonance network through its HTTP API. Open one, connect it, use it with the sample data or your own, then click '}
          <b>{'Runs on Resonance'}</b>{' to see how it sits on the network and every request it makes.'}
        </p>
        <div className="smpg-grid">
          {SAMPLES.map((s) => (
            <Link key={s.slug} to={`/samples/${s.slug}`} className={`smpg-card b-${s.brand}`}>
              <span className="smpg-brand">{React.createElement(LOGOS[s.brand], { size: 40 })}<span className="smpg-name"><b>{s.title}</b><em>{s.kind}</em></span></span>
              <span className="smpg-p">{s.line}</span>
              <span className="smpg-open">{'Open →'}</span>
            </Link>
          ))}
        </div>
        <div className="smpg-foot">
          <p>{'Connect with your node\'s key ('}<code>{'resonance api-key'}</code>{'), or run '}<code>{'npm run server'}</code>{' so every user gets their own logical node key — see the README.'}</p>
        </div>
      </main>
    </div>
  );
}
