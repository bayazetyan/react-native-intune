#!/usr/bin/env node
/**
 * Builds a real Expo app with this package installed from a packed tarball.
 *
 * This exists because of issue #5, and specifically because of how that defect got
 * through: the Expo config plugin was covered by unit tests over its string transforms
 * and by a run against Expo's own `compileModsAsync`, and **neither of them compiles
 * what the plugin generates**. The transform emitted Kotlin that could not build, and
 * every test was green. The only check that would have caught it is the one below —
 * generate the file, then hand it to the Kotlin compiler.
 *
 * It installs from `npm pack` rather than the workspace deliberately. A workspace link
 * resolves differently from a published package: `exports`, the `files` list, the
 * `app.plugin.js` entry point and the `$rootDir/../node_modules/...` classpath path in
 * the generated Gradle files are all only exercised for real by an install.
 *
 * Not part of `yarn test`. It needs the network, an Android SDK and several minutes, so
 * it is run deliberately:
 *
 *     yarn verify:expo [--keep]
 *
 * `--keep` leaves the generated project in place and prints its path, which is what you
 * want the moment anything fails.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEEP = process.argv.includes('--keep');

/**
 * The hash of the debug keystore React Native's template ships. It is only read at
 * sign-in, never during a build, so it is here to exercise the manifest write rather
 * than to be correct for any particular app.
 */
const SIGNATURE_HASH = 'Xo8WBi6jzSxKDVR4drqm84yr9iU=';

let step = 0;
const say = (message) => {
  step += 1;
  process.stdout.write(`\n\x1b[1m${step}. ${message}\x1b[0m\n`);
};
const fail = (message) => {
  process.stderr.write(`\n\x1b[31m${message}\x1b[0m\n`);
  process.exit(1);
};

const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: 'inherit', ...options });

const capture = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: 'utf8', ...options });

// ---------------------------------------------------------------- preconditions

// Checked up front rather than three minutes in, when the failure would come out of
// Gradle and name a missing SDK directory instead of a missing environment variable.
const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!androidHome || !fs.existsSync(androidHome)) {
  fail(
    'ANDROID_HOME (or ANDROID_SDK_ROOT) is not set to an existing directory.\n' +
      'This script builds an Android app; without an SDK there is nothing to build with.'
  );
}
try {
  capture('java', ['-version'], { stdio: 'pipe' });
} catch {
  fail('java not found. The MAM SDK requires JDK 17 — see the setup documentation.');
}

// ---------------------------------------------------------------- pack

say('Packing the library');
// `npm pack --json` is not used, and the reason is worth keeping: pack runs `prepare`,
// `bob build` writes to stdout, and the build output lands in the middle of the JSON.
// The filename is derivable, so derive it.
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const tarball = path.join(
  os.tmpdir(),
  `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`
);
fs.rmSync(tarball, { force: true });
run('npm', ['pack', '--pack-destination', os.tmpdir()], { cwd: ROOT });
if (!fs.existsSync(tarball)) {
  fail(`npm pack did not produce ${tarball}`);
}

// The licence rule, enforced rather than trusted: the SDK binaries are Microsoft's, and
// a tarball carrying them is a licensing problem rather than a packaging bug.
const contents = capture('tar', ['-tzf', tarball]).split('\n');
const vendored = contents.filter((f) => f.startsWith('package/vendor/'));
if (vendored.length > 0) {
  fail(
    `The packed tarball contains ${vendored.length} vendor/ entries. SDK binaries ` +
      'must never be published.'
  );
}
process.stdout.write(`   ${path.basename(tarball)}, ${contents.length} entries\n`);

// ---------------------------------------------------------------- scaffold

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rni-expo-'));
const app = path.join(dir, 'app');

const cleanup = () => {
  if (KEEP) {
    process.stdout.write(`\nProject kept at ${app}\n`);
    return;
  }
  fs.rmSync(dir, { recursive: true, force: true });
};

