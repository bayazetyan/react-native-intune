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
  const podfile =
    files.podfile === undefined ? null : write('ios/Podfile', files.podfile);
  if (files.podProps !== undefined) {
    write('ios/Podfile.properties.json', files.podProps);
  }
  const pbxproj =
    files.pbxproj === undefined
      ? null
      : write('ios/App.xcodeproj/project.pbxproj', files.pbxproj);
  return {
    root,
    ios: { podfile, pbxproj },
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

describe('ios-deployment-target', () => {
  const target = (files) => inspect('ios-deployment-target', files);

  /**
   * A project.pbxproj in the shape Xcode writes: an application target and the project,
   * each with a Debug and a Release configuration. `app` is the target's own setting —
   * null when it sets none and inherits — and `project` the project-level one.
   */
  const pbx = ({ app, project }) => {
    const id = (n) => `${n}`.padStart(24, '0');
    const config = (n, name, value) =>
      `\t\t${id(n)} /* ${name} */ = {\n\t\t\tisa = XCBuildConfiguration;\n` +
      `\t\t\tbuildSettings = {\n` +
      (value ? `\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = ${value};\n` : '') +
      `\t\t\t};\n\t\t\tname = ${name};\n\t\t};\n`;
    const list = (n, a, b) =>
      `\t\t${id(n)} /* list */ = {\n\t\t\tisa = XCConfigurationList;\n` +
      `\t\t\tbuildConfigurations = (\n\t\t\t\t${id(a)} /* Debug */,\n\t\t\t\t${id(b)} /* Release */,\n\t\t\t);\n\t\t};\n`;
    return (
      '// !$*UTF8*$!\n{\n\tobjects = {\n' +
      `\t\t${id(1)} /* app */ = {\n\t\t\tisa = PBXNativeTarget;\n` +
      `\t\t\tbuildConfigurationList = ${id(10)} /* list */;\n` +
      '\t\t\tproductType = "com.apple.product-type.application";\n\t\t};\n' +
      `\t\t${id(2)} /* Project object */ = {\n\t\t\tisa = PBXProject;\n` +
      `\t\t\tbuildConfigurationList = ${id(11)} /* list */;\n\t\t};\n` +
      config(20, 'Debug', app) +
      config(21, 'Release', app) +
      config(22, 'Debug', project) +
      config(23, 'Release', project) +
      list(10, 20, 21) +
      list(11, 22, 23) +
      '\t};\n}\n'
    );
  };
  const PODFILE_17 = "platform :ios, '17.0'\n";

  it('passes 17.0 in both the Podfile and the app target', () => {
    expect(
      target({
        podfile: PODFILE_17,
        pbxproj: pbx({ app: '17.0', project: '17.0' }),
      }).state
    ).toBe('ok');
  });

  /** React Native's own template. It fails at pod install, before anything else. */
  it('fails the template minimum', () => {
    const result = target({
      podfile: 'platform :ios, min_ios_version_supported\n',
      pbxproj: pbx({ app: null, project: '15.1' }),
    });
    expect(result.state).toBe('wrong');
    expect(result.detail).toContain('min_ios_version_supported');
  });

  /**
   * The one that gets through: pod install succeeds and the app builds, then crashes at
   * launch on an iOS 16 device the app target still claims to support. Here the target
   * sets nothing and inherits the project's value, which is how React Native's template
   * is laid out.
   */
  it('fails a raised Podfile with the app target inheriting a lower project value', () => {
    const result = target({
      podfile: PODFILE_17,
      pbxproj: pbx({ app: null, project: '15.1' }),
    });
    expect(result.state).toBe('wrong');
    expect(result.detail).toContain('15.1 (Debug)');
  });

  it('fails an app target set lower than the project', () => {
    expect(
      target({
        podfile: PODFILE_17,
        pbxproj: pbx({ app: '15.1', project: '17.0' }),
      }).state
    ).toBe('wrong');
  });

  /**
   * Expo's prebuild: expo-build-properties raises the app target to 17.0 and leaves the
   * project level at 16.4. The app builds for 17.0. Counting every value in the file
   * reported this as wrong on a real Expo project.
   */
  it('passes an app target that overrides a lower project-level default', () => {
    const podfile =
      "platform :ios, podfile_properties['ios.deploymentTarget'] || '16.4'\n";
    expect(
      target({
        podfile,
        podProps: '{"ios.deploymentTarget":"17.0"}',
        pbxproj: pbx({ app: '17.0', project: '16.4' }),
      }).state
    ).toBe('ok');
    expect(
      target({
        podfile,
        podProps: '{}',
        pbxproj: pbx({ app: '17.0', project: '16.4' }),
      }).state
    ).toBe('wrong');
  });

  it('ignores a commented-out platform line', () => {
    const podfile =
      "# platform :ios, '17.0'\nplatform :ios, min_ios_version_supported\n";
    expect(
      target({ podfile, pbxproj: pbx({ app: '17.0', project: '17.0' }) }).state
    ).toBe('wrong');
  });
});

describe('android-toolchain', () => {
  /** A project whose versions live where React Native's templates put them. */
  const toolchain = ({ gradle, agp, kotlin, rn }) => {
    const root = fs.mkdtempSync(path.join(dir, 'tc-'));
    const put = (name, contents) => {
      const file = path.join(root, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents);
      return file;
    };
    put(
      'android/gradle/wrapper/gradle-wrapper.properties',
      `distributionUrl=https\\://services.gradle.org/distributions/gradle-${gradle}-bin.zip\n`
    );
    put(
      'node_modules/react-native/gradle/libs.versions.toml',
      `[versions]\nagp = "${agp}"\nkotlin = "${kotlin}"\n`
    );
    put(
      'node_modules/react-native/package.json',
      JSON.stringify({ version: rn })
    );
    return checks
      .find((c) => c.id === 'android-toolchain')
      .inspect({
        root,
        android: {
          dir: path.join(root, 'android'),
          rootBuildGradle: put(
            'android/build.gradle',
            'buildscript { dependencies { classpath("com.android.tools.build:gradle") } }\n'
          ),
        },
      });
  };

  it("passes Microsoft's row", () => {
    const result = toolchain({
      gradle: '8.11.1',
      agp: '8.9.1',
      kotlin: '2.1.21',
      rn: '0.80.0',
    });
    expect(result.state).toBe('ok');
    expect(result.detail).toContain("Microsoft's tested row");
  });

  /** Reading AGP and Kotlin from React Native's catalog is what makes this possible. */
  it('passes a combination this project verified, and says whose claim it is', () => {
    const result = toolchain({
      gradle: '9.3.1',
      agp: '8.12.0',
      kotlin: '2.1.20',
      rn: '0.86.3',
    });
    expect(result.state).toBe('ok');
    expect(result.detail).toContain('not by Microsoft');
    // The row for the project's own React Native version, not the first to share Gradle.
    expect(result.detail).toContain('0.86.3');
  });

  it('flags a combination nobody has run', () => {
    const result = toolchain({
      gradle: '9.3.1',
      agp: '8.12.0',
      kotlin: '2.3.0',
      rn: '0.90.0',
    });
    expect(result.state).toBe('wrong');
    expect(result.detail).toContain('kotlin 2.3.0');
  });
});
