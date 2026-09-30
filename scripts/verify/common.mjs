/**
 * What the Expo and bare verifications share: packing the library, installing it the
 * way a consumer would, and reading the MAM plugin's report for the one sentence that
 * says the app is actually protected.
 *
 * Shared rather than copied because every piece here exists to catch a specific way a
 * green build lies, and two copies of a check like that drift until one of them stops
 * catching anything — which is how the doctor check behind issue #5 ended up matching a
 * comment.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);

/** The value of `--name value`, or the fallback. */
export const option = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

let step = 0;
export const say = (message) => {
  step += 1;
  process.stdout.write(`\n\x1b[1m${step}. ${message}\x1b[0m\n`);
};
export const note = (message) => process.stdout.write(`   ${message}\n`);

/**
 * Thrown rather than exiting. `process.exit` does not run pending `finally` blocks, so
 * an exit from inside the build would skip the cleanup — leaking the project on every
 * failure and, with `--keep`, never printing the path it was kept for.
 */
export class Failure extends Error {}
export const fail = (message) => {
  throw new Failure(message);
};
const printFailure = (error) =>
  process.stderr.write(
    `\n\x1b[31m${error instanceof Failure ? error.message : (error.stack ?? error)}\x1b[0m\n`
  );

// Failures before the project exists have nothing to clean up. Everything after it is
// caught in `verify`, where the cleanup can run first.
process.on('uncaughtException', (error) => {
  printFailure(error);
  process.exit(1);
});

export const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: 'inherit', ...options });

export const capture = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: 'utf8', ...options });

/** Every file under `dir` whose name satisfies `test`. */
export const findFiles = (dir, test) => {
  const found = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (test(entry.name)) {
        found.push(full);
      }
    }
  };
  walk(dir);
  return found;
};

export const edit = (file, change) => {
  const before = fs.readFileSync(file, 'utf8');
  const after = change(before);
  if (after === null || after === undefined) {
    fail(
      `Could not apply the change to ${file} — its shape was not recognised.`
    );
  }
  fs.writeFileSync(file, after);
};

// ---------------------------------------------------------------- preconditions

/**
 * Checked up front rather than minutes in, when the failure would come out of Gradle
 * and name a missing SDK directory instead of a missing environment variable.
 */
export function requireAndroid() {
  const androidHome = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!androidHome || !fs.existsSync(androidHome)) {
    fail(
      'ANDROID_HOME (or ANDROID_SDK_ROOT) is not set to an existing directory.\n' +
        'This builds an Android app; without an SDK there is nothing to build with.'
    );
  }
  try {
    capture('java', ['-version'], { stdio: 'pipe' });
  } catch {
    fail(
      'java not found. The MAM SDK requires JDK 17 — see the setup documentation.'
    );
  }
  return androidHome;
}

export function requireXcode() {
  if (process.platform !== 'darwin') {
    fail('The iOS build needs macOS and Xcode.');
  }
  for (const tool of ['xcodebuild', 'pod']) {
    try {
      capture('which', [tool], { stdio: 'pipe' });
    } catch {
      fail(`${tool} not found. The iOS build needs Xcode and CocoaPods.`);
    }
  }
}

// ---------------------------------------------------------------- the package

/**
 * Runs `fn` while holding a lock shared by every verification on this machine.
 *
 * `npm pack` runs `prepare`, and `bob build` cleans and rewrites this checkout's `lib/`.
 * Two runs side by side — the Expo and bare verifications, say — therefore race on the
 * same directory, and one of them fails with "Failed to build definition files" or,
 * worse, packs a half-written `lib/`. A directory is the lock because creating one is
 * atomic; one older than the longest pack is taken to be left by a killed run.
 */
