import { describe, expect, it } from '@jest/globals';

import {
  newer,
  newestAbove,
  newestInLine,
} from '../../.github/scripts/sdk-watch.mjs';

/**
 * The SDK watch picks versions by release line. It used to ask only for the latest
 * release, and on 2026-10-02 Microsoft shipped 21.9.1 and 22.1.1 the same day: the
 * latest was 22.1.1, so 21.9.1 — a deadlock fix on the line this library pins — was
 * never reported.
 */
const release = (tag, extra = {}) => ({
  tag_name: tag,
  published_at: '2026-10-02',
  ...extra,
});

const INTUNE_IOS = [
  release('22.1.1'),
  release('21.9.1'),
  release('22.0.0'),
  release('21.9.0'),
  release('20.9.7'),
  release('21.8.0'),
];

describe('newestInLine', () => {
  it('reports the fix on the pinned line even when a newer major is the latest release', () => {
    expect(newestInLine(INTUNE_IOS, '21.9.0')?.tag_name).toBe('21.9.1');
  });

  it('reports nothing once the pin is the newest of its line', () => {
    expect(newestInLine(INTUNE_IOS, '21.9.1')).toBeNull();
  });

  it('ignores drafts and prereleases', () => {
    const withBeta = [
      release('21.10.0-beta', { prerelease: true }),
      ...INTUNE_IOS,
    ];
    expect(newestInLine(withBeta, '21.9.1')).toBeNull();
  });

  it('handles MSAL Android tags, which carry a v', () => {
    const msal = [release('v8.5.0'), release('v8.4.2'), release('v9.0.0')];
    expect(newestInLine(msal, '8.4.2')?.tag_name).toBe('v8.5.0');
  });
});

describe('newestAbove', () => {
  it('reports the newest release of a higher major', () => {
    expect(newestAbove(INTUNE_IOS, '21.9.1')?.tag_name).toBe('22.1.1');
  });

  /** The 20.x line for Xcode 16 is older, not newer, and must never be offered. */
  it('never reports an older major line', () => {
    expect(newestAbove(INTUNE_IOS, '22.1.1')).toBeNull();
    expect(newestInLine(INTUNE_IOS, '21.9.1')?.tag_name ?? null).not.toBe(
      '20.9.7'
    );
  });
});

describe('newer', () => {
  it('compares numerically, not as strings', () => {
    expect(newer('21.10.0', '21.9.1')).toBe(true);
    expect(newer('21.9.1', '21.10.0')).toBe(false);
  });
});
