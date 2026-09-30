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
 * Not part of `yarn test`. It needs the network, an Android SDK and several minutes:
 *
 *     yarn verify:expo [--keep] [--device]
 *
 * `--keep` leaves the generated project in place and prints its path, which is what you
 * want the moment anything fails.
 *
 * `--device` builds something to run against the tenant rather than only to compile:
 * the example app's own test screen and `tenant.json`, under the example's identifiers
 * — `intune.example`, which the Entra registration and the protection policies already
 * name — with iOS raised to 17.0 as the Expo page says. Android comes out as a release
 * APK with the JavaScript bundled in, so it runs without Metro; iOS is prebuilt and
 * left for signing, which needs a development team. Implies `--keep`.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  ROOT,
  assembleDebug,
  assembleRelease,
  fail,
  checkApplicationSource,
  checkMamReport,
  installTarball,
  installedModules,
  note,
  packTarball,
  requireAndroid,
  run,
  say,
  verify,
} from './common.mjs';

/**
 * Pinned, and bumped deliberately. With `@latest` the Expo SDK and the generated
 * MainApplication template change underneath the script, so a run would start failing
 * — or passing — for reasons unrelated to the change under test, and "verified" would
 * stop meaning a particular thing.
 */
const EXPO_SDK = 57;
const CREATE_EXPO_APP = '5.0.0';

/**
 * The hash of the debug keystore React Native's template ships. It is only read at
 * sign-in, never during a build, so for the build it only has to be well-formed. Whether
 * Expo's generated keystore actually has this hash is checked below, because a device
 * run against the tenant depends on it.
 */
const SIGNATURE_HASH = 'Xo8WBi6jzSxKDVR4drqm84yr9iU=';

const DEVICE = process.argv.includes('--device');
if (DEVICE && !process.argv.includes('--keep')) {
  process.argv.push('--keep');
}

const androidHome = requireAndroid();

await verify('rni-expo-', async (dir) => {
  const tarball = packTarball(dir);
  const app = path.join(dir, 'app');

  say(`Creating a blank Expo SDK ${EXPO_SDK} app`);
  run(
    'npx',
    [
      '--yes',
      `create-expo-app@${CREATE_EXPO_APP}`,
      app,
      '--template',
      `blank@sdk-${EXPO_SDK}`,
    ],
    { cwd: dir }
  );

  const installed = installTarball(app, tarball, { ios: DEVICE });

  say('Adding the config plugin');
  const configFile = path.join(app, 'app.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  config.expo.plugins = [
    ...(config.expo.plugins ?? []),
    ['react-native-intune', { androidSignatureHash: SIGNATURE_HASH }],
  ];

  if (DEVICE) {
    // The identifiers the tenant already knows. The Entra registration's redirect URIs
    // and the protection policies' custom-app entries all name intune.example, so the
    // app has to be it; any other identifier is an app the tenant has never heard of.
    // On a phone that already has the bare example installed, this replaces it.
    config.expo.android = { ...config.expo.android, package: 'intune.example' };
    config.expo.ios = {
      ...config.expo.ios,
      bundleIdentifier: 'intune.example',
    };
    config.expo.plugins.unshift([
      'expo-build-properties',
      { ios: { deploymentTarget: '17.0' } },
    ]);
    fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
    run('npx', ['expo', 'install', 'expo-build-properties'], { cwd: app });

    say('Using the example app\u2019s test screen and tenant');
    const tenant = path.join(ROOT, 'example/tenant.json');
    if (!fs.existsSync(tenant)) {
      fail(
        'example/tenant.json does not exist. It names the tenant to test against — see ' +
          'the test-tenant page, and `yarn workspace react-native-intune-example ensure-tenant`.'
      );
    }
    // The screen imports '../tenant.json', so it goes one directory down.
    fs.mkdirSync(path.join(app, 'src'));
    fs.copyFileSync(
      path.join(ROOT, 'example/src/App.tsx'),
      path.join(app, 'src/App.tsx')
    );
    fs.copyFileSync(tenant, path.join(app, 'tenant.json'));
    fs.writeFileSync(
      path.join(app, 'App.js'),
      "export { default } from './src/App';\n"
    );
  } else {
    fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  }

  say('Running expo prebuild');
  run(
    'npx',
    ['expo', 'prebuild', '--platform', DEVICE ? 'all' : 'android', '--clean'],
    { cwd: app }
  );

  const packageName = checkApplicationSource(app);

  // Not a failure for the build, which never reads the hash. It decides a device run:
  // the app is signed with this key, and the redirect URI registered in Entra has to
  // carry its hash.
  const { signatureHash } = await installedModules(installed).checks();
  const hash = signatureHash({
    android: { debugKeystore: path.join(app, 'android/app/debug.keystore') },
  });
  note(
    hash === SIGNATURE_HASH
      ? `debug keystore hash ${hash} — the same key the example app is registered with`
      : `debug keystore hash ${hash ?? '(unreadable)'} — NOT ${SIGNATURE_HASH}. A device ` +
          'run needs androidSignatureHash set to it, and that redirect URI registered.'
  );

  assembleDebug(app, androidHome);
  checkMamReport(app, packageName);

  // Signed with the debug key — the template's release config does — which is the key
  // whose hash the registration carries. Bundled, so it runs without Metro.
  const apk = assembleRelease(app, androidHome);
  if (DEVICE) {
    process.stdout.write(
      '\nReady for a device:\n' +
        `  Android  adb install -r ${apk}\n` +
        `  iOS      open ${path.join(app, 'ios')}/*.xcworkspace, choose a development ` +
        'team under Signing & Capabilities, and run it on the phone\n'
    );
  }

  process.stdout.write(
    '\n\x1b[32mOK\x1b[0m — prebuild, compile, and the superclass rewrite all verified.\n' +
      'Not covered: enrollment. That needs a tenant and a device.\n'
  );
});