function withPackLock(fn) {
  const lock = path.join(os.tmpdir(), 'react-native-intune-pack.lock');
  const stale = 10 * 60 * 1000;
  const sleep = (ms) =>
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  let waited = false;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > stale) {
          fs.rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (!waited) {
        note('another run is packing — waiting for it');
        waited = true;
      }
      sleep(1000);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * Packs the library and returns the tarball's path.
 *
 * `npm pack --json` is not used, and the reason is worth keeping: pack runs `prepare`,
 * `bob build` writes to stdout, and the build output lands in the middle of the JSON.
 * The filename is derivable, so derive it.
 */
export function packTarball(dir) {
  say('Packing the library');
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
  );
  // Into the run's own directory, not the shared temp root: two runs at once — the
  // Expo and bare verifications side by side — would otherwise overwrite each other's
  // tarball while the other is installing it. It is also cleaned up with the run.
  const destination = dir;
  const tarball = path.join(
    destination,
    `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`
  );
  withPackLock(() =>
    run('npm', ['pack', '--pack-destination', destination], { cwd: ROOT })
  );
  if (!fs.existsSync(tarball)) {
    fail(`npm pack did not produce ${tarball}`);
  }

  // The licence rule, enforced rather than trusted: the SDK binaries are Microsoft's,
  // and a tarball carrying them is a licensing problem rather than a packaging bug.
  const entries = capture('tar', ['-tzf', tarball]).split('\n').filter(Boolean);
  const vendored = entries.filter((f) => f.startsWith('package/vendor/'));
  if (vendored.length > 0) {
    fail(
      `The packed tarball contains ${vendored.length} vendor/ entries. SDK binaries ` +
        'must never be published.'
    );
  }
  note(`${path.basename(tarball)}, ${entries.length} entries`);
  return tarball;
}

/**
 * Installs the tarball into `app` and makes sure the SDKs landed under the installed
 * package rather than being resolved back to this checkout.
 */
export function installTarball(app, tarball, { ios = false } = {}) {
  say('Installing the packed tarball');
  run('npm', ['install', tarball], { cwd: app });

  const installed = path.join(app, 'node_modules/react-native-intune');
  const expected = [
    path.join(installed, 'vendor/android/Microsoft.Intune.MAM.SDK.aar'),
    ...(ios
      ? [path.join(installed, 'vendor/ios/IntuneMAMSwift.xcframework')]
      : []),
  ];
  if (expected.every((f) => fs.existsSync(f))) {
    return installed;
  }
  // postinstall runs fetch-sdks with --soft, which warns rather than failing. Here the
  // SDK is not optional: without it the build fails on a path that points at nothing.
  say('Fetching the SDKs explicitly');
  run('node', ['node_modules/react-native-intune/scripts/fetch-sdks.mjs'], {
    cwd: app,
  });
  const missing = expected.filter((f) => !fs.existsSync(f));
  if (missing.length > 0) {
    fail(`The SDK was not vendored. Missing:\n  ${missing.join('\n  ')}`);
  }
  return installed;
}

/**
 * The installed package's own modules — the transforms and the checks the consumer
 * would actually run — rather than this checkout's, which would test the wrong copy.
 */
export function installedModules(installed) {
  const require = createRequire(path.join(installed, 'package.json'));
  return {
    transforms: require('./plugin/transforms.js'),
    checks: () => import(path.join(installed, 'scripts/lib/checks.mjs')),
  };
}

// ---------------------------------------------------------------- the workspace

/**
 * A temporary directory and the cleanup for it. `verify` runs the body, reports any
 * failure first and cleans up after, so the error is the last thing on screen but the
 * project path is printed whenever --keep was asked for.
 */
