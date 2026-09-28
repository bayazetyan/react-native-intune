import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { checks } from '../lib/checks.mjs';

/**
 * The `android-mam-application` check, against files on disk.
 *
 * It exists because the previous version of that check never worked and nothing said
 * so: it matched the substring `MAMApplication` anywhere in the source, and passed
 * against this repository's own example only because the word appears in a comment
 * there. A check that cannot fail is worse than no check, and the only way to know the
 * difference is to feed it something that must fail. Issue #5.
 */

let dir;

const KOTLIN_PLAIN = `package com.acme

import android.app.Application

class MainApplication : Application(), ReactApplication {
  override fun onCreate() {
    super.onCreate()
    RNIntuneAuthCallback.register(this)
  }
}
`;

const GRADLE_WITH_PLUGIN = `apply plugin: "com.android.application"
apply plugin: "com.microsoft.intune.mam"
`;

const GRADLE_WITHOUT_PLUGIN = 'apply plugin: "com.android.application"\n';

/** A project shaped the way the check reads it, written to disk. */
const project = (files) => {
  const root = fs.mkdtempSync(path.join(dir, 'p-'));
  const write = (name, contents) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    return file;
  };
  const source =
    files.source === undefined ? null : write('MainApplication.kt', files.source);
  const gradle =
    files.gradle === undefined ? null : write('build.gradle', files.gradle);
  return {
    root,
    android: {
      applicationSources: source ? [source] : [],
      appBuildGradle: gradle,
      appBuildGradleKts: files.kts ?? null,
    },
  };
};

const run = (files) =>
  checks
    .find((c) => c.id === 'android-mam-application')
    .inspect(project(files));

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rni-checks-'));
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('android-mam-application', () => {
  it('passes a plain Application subclass when the Gradle plugin is applied', () => {
    const result = run({ source: KOTLIN_PLAIN, gradle: GRADLE_WITH_PLUGIN });
    expect(result.state).toBe('ok');
    expect(result.detail).toContain('rewritten by the Gradle plugin');
  });

  it('fails a plain Application subclass when the plugin is not applied', () => {
    expect(run({ source: KOTLIN_PLAIN, gradle: GRADLE_WITHOUT_PLUGIN }).state).toBe(
      'wrong'
    );
  });

  /**
   * The regression. `MAMApplication` in a comment is what the old check was matching on,
   * in a file that extends plain `Application` with no plugin to transform it — the one
   * combination that must never read as protected.
   */
  it('is not fooled by MAMApplication appearing in a comment', () => {
    const source = KOTLIN_PLAIN.replace(
      'class MainApplication',
      '// the plugin rewrites this into MAMApplication at build time\nclass MainApplication'
    );
    expect(run({ source, gradle: GRADLE_WITHOUT_PLUGIN }).state).toBe('wrong');
  });

  it('passes a class that extends MAMApplication in source', () => {
    const source = KOTLIN_PLAIN.replace(': Application()', ': MAMApplication()');
    const result = run({ source, gradle: GRADLE_WITHOUT_PLUGIN });
    expect(result.state).toBe('ok');
    expect(result.detail).toContain('extends MAMApplication directly');
  });

  it('reports missing when there is no Application subclass at all', () => {
    expect(run({ gradle: GRADLE_WITH_PLUGIN }).state).toBe('missing');
  });

  /** A green result it did not earn is the one outcome this tool must never produce. */
  it('says unknown rather than guessing at a Kotlin DSL build file', () => {
    expect(
      run({ source: KOTLIN_PLAIN, kts: '/somewhere/app/build.gradle.kts' }).state
    ).toBe('unknown');
  });
});
