import React from 'react';

// The sample products' marks. Each is a self-contained SVG in its brand colours, used in the
// app's own header and on the gallery cards.
const svg = (size, label, children) => (
  <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={label} style={{ display: 'block', flex: 'none' }}>{children}</svg>
);

/// Kestrel — a falcon's swept wing over a rising line.
export function KestrelLogo({ size = 28 }) {
  return svg(size, 'Kestrel', <>
    <rect width="32" height="32" rx="9" fill="#1E5B47" />
    <path d="M6 21.5c4.6-1.2 8-4 10.3-8.6C18 9.6 21 7.6 26 7.4c-2.3 1.6-3.6 3.4-4.2 5.6 1.6-.2 2.9.1 4 .9-2.4.4-4.3 1.6-5.7 3.6-2.6 3.7-7.6 5.3-14.1 4z" fill="#F6F4EE" />
    <circle cx="22.6" cy="10" r="1" fill="#1E5B47" />
    <path d="M6 25.5h20" stroke="#8FD1B5" strokeWidth="1.6" strokeLinecap="round" />
  </>);
}

/// Relay — a pulse handed from one side to the other.
export function RelayLogo({ size = 28 }) {
  return svg(size, 'Relay', <>
    <rect width="32" height="32" rx="9" fill="#C8F25A" />
    <path d="M5 17h6l2.6-6.5L18 23l2.8-6H27" fill="none" stroke="#0D0E11" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
  </>);
}

/// Folio — an open book with a ribbon marker.
export function FolioLogo({ size = 28 }) {
  return svg(size, 'Folio', <>
    <rect width="32" height="32" rx="7" fill="#8A2D1C" />
    <path d="M6 10.2c3.6-.9 7-.5 10 1.6v12.6c-3-2-6.4-2.5-10-1.6z" fill="#FBF8F1" />
    <path d="M26 10.2c-3.6-.9-7-.5-10 1.6v12.6c3-2 6.4-2.5 10-1.6z" fill="#EADFC7" />
    <path d="M20.5 10.6v7.2l1.6-1.2 1.6 1.2v-7.6" fill="#B98B2C" />
  </>);
}

/// Tally — four strokes and the fifth that closes the count.
export function TallyLogo({ size = 28 }) {
  return svg(size, 'Tally', <>
    <rect width="32" height="32" rx="16" fill="#221A6B" />
    {[10, 14, 18, 22].map((x) => <path key={x} d={`M${x} 9v14`} stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />)}
    <path d="M7.5 20.5L24.5 11" stroke="#FF6B5B" strokeWidth="2.6" strokeLinecap="round" />
  </>);
}

/// Lintel — the beam laid across two posts.
export function LintelLogo({ size = 28 }) {
  return svg(size, 'Lintel', <>
    <rect width="32" height="32" rx="6" fill="#1D4ED8" />
    <path d="M0 8h32M0 16h32M0 24h32M8 0v32M16 0v32M24 0v32" stroke="#3B68E6" strokeWidth="0.6" />
    <rect x="6" y="8.5" width="20" height="4.5" rx="1" fill="#FFFFFF" />
    <rect x="9" y="13" width="3.6" height="11" fill="#FFFFFF" />
    <rect x="19.4" y="13" width="3.6" height="11" fill="#FFFFFF" />
  </>);
}

/// Parlance — two voices, overlapping.
export function ParlanceLogo({ size = 28 }) {
  return svg(size, 'Parlance', <>
    <rect width="32" height="32" rx="10" fill="#F4F1FF" />
    <path d="M5 8.5a3.5 3.5 0 013.5-3.5h9A3.5 3.5 0 0121 8.5v5a3.5 3.5 0 01-3.5 3.5H11l-4 3.5V17A3.5 3.5 0 015 13.5z" fill="#5B2EFF" />
    <path d="M27 15.5a3.5 3.5 0 00-3.5-3.5h-8a3.5 3.5 0 00-3.5 3.5v5a3.5 3.5 0 003.5 3.5H21l4 3.5V24a3.5 3.5 0 002-3.2z" fill="#FF8A3D" />
    <path d="M9 10.5h8M9 13h5" stroke="#F4F1FF" strokeWidth="1.5" strokeLinecap="round" />
  </>);
}

/// Quarry — a cut stone face with a seam of data running through it.
export function QuarryLogo({ size = 28 }) {
  return svg(size, 'Quarry', <>
    <rect width="32" height="32" rx="8" fill="#0F1B2A" />
    <path d="M6 24l5-12 5 5 4-9 6 16z" fill="#14324A" stroke="#0E7490" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M6 20.5l5.4-4.5 4.4 3 4.4-6.5 5.8 3.5" fill="none" stroke="#5FD4EC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="20.2" cy="12.5" r="2" fill="#DB2777" />
  </>);
}

/// Shortlist — a list with one line highlighted and ticked.
export function ShortlistLogo({ size = 28 }) {
  return svg(size, 'Shortlist', <>
    <rect width="32" height="32" fill="#111111" />
    <rect x="6" y="14" width="20" height="5.5" fill="#FFE14D" />
    <path d="M7 9h13M7 24.5h10" stroke="#FAFAF7" strokeWidth="2.2" />
    <path d="M8.2 16.8l1.8 1.6 3.2-3.4" fill="none" stroke="#111111" strokeWidth="1.8" strokeLinecap="square" />
    <path d="M15 16.8h9" stroke="#111111" strokeWidth="1.8" />
  </>);
}

export const LOGOS = { kestrel: KestrelLogo, relay: RelayLogo, folio: FolioLogo, tally: TallyLogo, lintel: LintelLogo, parlance: ParlanceLogo, quarry: QuarryLogo, shortlist: ShortlistLogo };