export async function verify(prefix, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  let failed = false;
  try {
    await body(dir);
  } catch (error) {
    printFailure(error);
    failed = true;
  } finally {
    // Read now rather than at import: a script may imply --keep after this module has
    // loaded, as `verify:expo --device` does.
    if (process.argv.includes('--keep')) {
      process.stdout.write(`\nProject kept at ${dir}\n`);
    } else {
      if (failed) {
        process.stdout.write(
          '\nRe-run with --keep to inspect the generated project.\n'
        );
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  if (failed) {
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- android

/** The one Application class in an Android app module, and its package. */
export function applicationSource(app) {
  const sources = findFiles(path.join(app, 'android/app/src/main'), (name) =>
    /^MainApplication\.(kt|java)$/.test(name)
  );
  if (sources.length !== 1) {
    fail(`Expected exactly one MainApplication, found ${sources.length}`);
  }
  const file = sources[0];
  const source = fs.readFileSync(file, 'utf8');
  const packageName = source.match(/^package\s+([\w.]+)/m)?.[1];
  if (!packageName) {
    fail(`No package declaration in ${path.relative(app, file)}`);
  }
  return { file, source, packageName };
}

/** What the Application class must and must not say, before anything is compiled. */
export function checkApplicationSource(app) {
  say('Checking the Application class');
  const { file, source, packageName } = applicationSource(app);
  if (!/RNIntuneAuthCallback\s*\.\s*register/.test(source)) {
    fail(
      'The auth callback is not registered in MainApplication. Without it the SDK ' +
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
  note(path.relative(app, file));
  return packageName;
}

/**
 * A release build, run on every verification rather than only when asked. Debug builds
 * skip lintVital and minification, and a clean release was broken for every consumer
 * for three weeks while every debug build here was green.
 */
export function assembleRelease(app, androidHome) {
  say('Building :app:assembleRelease');
  run('./gradlew', [':app:assembleRelease', '--no-daemon'], {
    cwd: path.join(app, 'android'),
    env: { ...process.env, ANDROID_HOME: androidHome },
  });
  const apk = path.join(
    app,
    'android/app/build/outputs/apk/release/app-release.apk'
  );
  if (!fs.existsSync(apk)) {
    fail(
      `assembleRelease succeeded but produced no ${path.relative(app, apk)}`
    );
  }
  return apk;
}

export function assembleDebug(app, androidHome) {
  say('Building :app:assembleDebug');
  run('./gradlew', [':app:assembleDebug', '--no-daemon'], {
    cwd: path.join(app, 'android'),
    env: { ...process.env, ANDROID_HOME: androidHome },
  });
}

/**
 * A green build is not the claim. The claim is that the app is a MAMApplication at
 * runtime, and the plugin's own report is the only direct evidence of that — which is
 * exactly what the old doctor check was asserting from a comment instead.
 */
export function checkMamReport(app, packageName) {
  say('Checking that the MAM plugin rewrote the class');
  const logs = path.join(app, 'android/app/build/outputs/intune');
  if (!fs.existsSync(logs)) {
    fail(
      `The MAM plugin produced no report at ${path.relative(app, logs)}. It did not ` +
        'run, which means the app built cleanly and is not protected.'
    );
  }
  // The class's own per-class report, found by its fully qualified name. Any other
  // Application subclass the plugin happened to rewrite — in a dependency, say — says
  // nothing about whether this one was.
  const reportName = `${packageName}.MainApplication.html`;
  const [report] = findFiles(logs, (name) => name === reportName);
  if (!report) {
    fail(
      `The MAM plugin wrote no report for ${packageName}.MainApplication — it did not ` +
        'transform the class. The build succeeded, so this is the silent failure: ' +
        'linked SDK, no enforcement.'
    );
  }
  const text = fs.readFileSync(report, 'utf8').replace(/<[^>]+>/g, ' ');

  // The plugin's own sentence, not a co-occurrence of two class names in one file. A
  // loose match here would pass for the same reason the old doctor check passed.
  const changed =
    /Base class\s+android\.app\.Application\s+changed to\s+com\.microsoft\.intune\.mam\.client\.app\.MAMApplication/;
  if (!changed.test(text)) {
    fail(
      `${path.relative(app, report)} does not record the base class being changed ` +
        'to MAMApplication. The build succeeded, so the app is not protected.'
    );
  }
  // The callback is written into `onCreate` precisely because the plugin renames it.
  // If that rename stops happening, the callback is in a method nothing calls.
  if (!/onMAMCreate/.test(text)) {
    fail(
      `${path.relative(app, report)} shows no onMAMCreate. The callback is registered ` +
        'in onCreate on the assumption that the plugin renames it — it did not.'
    );
  }
  note(path.relative(app, report));
}
