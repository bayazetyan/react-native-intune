/**
 * Remote wipe: company data leaves, personal data stays.
 *
 * Ported verbatim from the design canvas artboard "8 · Diagram — remote wipe" — the
 * declared widths, spacing, type sizes and colours are the design's, not a
 * reinterpretation of it. Generated rather than hand-written for that reason.
 *
 * The frame is a fixed 1200px, exactly as the artboard specifies. `DiagramFrame`
 * provides the horizontal scroll that keeps it from being squeezed on a narrow screen:
 * a diagram compressed until its labels wrap has stopped explaining anything.
 */
import type { ReactNode } from 'react';

import { DiagramFrame } from './DiagramFrame';

export function RemoteWipe(): ReactNode {
  return (
    <DiagramFrame caption={"The wipe is scoped to the managed app\u2019s company data. Nothing outside the boundary is reachable by the administrator."}>
      <div style={{ width: '1200px', background: 'var(--rni-paper)', border: '1px solid #DBE0E9', padding: '48px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '28px' }}>
              <div style={{ border: '1.5px solid #AF443B', color: 'var(--rni-red)', fontSize: '13px', padding: '9px 14px', borderRadius: '4px', fontWeight: '500' }}>Administrator issues a selective wipe</div>
              <svg width="80" height="16" viewBox="0 0 80 16" fill="none"><path d="M2 8 H64" style={{ stroke: 'var(--rni-red)' }} strokeWidth="1.5"/><path d="M58 3 L66 8 L58 13" style={{ stroke: 'var(--rni-red)' }} strokeWidth="1.5"/></svg>
              <div style={{ fontSize: '13px', color: 'var(--rni-n-600)' }}>next launch, the SDK removes company data from the managed app</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 1fr', gap: '24px', alignItems: 'center' }}>
              <div>
                <div style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '11px', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--rni-n-600)', marginBottom: '14px' }}>Before</div>
                <div style={{ border: '2px solid #98A1B3', borderRadius: '32px', padding: '16px', maxWidth: '330px' }}>
                  <div style={{ width: '52px', height: '4px', background: 'var(--rni-n-200)', borderRadius: '2px', margin: '2px auto 14px' }}></div>
                  <div style={{ border: '2px dashed #4B5AE4', background: 'var(--rni-accent-tint)', borderRadius: '12px', padding: '14px' }}>
                    <div style={{ fontSize: '13.5px', fontWeight: '600' }}>Your app</div>
                    <div style={{ fontSize: '12px', color: 'var(--rni-accent-strong)', marginTop: '6px' }}>Work account signed in · 42 documents cached · policy in force</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginTop: '16px' }}>
                    <div style={{ height: '40px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                    <div style={{ height: '40px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                    <div style={{ height: '40px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                    <div style={{ height: '40px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--rni-n-600)', textAlign: 'center', marginTop: '10px' }}>photos · messages · personal apps</div>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <svg width="100" height="18" viewBox="0 0 100 18" fill="none"><path d="M2 9 H84" style={{ stroke: 'var(--rni-red)' }} strokeWidth="1.6"/><path d="M78 3 L86 9 L78 15" style={{ stroke: 'var(--rni-red)' }} strokeWidth="1.6"/></svg>
                <div style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '11px', color: 'var(--rni-red)', textAlign: 'center' }}>selective wipe</div>
              </div>
              <div>
                <div style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '11px', letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--rni-n-600)', marginBottom: '14px' }}>After</div>
                <div style={{ border: '2px solid #98A1B3', borderRadius: '32px', padding: '16px', maxWidth: '330px' }}>
                  <div style={{ width: '52px', height: '4px', background: 'var(--rni-n-200)', borderRadius: '2px', margin: '2px auto 14px' }}></div>
                  <div style={{ border: '1.5px dashed #EBC4BF', background: 'var(--rni-red-tint)', borderRadius: '12px', padding: '14px' }}>
                    <div style={{ fontSize: '13.5px', fontWeight: '600', color: 'var(--rni-red)' }}>Your app — company data removed</div>
                    <div style={{ fontSize: '12px', color: 'var(--rni-red)', marginTop: '6px' }}>Signed out · cache cleared · app still installed, runs unmanaged</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginTop: '16px' }}>
                    <div style={{ height: '40px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                    <div style={{ height: '40px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                    <div style={{ height: '40px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                    <div style={{ height: '40px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--rni-green)', textAlign: 'center', marginTop: '10px', fontWeight: '500' }}>photos · messages · personal apps — untouched</div>
                </div>
              </div>
            </div>
            <div style={{ fontSize: '13.5px', color: 'var(--rni-n-600)', lineHeight: '1.6', marginTop: '32px', paddingTop: '24px', borderTop: '1px solid #ECEFF4', maxWidth: '70ch' }}>The wipe is scoped to the managed app’s company data. Nothing outside the dashed boundary is reachable by the administrator — no photos, no personal accounts, no factory reset.</div>
          </div>
    </DiagramFrame>
  );
}
