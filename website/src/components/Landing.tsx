/**
 * The landing page, ported from artboards "3 · Landing hero" and "4 · Landing features".
 *
 * Two things are deliberately dropped: the drawn navbar, because Docusaurus renders the
 * real one and two navbars on one page is worse than none, and the outer 1440px fixed
 * width, because a landing page is the one place that genuinely has to reflow. Everything
 * inside — the type scale, the spacing, the 1px grid gaps, the illustration — is the
 * design's own markup, unchanged. The two calls to action became links; they are drawn as
 * divs in a mock, and a mock does not have to navigate.
 */
import Link from '@docusaurus/Link';
import type { ReactNode } from 'react';

export function LandingHero(): ReactNode {
  return (
    <div className="landing-hero">
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '64px', padding: '76px 40px 84px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingTop: '16px' }}>
                  <div style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '12px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--rni-accent)' }}>MAM without enrollment</div>
                  <div style={{ fontSize: '54px', lineHeight: '1.08', fontWeight: '600', letterSpacing: '-0.03em', maxWidth: '14em', textWrap: 'pretty' }}>Microsoft Intune app protection for React Native</div>
                  <div style={{ fontSize: '18px', lineHeight: '1.6', color: 'var(--rni-n-600)', maxWidth: '34em', textWrap: 'pretty' }}>App Protection Policies on iOS and Android — PIN, copy-paste restrictions, conditional launch and remote wipe — on the employee’s own unmanaged phone.</div>
                  <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                    <Link to="/docs/getting-started" style={{ background: 'var(--rni-accent)', color: 'var(--rni-paper)', fontSize: '15px', fontWeight: '500', padding: '13px 24px', borderRadius: '5px' }}>Get started</Link>
                    <Link href="https://github.com/bayazetyan/react-native-intune" style={{ border: '1px solid var(--rni-n-200)', fontSize: '15px', fontWeight: '500', padding: '13px 24px', borderRadius: '5px', color: 'var(--rni-ink)' }}>GitHub</Link>
                  </div>
                  <div style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '13px', color: 'var(--rni-n-600)', background: 'var(--rni-n-50)', border: '1px solid var(--rni-n-100)', padding: '12px 14px', borderRadius: '5px', marginTop: '12px', width: 'fit-content' }}>npm i react-native-intune</div>
                </div>
                {/* hero illustration */}
                <div style={{ position: 'relative', background: 'var(--rni-n-50)', border: '1px solid var(--rni-n-100)', padding: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '28px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', width: '190px' }}>
                    <div style={{ border: '1.5px solid var(--rni-n-400)', background: 'var(--rni-paper)', borderRadius: '44px', padding: '14px 18px', textAlign: 'center' }}>
                      <div style={{ fontSize: '13px', fontWeight: '500' }}>Intune service</div>
                      <div style={{ fontSize: '11px', color: 'var(--rni-n-600)' }}>admin authors policy</div>
                    </div>
                    <svg width="150" height="26" viewBox="0 0 150 26" fill="none"><path d="M4 13 H132" style={{ stroke: 'var(--rni-accent)' }} strokeWidth="1.5"/><path d="M126 7 L134 13 L126 19" style={{ stroke: 'var(--rni-accent)' }} strokeWidth="1.5"/></svg>
                    <div style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '11px', color: 'var(--rni-accent)' }}>policy → one app</div>
                  </div>
                  <div style={{ width: '246px', border: '2px solid var(--rni-n-400)', borderRadius: '30px', background: 'var(--rni-paper)', padding: '12px' }}>
                    <div style={{ width: '52px', height: '4px', background: 'var(--rni-n-200)', borderRadius: '2px', margin: '2px auto 12px' }}></div>
                    <div style={{ border: '2px dashed var(--rni-accent)', background: 'var(--rni-accent-tint)', borderRadius: '12px', padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '34px', height: '34px', background: 'var(--rni-accent)', borderRadius: '8px' }}></div>
                        <div><div style={{ fontSize: '13px', fontWeight: '500' }}>Your app</div><div style={{ fontSize: '11px', color: 'var(--rni-accent-strong)' }}>PIN · no copy out · no screenshot</div></div>
                      </div>
                      <div style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '10px', color: 'var(--rni-accent-strong)', marginTop: '10px', letterSpacing: '.06em', textTransform: 'uppercase' }}>protected boundary</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginTop: '16px' }}>
                      <div style={{ height: '38px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                      <div style={{ height: '38px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                      <div style={{ height: '38px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                      <div style={{ height: '38px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                      <div style={{ height: '38px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                      <div style={{ height: '38px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                      <div style={{ height: '38px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                      <div style={{ height: '38px', background: 'var(--rni-n-100)', borderRadius: '9px' }}></div>
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--rni-n-600)', marginTop: '12px', textAlign: 'center' }}>personal apps — outside the boundary</div>
                  </div>
                  <div style={{ position: 'absolute', bottom: '16px', left: '36px', fontSize: '11px', color: 'var(--rni-n-600)', fontFamily: '\'IBM Plex Mono\',monospace' }}>the phone is unenrolled, personal, untouched</div>
                </div>
              </div>
    </div>
  );
}

export function LandingFeatures(): ReactNode {
  return (
    <div className="landing-features">
      {/* The artboard puts the six blocks in a bare row. A heading is added because an
          unlabelled grid makes the reader infer what the list is, and the first item —
          the app is managed and the phone is not — is the one thing someone evaluating
          this needs to read as a claim about the library rather than as a stray fact. */}
      <header className="landing-features__head">
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: '12px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--rni-accent)' }}>What the library does</div>
        <h2 style={{ fontSize: '32px', fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.15, margin: '14px 0 0' }}>Six things worth knowing before you start</h2>
        <p style={{ fontSize: '16px', lineHeight: 1.6, color: 'var(--rni-n-600)', margin: '10px 0 0', maxWidth: '46em' }}>In the order that decides whether you can use it — starting with the one that is most often assumed the other way round.</p>
      </header>
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: '1px', background: 'var(--rni-n-100)', border: '1px solid var(--rni-n-100)' }}>
              <div style={{ background: 'var(--rni-paper)', padding: '32px' }}>
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none"><rect x="3" y="2" width="26" height="28" rx="4" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.6"/><rect x="8" y="8" width="16" height="12" rx="2.5" style={{ stroke: 'var(--rni-accent)' }} strokeWidth="1.6" strokeDasharray="3 2.5"/><circle cx="16" cy="25" r="1.6" style={{ fill: 'var(--rni-n-400)' }}/></svg>
                <div style={{ fontSize: '17px', fontWeight: '600', marginTop: '18px' }}>The app is protected, the phone is not.</div>
                <div style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--rni-n-600)', marginTop: '8px' }}>MAM-WE: no device enrollment, no MDM profile. The employee’s phone stays theirs.</div>
              </div>
              <div style={{ background: 'var(--rni-paper)', padding: '32px' }}>
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none"><rect x="2" y="6" width="12" height="20" rx="2.5" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.6"/><rect x="18" y="6" width="12" height="20" rx="2.5" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.6"/><path d="M14 16 H18" style={{ stroke: 'var(--rni-accent)' }} strokeWidth="1.6"/></svg>
                <div style={{ fontSize: '17px', fontWeight: '600', marginTop: '18px' }}>Both platforms, one API.</div>
                <div style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--rni-n-600)', marginTop: '8px' }}>iOS and Android behind the same TypeScript interface.</div>
              </div>
              <div style={{ background: 'var(--rni-paper)', padding: '32px' }}>
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none"><circle cx="12" cy="12" r="6" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.6"/><path d="M16.5 16.5 L28 28" style={{ stroke: 'var(--rni-accent)' }} strokeWidth="1.6"/><path d="M23 28 H28 V23" style={{ stroke: 'var(--rni-accent)' }} strokeWidth="1.6"/></svg>
                <div style={{ fontSize: '17px', fontWeight: '600', marginTop: '18px' }}>Sign-in is included.</div>
                <div style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--rni-n-600)', marginTop: '8px' }}>MSAL with broker support ships with the library. Apps with their own MSAL keep it.</div>
              </div>
              <div style={{ background: 'var(--rni-paper)', padding: '32px' }}>
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none"><path d="M16 3 L30 28 H2 Z" style={{ stroke: 'var(--rni-amber)' }} strokeWidth="1.6"/><path d="M16 12 V20" style={{ stroke: 'var(--rni-amber)' }} strokeWidth="1.8"/><circle cx="16" cy="24" r="1.4" style={{ fill: 'var(--rni-amber)' }}/></svg>
                <div style={{ fontSize: '17px', fontWeight: '600', marginTop: '18px' }}>The dangerous failures are made loud.</div>
                <div style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--rni-n-600)', marginTop: '8px' }}>Three ways to integrate this wrong build, run, and protect nothing. <span style={{ fontFamily: '\'IBM Plex Mono\',monospace', fontSize: '13px' }}>doctor</span> finds them and says so.</div>
              </div>
              <div style={{ background: 'var(--rni-paper)', padding: '32px' }}>
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none"><rect x="6" y="2" width="20" height="28" rx="3.5" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.6"/><path d="M11 16 L15 20 L22 11" style={{ stroke: 'var(--rni-accent)' }} strokeWidth="1.8"/></svg>
                <div style={{ fontSize: '17px', fontWeight: '600', marginTop: '18px' }}>Verified on real devices, real tenant.</div>
                <div style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--rni-n-600)', marginTop: '8px' }}>Enrollment cannot be unit-tested. This was run on hardware.</div>
              </div>
              <div style={{ background: 'var(--rni-paper)', padding: '32px' }}>
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none"><rect x="4" y="4" width="10" height="10" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.6"/><rect x="18" y="4" width="10" height="10" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.6"/><rect x="4" y="18" width="10" height="10" style={{ stroke: 'var(--rni-n-400)' }} strokeWidth="1.6"/><rect x="18" y="18" width="10" height="10" style={{ stroke: 'var(--rni-accent)' }} strokeWidth="1.6"/></svg>
                <div style={{ fontSize: '17px', fontWeight: '600', marginTop: '18px' }}>New Architecture.</div>
                <div style={{ fontSize: '14px', lineHeight: '1.6', color: 'var(--rni-n-600)', marginTop: '8px' }}>TurboModule, typed via Codegen.</div>
              </div>
            </div>
    </div>
  );
}
