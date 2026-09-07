import type { ReactNode } from 'react';

/**
 * The illustration beside the code sample: the one branch the sample actually takes.
 *
 * Drawn rather than borrowed from artboard 7 — that artboard is the full eleven-outcome
 * diagram, and putting it on the landing page was what made the page too dense. This
 * keeps only the shape of the decision.
 *
 * Every line is broken by hand. SVG text does not wrap, so a label longer than its box
 * silently runs outside it, and the first version of this did exactly that. The boxes are
 * 190px wide with a 14px inset, which leaves 162px — about 23 characters of IBM Plex Mono
 * at 11.5px, or 28 of the sans. Nothing here exceeds that.
 *
 * Stroke weights and colours are the design system's: 1.5px line work, mono for status
 * names, green only for "the app runs", the neutral ramp for everything structural.
 */
const MONO = "'IBM Plex Mono', monospace";

export function OneBranch(): ReactNode {
  return (
    <svg
      viewBox="0 0 420 322"
      width="420"
      height="322"
      fill="none"
      role="img"
      aria-label="One enroll call resolves to exactly one of eleven outcomes. Three let the app run: succeeded, notTargeted and notLicensed. The rest you handle, and only failed blocks access to corporate data."
      style={{ maxWidth: '100%', height: 'auto' }}
    >
      {/* the call */}
      <rect x="126" y="4" width="168" height="34" rx="5" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.5" />
      <text x="210" y="26" textAnchor="middle" fontFamily={MONO} fontSize="13" style={{ fill: 'var(--rni-ink)' }}>
        signInAndEnroll()
      </text>

      {/* it resolves to exactly one outcome, then forks */}
      <path d="M210 38 V62" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.5" />
      <path d="M95 62 H325" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.5" />
      <path d="M95 62 V82" style={{ stroke: 'var(--rni-green)' }} strokeWidth="1.5" />
      <path d="M325 62 V82" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.5" />
      <path d="M89 76 L95 84 L101 76" style={{ stroke: 'var(--rni-green)' }} strokeWidth="1.5" />
      <path d="M319 76 L325 84 L331 76" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.5" />

      {/* the app runs — and this is the half people get wrong */}
      <rect x="0" y="86" width="190" height="164" rx="5" style={{ fill: 'var(--rni-green-tint)', stroke: 'var(--rni-green)' }} strokeWidth="1.5" />
      <text x="14" y="108" fontFamily={MONO} fontSize="10" letterSpacing="1.1" style={{ fill: 'var(--rni-green)' }}>
        THE APP RUNS
      </text>
      <text x="14" y="136" fontFamily={MONO} fontSize="11.5" style={{ fill: 'var(--rni-ink)' }}>succeeded</text>
      <text x="14" y="158" fontFamily={MONO} fontSize="11.5" style={{ fill: 'var(--rni-ink)' }}>notTargeted</text>
      <text x="14" y="180" fontFamily={MONO} fontSize="11.5" style={{ fill: 'var(--rni-ink)' }}>notLicensed</text>
      <text x="14" y="208" fontSize="11.5" style={{ fill: 'var(--rni-green)' }}>Let the user in.</text>
      <text x="14" y="226" fontSize="11.5" style={{ fill: 'var(--rni-n-600)' }}>Two of these run</text>
      <text x="14" y="242" fontSize="11.5" style={{ fill: 'var(--rni-n-600)' }}>unmanaged.</text>

      {/* everything else */}
      <rect x="230" y="86" width="190" height="164" rx="5" style={{ stroke: 'var(--rni-n-200)' }} strokeWidth="1.5" />
      <text x="244" y="108" fontFamily={MONO} fontSize="10" letterSpacing="1.1" style={{ fill: 'var(--rni-n-600)' }}>
        YOU HANDLE IT
      </text>
      <text x="244" y="136" fontFamily={MONO} fontSize="11.5" style={{ fill: 'var(--rni-red)' }}>failed</text>
      <text x="244" y="158" fontFamily={MONO} fontSize="11.5" style={{ fill: 'var(--rni-n-600)' }}>pending</text>
      <text x="244" y="180" fontFamily={MONO} fontSize="11.5" style={{ fill: 'var(--rni-n-600)' }}>+ six more</text>
      <text x="244" y="208" fontSize="11.5" style={{ fill: 'var(--rni-n-600)' }}>
        Only <tspan fontFamily={MONO} fontSize="11">failed</tspan> blocks
      </text>
      <text x="244" y="226" fontSize="11.5" style={{ fill: 'var(--rni-n-600)' }}>corporate data.</text>

      {/* the count, stated rather than implied */}
      <text x="210" y="282" textAnchor="middle" fontFamily={MONO} fontSize="10" letterSpacing="0.8" style={{ fill: 'var(--rni-n-400)' }}>
        ELEVEN OUTCOMES · ONE RESOLVES
      </text>
      <text x="210" y="304" textAnchor="middle" fontSize="11.5" style={{ fill: 'var(--rni-n-600)' }}>
        A failure is data, not an exception.
      </text>
    </svg>
  );
}
