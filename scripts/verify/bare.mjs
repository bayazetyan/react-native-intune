#!/usr/bin/env node
/**
 * Builds a fresh bare React Native app with this package installed from a packed
 * tarball, integrated the way the documentation tells a developer to.
 *
 * The example app cannot answer this. It lives inside the monorepo, links the library
 * as a workspace, and was integrated by hand over weeks — so it proves the code works,
 * not that a new project following the setup pages ends up protected. This does the
 * second thing: `setup`, then each manual step the pages describe, then the installed
 * package's own `doctor`, which has to come back green before anything is compiled.
 *
 *     yarn verify:bare [--rn 0.87.1] [--platform android|ios] [--release] [--keep]
 *
 * `--rn` picks the React Native version, which is how the supported range is tested at
 * both ends. `--release` adds an unsigned Release build for a device — the
 * configuration where stripping and optimisation happen, and the one a simulator build
 * never exercises.
 *
 * Covered on iOS: the pod resolves from the tarball, the SDK frameworks link and are
 * embedded, and the app compiles in Debug and optionally Release. Not covered: keychain
 * entitlements, URL types, the MSAL redirect in the AppDelegate and the configurator
 * build phase. Those decide whether sign-in works, not whether the app builds, and
 * doctor reports them.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  assembleDebug,
  capture,
  checkApplicationSource,
  checkMamReport,
  edit,
  fail,
  findFiles,
  installTarball,
  installedModules,
  note,
  option,
  packTarball,
  requireAndroid,
  requireXcode,
  run,
  say,
  verify,
} from './common.mjs';

/** Pinned and bumped deliberately, for the same reason as the Expo SDK is. */
const RN_VERSION = option('rn', '0.87.1');
const CLI_VERSION = '20.2.0';
const NAME = 'IntuneBare';

const platform = option('platform', 'both');
const android = platform === 'both' || platform === 'android';
const ios = platform === 'both' || platform === 'ios';
const release = process.argv.includes('--release');

const androidHome = android ? requireAndroid() : null;
if (ios) {
  requireXcode();
}

/** Runs a command that exits non-zero by design, and returns its output either way. */
const tolerate = (command, args, options) => {
  try {
    return capture(command, args, options);
  } catch (error) {
    if (typeof error.stdout !== 'string') {
      throw error;
    }
    return error.stdout;
  }
};

