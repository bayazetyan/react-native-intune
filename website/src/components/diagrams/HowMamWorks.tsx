/**
 * How MAM works — the enrollment and policy flow.
 *
 * Ported verbatim from the design canvas artboard "5 · Diagram — how MAM works" — the
 * declared widths, spacing, type sizes and colours are the design's, not a
 * reinterpretation of it. Generated rather than hand-written for that reason.
 *
 * The frame is a fixed 1200px, exactly as the artboard specifies. `DiagramFrame`
 * provides the horizontal scroll that keeps it from being squeezed on a narrow screen:
 * a diagram compressed until its labels wrap has stopped explaining anything.
 */
import type { ReactNode } from 'react';

import { DiagramFrame } from './DiagramFrame';

export function HowMamWorks(): ReactNode {
  return (
    <DiagramFrame caption={"The boundary encloses one app. The phone is the employee's own, unenrolled, and nothing in this flow changes that."}>
      <div style={{ width: '1200px', background: 'var(--rni-paper)', border: '1px solid var(--rni-n-200)', padding: '48px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr 330px', gap: '28px', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ border: '1.5px solid var(--rni-n-400)', borderRadius: '46px', padding: '22px 24px', textAlign: 'center' }}>
                  <div style={{ fontSize: '15px', fontWeight: '600' }}>Microsoft Intune service</div>
                  <div style={{ fontSize: '12.5px', color: 'var(--rni-n-600)', lineHeight: '1.5', marginTop: '4px' }}>Administrator authors an App Protection Policy and targets it at your app.</div>
                </div>
                <div style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '11px', color: 'var(--rni-n-600)', textAlign: 'center' }}>cloud</div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--rni-accent)', color: 'var(--rni-paper)', fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>3</div>
                  <div style={{ flex: '1' }}>
                    <svg width="100%" height="18" viewBox="0 0 320 18" preserveAspectRatio="none" fill="none"><path d="M318 9 H8" style={{ stroke: 'var(--rni-accent)' }} strokeWidth="1.5"/><path d="M14 3 L6 9 L14 15" style={{ stroke: 'var(--rni-accent)' }} strokeWidth="1.5"/></svg>
                    <div style={{ fontSize: '12.5px', color: 'var(--rni-ink)', fontWeight: '500', marginTop: '2px' }}>App registers the work identity</div>
                    <div style={{ fontSize: '12px', color: 'var(--rni-accent)', fontFamily: '\'IBM Plex Mono\',monospace' }}>app registers, device does not enroll</div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--rni-accent)', color: 'var(--rni-paper)', fontSize: '12px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>4</div>
                  <div style={{ flex: '1' }}>
                    <svg width="100%" height="18" viewBox="0 0 320 18" preserveAspectRatio="none" fill="none"><path d="M2 9 H312" style={{ stroke: 'var(--rni-accent)' }} strokeWidth="1.5"/><path d="M306 3 L314 9 L306 15" style={{ stroke: 'var(--rni-accent)' }} strokeWidth="1.5"/></svg>
                    <div style={{ fontSize: '12.5px', color: 'var(--rni-ink)', fontWeight: '500', marginTop: '2px' }}>Policy returned to that app only</div>
                  </div>
                </div>
              </div>

              <div style={{ border: '2px solid var(--rni-n-400)', borderRadius: '34px', padding: '16px', background: 'var(--rni-paper)' }}>
                <div style={{ width: '56px', height: '4px', background: 'var(--rni-n-200)', borderRadius: '2px', margin: '2px auto 14px' }}></div>
                <div style={{ fontSize: '11px', color: 'var(--rni-n-600)', textAlign: 'center', marginBottom: '12px', fontFamily: '\'IBM Plex Mono\',monospace' }}>personal, unenrolled phone</div>

                <div style={{ border: '2px dashed var(--rni-accent)', background: 'var(--rni-accent-tint)', borderRadius: '12px', padding: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '32px', height: '32px', background: 'var(--rni-accent)', borderRadius: '8px' }}></div>
                    <div><div style={{ fontSize: '14px', fontWeight: '600' }}>Your app</div><div style={{ fontSize: '11.5px', color: 'var(--rni-accent-strong)' }}>contains Intune App SDK</div></div>
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--rni-accent-strong)', lineHeight: '1.5', marginTop: '10px' }}><span style={{ width: '18px', height: '18px', borderRadius: '50%', background: 'var(--rni-accent)', color: 'var(--rni-paper)', fontSize: '11px', fontWeight: '600', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginRight: '6px' }}>5</span>SDK enforces: PIN on launch, no copy out, no screenshots</div>
                  <div style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '10px', color: 'var(--rni-accent-strong)', marginTop: '10px', letterSpacing: '.06em', textTransform: 'uppercase' }}>protected boundary — encloses this app only</div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '8px 0' }}>
                  <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--rni-n-400)', color: 'var(--rni-paper)', fontSize: '11px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>1</div>
                  <svg width="60" height="14" viewBox="0 0 60 14" fill="none"><path d="M2 7 H52" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.4"/><path d="M46 2 L54 7 L46 12" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.4"/></svg>
                  <svg width="60" height="14" viewBox="0 0 60 14" fill="none"><path d="M58 7 H8" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.4"/><path d="M14 2 L6 7 L14 12" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.4"/></svg>
                  <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--rni-n-400)', color: 'var(--rni-paper)', fontSize: '11px', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>2</div>
                </div>

                <div style={{ border: '1.5px solid var(--rni-n-400)', borderRadius: '12px', padding: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '28px', height: '28px', background: 'var(--rni-n-100)', border: '1px solid var(--rni-n-200)', borderRadius: '7px' }}></div>
                    <div><div style={{ fontSize: '13px', fontWeight: '500' }}>Broker app</div><div style={{ fontSize: '11.5px', color: 'var(--rni-n-600)' }}>Authenticator / Company Portal — holds work identity, returns token</div></div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginTop: '16px' }}>
                  <div style={{ height: '40px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                  <div style={{ height: '40px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                  <div style={{ height: '40px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                  <div style={{ height: '40px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--rni-n-600)', textAlign: 'center', marginTop: '10px' }}>personal apps — untouched, outside the boundary</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: '20px', marginTop: '40px', paddingTop: '28px', borderTop: '1px solid var(--rni-n-100)' }}>
              <div style={{ fontSize: '12.5px', lineHeight: '1.55', color: 'var(--rni-n-600)' }}><strong style={{ color: 'var(--rni-ink)' }}>1</strong>  Employee signs in with their work account; the app hands sign-in to the broker.</div>
              <div style={{ fontSize: '12.5px', lineHeight: '1.55', color: 'var(--rni-n-600)' }}><strong style={{ color: 'var(--rni-ink)' }}>2</strong>  Broker returns a token proving who they are.</div>
              <div style={{ fontSize: '12.5px', lineHeight: '1.55', color: 'var(--rni-n-600)' }}><strong style={{ color: 'var(--rni-ink)' }}>3</strong>  App registers that identity with Intune. <span style={{ color: 'var(--rni-accent-strong)' }}>This is enrollment of the app — the device does not enroll.</span></div>
              <div style={{ fontSize: '12.5px', lineHeight: '1.55', color: 'var(--rni-n-600)' }}><strong style={{ color: 'var(--rni-ink)' }}>4</strong>  Service returns the policy the administrator targeted at this app.</div>
              <div style={{ fontSize: '12.5px', lineHeight: '1.55', color: 'var(--rni-n-600)' }}><strong style={{ color: 'var(--rni-ink)' }}>5</strong>  SDK enforces it inside the app: PIN on launch, no copy out, no screenshots.</div>
            </div>
          </div>
    </DiagramFrame>
  );
}
