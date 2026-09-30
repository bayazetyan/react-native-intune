import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@jest/globals';

/**
 * sdk-versions.json is the single source of truth for which Microsoft SDKs this library
 * builds against, but two of its pins are also written where a build tool reads them —
 * MSAL for iOS in the podspec, MSAL for Android in build.gradle. A bump that changes one
 * and forgets the other builds, ships two MSALs' worth of assumptions, and is exactly the
 * hazard pinning exists to prevent. The SDK-watch issues list every file; this makes
 * forgetting one fail.
 */
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pins = JSON.parse(read('sdk-versions.json'));

describe('SDK pins agree with the files that build them', () => {
  it('MSAL for iOS — RNIntune.podspec', () => {
    const podspec = read('RNIntune.podspec').match(
      /s\.dependency\s+"MSAL",\s*"([^"]+)"/
    )?.[1];
    expect(podspec).toBe(pins.toolchain.msal_ios);
  });

  it('MSAL for Android — android/build.gradle', () => {
    const gradle = read('android/build.gradle').match(
      /com\.microsoft\.identity\.client:msal:([\w.-]+)/
    )?.[1];
    expect(gradle).toBe(pins.toolchain.msal_android);
  });
});