try {
  say('Creating a blank Expo app');
  run('npx', ['--yes', 'create-expo-app@latest', app, '--template', 'blank'], {
    cwd: dir,
  });

  say('Installing the packed tarball');
  // postinstall runs fetch-sdks, so the vendored SDK lands under the installed package
  // rather than being resolved back to this checkout.
  run('npm', ['install', tarball], { cwd: app });

  const aar = path.join(
    app,
    'node_modules/react-native-intune/vendor/android/Microsoft.Intune.MAM.SDK.aar'
  );
  if (!fs.existsSync(aar)) {
    say('Fetching the SDKs explicitly');
    // postinstall runs with --soft, which warns rather than failing. Here the SDK is not
    // optional: without it the Gradle plugin jar is absent and the build fails on a
    // classpath entry that points at nothing.
    run('node', ['node_modules/react-native-intune/scripts/fetch-sdks.mjs'], {
      cwd: app,
    });
    if (!fs.existsSync(aar)) {
      fail(`The Android SDK was not vendored. Expected ${aar}`);
    }
  }

  say('Adding the config plugin');
  const configFile = path.join(app, 'app.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  config.expo.plugins = [
    ...(config.expo.plugins ?? []),
    ['react-native-intune', { androidSignatureHash: SIGNATURE_HASH }],
  ];
  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);

  say('Running expo prebuild');
  run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean'], { cwd: app });

  // ---------------------------------------------------------------- generated source

  say('Checking the generated Application class');
  const sources = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/^MainApplication\.(kt|java)$/.test(entry.name)) {
        sources.push(full);
      }
    }
  };
  walk(path.join(app, 'android/app/src/main'));
  if (sources.length !== 1) {
    fail(`Expected exactly one MainApplication, found ${sources.length}`);
  }
  const source = fs.readFileSync(sources[0], 'utf8');

  if (!/RNIntuneAuthCallback\s*\.\s*register/.test(source)) {
    fail(
      'The auth callback was not registered in MainApplication. Without it the SDK ' +
        'never receives a token and enrollment fails in a way that looks like a ' +
        'licensing problem.'
    );
  }
  // Issue #5 itself. The superclass belongs to the Gradle plugin, in bytecode; written
  // into the source it does not compile, because the MAM AAR is not on the app module's
  // compile classpath.
  if (/class\s+\w+\s*(?::\s*|\s+extends\s+)MAMApplication\b/.test(source)) {
    fail(
      'MainApplication extends MAMApplication in source. That is issue #5 — the ' +
        'superclass is the Gradle plugin’s job and this will not compile.'
    );
  }
  process.stdout.write(`   ${path.relative(app, sources[0])}\n`);

  // ---------------------------------------------------------------- build

  say('Building :app:assembleDebug');
  run('./gradlew', [':app:assembleDebug', '--no-daemon'], {
    cwd: path.join(app, 'android'),
    env: { ...process.env, ANDROID_HOME: androidHome },
  });

  // ---------------------------------------------------------------- the rewrite

  say('Checking that the MAM plugin rewrote the class');
  // A green build is not the claim. The claim is that the app is a MAMApplication at
  // runtime, and the plugin's own report is the only direct evidence of that — which is
  // exactly what the old doctor check was asserting from a comment instead.
  const logs = path.join(app, 'android/app/build/outputs/intune');
  if (!fs.existsSync(logs)) {
    fail(
      `The MAM plugin produced no report at ${path.relative(app, logs)}. It did not ` +
        'run, which means the app built cleanly and is not protected.'
    );
  }
  const reports = [];
  const collect = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        collect(full);
      } else if (entry.name.endsWith('.html') || entry.name.endsWith('.txt')) {
        reports.push(full);
      }
    }
  };
  collect(logs);
  // The plugin's own sentence, not a co-occurrence of two class names in one file. A
  // loose match here would pass for the same reason the old doctor check passed.
  const changed =
    /Base class\s+android\.app\.Application\s+changed to\s+com\.microsoft\.intune\.mam\.client\.app\.MAMApplication/;
  const report = reports.find((f) =>
    changed.test(fs.readFileSync(f, 'utf8').replace(/<[^>]+>/g, ' '))
  );
  if (!report) {
    fail(
      'No report records the Application base class being changed to MAMApplication. ' +
        'The build succeeded, so this is the silent failure: linked SDK, no enforcement.'
    );
  }
  // The callback is written into `onCreate` precisely because the plugin renames it.
  // If that rename stops happening, the callback is in a method nothing calls.
  if (!/onMAMCreate/.test(fs.readFileSync(report, 'utf8'))) {
    fail(
      `${path.relative(app, report)} shows no onMAMCreate. The callback is registered ` +
        'in onCreate on the assumption that the plugin renames it — it did not.'
    );
  }
  process.stdout.write(`   ${path.relative(app, report)}\n`);

  process.stdout.write(
    '\n\x1b[32mOK\x1b[0m — prebuild, compile, and the superclass rewrite all verified.\n' +
      'Not covered: enrollment. That needs a tenant and a device.\n'
  );
} finally {
  cleanup();
}
