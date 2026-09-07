/**
 * The layers, and which of them this library owns.
 *
 * Ported verbatim from the design canvas artboard "9 · Diagram — architecture" — the
 * declared widths, spacing, type sizes and colours are the design's, not a
 * reinterpretation of it. Generated rather than hand-written for that reason.
 *
 * The frame is a fixed 1200px, exactly as the artboard specifies. `DiagramFrame`
 * provides the horizontal scroll that keeps it from being squeezed on a narrow screen:
 * a diagram compressed until its labels wrap has stopped explaining anything.
 */
import type { ReactNode } from 'react';

import { DiagramFrame } from './DiagramFrame';

export function Architecture(): ReactNode {
  return (
    <DiagramFrame caption={"Accent marks every layer this library ships. Grey marks what belongs to Microsoft or to the phone."}>
      <div style={{ width: '1200px', background: 'var(--rni-paper)', border: '1px solid #DBE0E9', padding: '48px', display: 'grid', gridTemplateColumns: '1fr 300px', gap: '40px', alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              <div style={{ border: '1.5px solid #4B5AE4', background: 'var(--rni-accent-tint)', padding: '18px 22px' }}>
                <div style={{ fontSize: '15px', fontWeight: '600' }}>JavaScript / TypeScript API</div>
                <div style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '12px', color: 'var(--rni-accent-strong)', marginTop: '4px' }}>enroll() · policy() · doctor()</div>
              </div>
              <div style={{ height: '22px', display: 'flex', justifyContent: 'center' }}><div style={{ width: '1.5px', background: 'var(--rni-n-400)' }}></div></div>
              <div style={{ border: '1.5px solid #4B5AE4', background: 'var(--rni-accent-tint)', padding: '18px 22px' }}>
                <div style={{ fontSize: '15px', fontWeight: '600' }}>TurboModule bridge</div>
                <div style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '12px', color: 'var(--rni-accent-strong)', marginTop: '4px' }}>typed via Codegen · New Architecture</div>
              </div>
              <div style={{ height: '22px', display: 'flex', justifyContent: 'center' }}><div style={{ width: '1.5px', background: 'var(--rni-n-400)' }}></div></div>
              <div style={{ border: '1.5px solid #4B5AE4', background: 'var(--rni-accent-tint)', padding: '18px 22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: '600' }}>Native layer — iOS</div>
                  <div style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '12px', color: 'var(--rni-accent-strong)', marginTop: '4px' }}>Objective-C</div>
                </div>
                <div style={{ borderLeft: '1px solid #C9CFF8', paddingLeft: '16px' }}>
                  <div style={{ fontSize: '15px', fontWeight: '600' }}>Native layer — Android</div>
                  <div style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '12px', color: 'var(--rni-accent-strong)', marginTop: '4px' }}>Kotlin</div>
                </div>
              </div>
              <div style={{ height: '22px', display: 'flex', justifyContent: 'center' }}><div style={{ width: '1.5px', background: 'var(--rni-n-400)' }}></div></div>
              <div style={{ border: '1.5px solid #98A1B3', padding: '18px 22px' }}>
                <div style={{ fontSize: '15px', fontWeight: '600' }}>Microsoft Intune App SDK</div>
                <div style={{ fontSize: '12.5px', color: 'var(--rni-n-600)', marginTop: '4px' }}>Vendor SDK — enforces the policy inside the process</div>
              </div>
              <div style={{ height: '22px', display: 'flex', justifyContent: 'center' }}><div style={{ width: '1.5px', background: 'var(--rni-n-400)' }}></div></div>
              <div style={{ border: '1.5px solid #98A1B3', borderRadius: '44px', padding: '18px 22px' }}>
                <div style={{ fontSize: '15px', fontWeight: '600' }}>Intune service</div>
                <div style={{ fontSize: '12.5px', color: 'var(--rni-n-600)', marginTop: '4px' }}>Policy source of truth</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingTop: '104px' }}>
              <div style={{ border: '1.5px solid #4B5AE4', background: 'var(--rni-accent-tint)', padding: '16px 18px' }}>
                <div style={{ fontSize: '15px', fontWeight: '600' }}>MSAL</div>
                <div style={{ fontSize: '12.5px', color: 'var(--rni-accent-strong)', lineHeight: '1.5', marginTop: '4px' }}>Owned by the library. Optional — an app with its own MSAL keeps it.</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <svg width="70" height="16" viewBox="0 0 70 16" fill="none"><path d="M2 8 H54" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.4"/><path d="M48 3 L56 8 L48 13" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.4"/></svg>
                <span style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '11.5px', color: 'var(--rni-n-600)' }}>token request</span>
              </div>
              <div style={{ border: '1.5px solid #98A1B3', padding: '16px 18px' }}>
                <div style={{ fontSize: '15px', fontWeight: '600' }}>Broker app</div>
                <div style={{ fontSize: '12.5px', color: 'var(--rni-n-600)', lineHeight: '1.5', marginTop: '4px' }}>Authenticator or Company Portal, installed separately on the phone.</div>
              </div>
              <div style={{ fontSize: '12.5px', color: 'var(--rni-n-600)', lineHeight: '1.55', marginTop: '8px', borderTop: '1px solid #ECEFF4', paddingTop: '14px' }}>Accent marks every layer this library ships. Grey marks what belongs to Microsoft or the phone.</div>
            </div>
          </div>
    </DiagramFrame>
  );
}
