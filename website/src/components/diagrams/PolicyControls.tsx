/**
 * What a policy controls, and how the same action can be allowed or refused.
 *
 * Ported verbatim from the design canvas artboard "6 · Diagram — what a policy controls" — the
 * declared widths, spacing, type sizes and colours are the design's, not a
 * reinterpretation of it. Generated rather than hand-written for that reason.
 *
 * The frame is a fixed 1200px, exactly as the artboard specifies. `DiagramFrame`
 * provides the horizontal scroll that keeps it from being squeezed on a narrow screen:
 * a diagram compressed until its labels wrap has stopped explaining anything.
 */
import type { ReactNode } from 'react';

import { DiagramFrame } from './DiagramFrame';

export function PolicyControls(): ReactNode {
  return (
    <DiagramFrame caption={"The restriction is directional, not total. Nothing here reaches outside the boundary."}>
      <div style={{ width: '1200px', background: 'var(--rni-paper)', border: '1px solid var(--rni-n-200)', padding: '48px', display: 'grid', gridTemplateColumns: '1fr 300px 1fr', gap: '32px', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
              <div style={{ borderLeft: '2px solid var(--rni-accent)', paddingLeft: '14px' }}>
                <div style={{ fontSize: '14px', fontWeight: '600' }}>PIN on launch</div>
                <div style={{ fontSize: '12.5px', color: 'var(--rni-n-600)', lineHeight: '1.5' }}>Conditional launch shows the PIN screen in front of the app before any company data is on screen.</div>
              </div>
              <div style={{ borderLeft: '2px solid var(--rni-accent)', paddingLeft: '14px' }}>
                <div style={{ fontSize: '14px', fontWeight: '600' }}>Copy out blocked</div>
                <div style={{ fontSize: '12.5px', color: 'var(--rni-n-600)', lineHeight: '1.5' }}>Text copied inside the app cannot be pasted into a personal app. Paste <em>in</em> still works.</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                  <svg width="90" height="16" viewBox="0 0 90 16" fill="none"><path d="M2 8 H62" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.4"/><path d="M70 2 L82 14 M82 2 L70 14" style={{ stroke: 'var(--rni-red)' }} strokeWidth="1.6"/></svg>
                  <span style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '11px', color: 'var(--rni-n-600)' }}>stopped at boundary</span>
                </div>
              </div>
              <div style={{ borderLeft: '2px solid var(--rni-accent)', paddingLeft: '14px' }}>
                <div style={{ fontSize: '14px', fontWeight: '600' }}>Screenshot blocked</div>
                <div style={{ fontSize: '12.5px', color: 'var(--rni-n-600)', lineHeight: '1.5' }}>Android blocks the capture; iOS marks the screen so the capture is dropped by the SDK.</div>
              </div>
            </div>

            <div style={{ border: '2px solid var(--rni-n-400)', borderRadius: '32px', padding: '14px', position: 'relative' }}>
              <div style={{ width: '52px', height: '4px', background: 'var(--rni-n-200)', borderRadius: '2px', margin: '2px auto 12px' }}></div>
              <div style={{ border: '2px dashed var(--rni-accent)', borderRadius: '14px', overflow: 'hidden' }}>
                <div style={{ background: 'var(--rni-accent)', color: 'var(--rni-paper)', padding: '10px 12px', fontSize: '12.5px', fontWeight: '500', display: 'flex', justifyContent: 'space-between' }}><span>Your app</span><span style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '10.5px' }}>managed</span></div>
                <div style={{ padding: '14px', background: 'var(--rni-paper)' }}>
                  <div style={{ background: 'var(--rni-n-50)', border: '1px solid var(--rni-n-100)', borderRadius: '8px', padding: '16px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '12.5px', fontWeight: '600' }}>Enter your PIN</div>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '10px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--rni-accent)' }}></div>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--rni-accent)' }}></div>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', border: '1.5px solid var(--rni-n-400)' }}></div>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', border: '1.5px solid var(--rni-n-400)' }}></div>
                    </div>
                    <div style={{ fontSize: '10.5px', color: 'var(--rni-n-600)', marginTop: '10px' }}>Required by your organisation</div>
                  </div>
                  <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                    <div style={{ height: '8px', background: 'var(--rni-n-100)', borderRadius: '2px' }}></div>
                    <div style={{ height: '8px', background: 'var(--rni-n-100)', borderRadius: '2px', width: '80%' }}></div>
                    <div style={{ height: '8px', background: 'var(--rni-n-100)', borderRadius: '2px', width: '60%' }}></div>
                  </div>
                </div>
              </div>
              <div style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '10px', color: 'var(--rni-accent-strong)', textAlign: 'center', marginTop: '10px', letterSpacing: '.06em', textTransform: 'uppercase' }}>policy boundary</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
              <div style={{ borderLeft: '2px solid var(--rni-accent)', paddingLeft: '14px' }}>
                <div style={{ fontSize: '14px', fontWeight: '600' }}>Save is directional</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12.5px' }}>
                    <svg width="70" height="16" viewBox="0 0 70 16" fill="none"><path d="M2 8 H54" style={{ stroke: 'var(--rni-green)' }} strokeWidth="1.5"/><path d="M48 3 L56 8 L48 13" style={{ stroke: 'var(--rni-green)' }} strokeWidth="1.5"/></svg>
                    <span style={{ color: 'var(--rni-green)', fontWeight: '500' }}>Work storage — allowed</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12.5px' }}>
                    <svg width="70" height="16" viewBox="0 0 70 16" fill="none"><path d="M2 8 H40" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.5"/><path d="M48 2 L60 14 M60 2 L48 14" style={{ stroke: 'var(--rni-red)' }} strokeWidth="1.6"/></svg>
                    <span style={{ color: 'var(--rni-n-600)' }}>Personal storage — blocked</span>
                  </div>
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--rni-n-600)', lineHeight: '1.5', marginTop: '8px' }}>The same action is permitted or refused depending on where the data lands. That contrast is the whole idea.</div>
              </div>
              <div style={{ borderLeft: '2px solid var(--rni-accent)', paddingLeft: '14px' }}>
                <div style={{ fontSize: '14px', fontWeight: '600' }}>Managed browser required</div>
                <div style={{ fontSize: '12.5px', color: 'var(--rni-n-600)', lineHeight: '1.5' }}>Links open in Edge under policy, not in the employee’s default browser.</div>
              </div>
              <div style={{ background: 'var(--rni-n-50)', border: '1px solid var(--rni-n-100)', padding: '14px', fontSize: '12.5px', color: 'var(--rni-n-600)', lineHeight: '1.55' }}>Nothing here reaches outside the dashed boundary. Personal photos, messages and apps are not in scope of any of these controls.</div>
            </div>
          </div>
    </DiagramFrame>
  );
}
