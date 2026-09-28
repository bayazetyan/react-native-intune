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
    files.source === undefined
      ? null
      : write('MainApplication.kt', files.source);
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

const inspect = (id, files) =>
  checks.find((c) => c.id === id).inspect(project(files));
const run = (files) => inspect('android-mam-application', files);

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
    expect(
      run({ source: KOTLIN_PLAIN, gradle: GRADLE_WITHOUT_PLUGIN }).state
    ).toBe('wrong');
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

  /**
   * Explicit MAMApplication in source is legitimate only with the SDK on the app
   * module's own classpath. Without it this is precisely the shape a 0.1.0 Expo prebuild
   * wrote — it does not compile, and doctor passed it as protected.
   */
  it('fails MAMApplication in source when the SDK is not on the app classpath', () => {
    const source = KOTLIN_PLAIN.replace(
      ': Application()',
      ': MAMApplication()'
    );
    const result = run({ source, gradle: GRADLE_WITH_PLUGIN });
    expect(result.state).toBe('wrong');
    expect(result.detail).toContain('does not compile');
  });

  it('passes MAMApplication in source when the app module has the SDK itself', () => {
    const source = KOTLIN_PLAIN.replace(
      ': Application()',
      ': MAMApplication()'
    );
    const gradle =
      GRADLE_WITH_PLUGIN +
      'dependencies {\n  implementation files("libs/Microsoft.Intune.MAM.SDK.aar")\n}\n';
    const result = run({ source, gradle });
    expect(result.state).toBe('ok');
    expect(result.detail).toContain('extends MAMApplication directly');
  });

  it('is not fooled by a commented-out MAMApplication declaration either', () => {
    const source = KOTLIN_PLAIN.replace(
      'class MainApplication',
      '/* Example:\n * class MainApplication : MAMApplication()\n */\nclass MainApplication'
    );
    expect(run({ source, gradle: GRADLE_WITHOUT_PLUGIN }).state).toBe('wrong');
  });

  it('reports missing when there is no Application subclass at all', () => {
    expect(run({ gradle: GRADLE_WITH_PLUGIN }).state).toBe('missing');
  });

  /** A green result it did not earn is the one outcome this tool must never produce. */
  it('says unknown rather than guessing at a Kotlin DSL build file', () => {
    expect(
      run({ source: KOTLIN_PLAIN, kts: '/somewhere/app/build.gradle.kts' })
        .state
    ).toBe('unknown');
  });
});

describe('android-mam-plugin', () => {
  it('passes the apply form and the plugins-block forms', () => {
    for (const gradle of [
      'apply plugin: "com.microsoft.intune.mam"\n',
      "apply plugin: 'com.microsoft.intune.mam'\n",
      'plugins {\n  id "com.microsoft.intune.mam"\n}\n',
      'plugins {\n  id("com.microsoft.intune.mam")\n}\n',
    ]) {
      expect(inspect('android-mam-plugin', { gradle }).state).toBe('ok');
    }
  });

  /**
   * Commenting the plugin out is the first thing anyone does when it breaks a
   * third-party library, which is when it matters most that doctor notices. The old
   * substring match read it as applied.
   */
  it('is not fooled by a commented-out apply line', () => {
    for (const gradle of [
      '// apply plugin: "com.microsoft.intune.mam"\n',
      '/*\napply plugin: "com.microsoft.intune.mam"\n*/\n',
    ]) {
      expect(inspect('android-mam-plugin', { gradle }).state).toBe('missing');
      expect(run({ source: KOTLIN_PLAIN, gradle }).state).toBe('wrong');
    }
  });

  /** The root build file's classpath entry names the plugin's jar, not the plugin. */
  it('does not count the buildscript classpath entry', () => {
    const gradle =
      'classpath files("vendor/android/GradlePlugin/com.microsoft.intune.mam.build.jar")\n';
    expect(inspect('android-mam-plugin', { gradle }).state).toBe('missing');
  });

  /** A `//` is only a comment after whitespace — a repository URL must survive. */
  it('keeps a line that contains a URL', () => {
    const gradle =
      'maven { url "https://example.com/m2" }; apply plugin: "com.microsoft.intune.mam"\n';
    expect(inspect('android-mam-plugin', { gradle }).state).toBe('ok');
  });
});

describe('android-auth-callback', () => {
  it('is not fooled by a commented-out registration', () => {
    const source = KOTLIN_PLAIN.replace(
      'RNIntuneAuthCallback.register(this)',
      '// RNIntuneAuthCallback.register(this)'
    );
    expect(inspect('android-auth-callback', { source }).state).toBe('missing');
    expect(
      inspect('android-auth-callback', { source: KOTLIN_PLAIN }).state
    ).toBe('ok');
  });
});