await verify('rni-bare-', async (dir) => {
  const tarball = packTarball(dir);
  const app = path.join(dir, NAME);

  say(`Creating a React Native ${RN_VERSION} app`);
  run(
    'npx',
    [
      '--yes',
      `@react-native-community/cli@${CLI_VERSION}`,
      'init',
      NAME,
      '--version',
      RN_VERSION,
      '--directory',
      app,
      '--skip-install',
      '--install-pods',
      'false',
      '--skip-git-init',
      '--pm',
      'npm',
    ],
    { cwd: dir }
  );
  run('npm', ['install'], { cwd: app });

  const installed = installTarball(app, tarball, { ios });
  const { transforms } = installedModules(installed);
  const { signatureHash } = await installedModules(installed).checks();

  // ---------------------------------------------------------------- the setup pages

  say('Running setup');
  // Exits non-zero while manual steps remain, by design — so a partial setup cannot be
  // mistaken for a complete one. The manual steps follow.
  tolerate('npx', ['react-native-intune', 'setup', '--yes', '--force'], {
    cwd: app,
  });

  if (android) {
    say('Applying the Android steps setup leaves to the developer');
    // The page's precondition. Older templates ship 23 and MSAL requires 24; a newer
    // template already has it, and this leaves it alone.
    edit(path.join(app, 'android/build.gradle'), (s) =>
      s.replace(/(minSdkVersion\s*=\s*)(\d+)/, (m, key, v) =>
        Number(v) < 24 ? `${key}24` : m
      )
    );
    const appGradle = path.join(app, 'android/app/build.gradle');
    edit(appGradle, transforms.withMamPluginApplied);
    edit(path.join(app, 'android/build.gradle'), transforms.withMamClasspath);

    const [mainApplication] = findFiles(
      path.join(app, 'android/app/src/main'),
      (n) => /^MainApplication\.(kt|java)$/.test(n)
    );
    const language = mainApplication.endsWith('.kt') ? 'kt' : 'java';
    edit(mainApplication, (s) => transforms.withMamApplication(s, language));

    // The redirect activity takes the hash of the key the build is actually signed
    // with — computed here from that keystore, the way doctor computes it, rather than
    // assumed to be the template's.
    const hash = signatureHash({
      android: { debugKeystore: path.join(app, 'android/app/debug.keystore') },
    });
    if (!hash) {
      fail('Could not read the signature hash from android/app/debug.keystore');
    }
    const applicationId = fs
      .readFileSync(appGradle, 'utf8')
      .match(/applicationId\s+["']([\w.]+)["']/)?.[1];
    if (!applicationId) {
      fail('No applicationId in android/app/build.gradle');
    }
    edit(path.join(app, 'android/app/src/main/AndroidManifest.xml'), (s) =>
      s.replace(
        /(\s*)<\/application>/,
        `
        <activity
            android:name="com.microsoft.identity.client.BrowserTabActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data
                    android:scheme="msauth"
                    android:host="${applicationId}"
                    android:path="/${hash}" />
            </intent-filter>
        </activity>$1</application>`
      )
    );
    note(`${applicationId}, signature hash ${hash}`);
  }

  if (ios) {
    say('Raising the iOS deployment target to 17.0');
    edit(path.join(app, 'ios/Podfile'), (s) =>
      s.replace(/^(\s*platform\s+:ios\s*,\s*).+$/m, "$1'17.0'")
    );
    edit(path.join(app, `ios/${NAME}.xcodeproj/project.pbxproj`), (s) =>
      s.replace(
        /IPHONEOS_DEPLOYMENT_TARGET = [\d.]+;/g,
        'IPHONEOS_DEPLOYMENT_TARGET = 17.0;'
      )
    );
  }

  // ---------------------------------------------------------------- doctor

  say('Running doctor from the installed package');
  const report = JSON.parse(
    tolerate('npx', ['react-native-intune', 'doctor', '--json'], { cwd: app })
  );
  const wanted = report.results.filter(
    (r) =>
      (android && r.platform === 'android') ||
      (ios && r.id === 'ios-deployment-target')
  );
  for (const r of wanted) {
    note(`${r.state.padEnd(8)} ${r.id}${r.detail ? `  (${r.detail})` : ''}`);
  }
  // Advisories do not fail the exit code by design, so they do not fail this either.
  const failing = wanted.filter(
    (r) => r.state !== 'ok' && r.severity !== 'advisory'
  );
  if (failing.length > 0) {
    fail(
      'doctor still reports, after every step the setup pages describe:\n  ' +
        failing.map((r) => `${r.id}: ${r.state}`).join('\n  ') +
        '\nEither a page is missing a step or doctor is checking the wrong thing.'
    );
  }

  // ---------------------------------------------------------------- android

  if (android) {
    const packageName = checkApplicationSource(app);
    assembleDebug(app, androidHome);
    checkMamReport(app, packageName);
  }

  // ---------------------------------------------------------------- ios

  if (ios) {
    say('pod install');
    // CocoaPods dies with an encoding error that hides the real one without a UTF-8
    // locale, which a non-interactive shell does not always have.
    run('pod', ['install'], {
      cwd: path.join(app, 'ios'),
      env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    });

    const builds = [
      {
        configuration: 'Debug',
        sdk: 'iphonesimulator',
        destination: 'iOS Simulator',
      },
      ...(release
        ? [{ configuration: 'Release', sdk: 'iphoneos', destination: 'iOS' }]
        : []),
    ];
    for (const b of builds) {
      say(`xcodebuild ${b.configuration} for ${b.destination}`);
      run(
        'xcodebuild',
        [
          '-workspace',
          `${NAME}.xcworkspace`,
          '-scheme',
          NAME,
          '-configuration',
          b.configuration,
          '-sdk',
          b.sdk,
          '-destination',
          `generic/platform=${b.destination}`,
          '-derivedDataPath',
          'build',
          'CODE_SIGNING_ALLOWED=NO',
          '-quiet',
          'build',
        ],
        { cwd: path.join(app, 'ios') }
      );
      // Linking is not embedding. A framework that links but is not copied into the
      // bundle builds cleanly and fails at launch with dyld unable to find it.
      const bundle = path.join(
        app,
        `ios/build/Build/Products/${b.configuration}-${b.sdk}/${NAME}.app`
      );
      const frameworks = path.join(bundle, 'Frameworks');
      for (const f of [
        'IntuneMAMSwift.framework',
        'IntuneMAMSwiftStub.framework',
        'IntuneMAMTelemetry.framework',
      ]) {
        if (!fs.existsSync(path.join(frameworks, f))) {
          fail(`${f} is not embedded in ${path.relative(app, bundle)}`);
        }
      }
      note(`${path.relative(app, bundle)} embeds the MAM frameworks`);
    }
  }

  process.stdout.write(
    `\n\x1b[32mOK\x1b[0m — React Native ${RN_VERSION}, integrated as the setup pages ` +
      'describe, doctor green, and built.\n' +
      'Not covered: enrollment, which needs a tenant and a device.\n'
  );
});
