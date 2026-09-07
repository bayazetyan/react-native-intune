/**
 * Expo config plugin.
 *
 * Why automation is right here and wrong everywhere else in this package: config
 * plugins run during `expo prebuild`, against files prebuild has just **generated**.
 * There is no developer edit to fight, no git history to churn, and nothing to
 * re-apply on the next version bump — the whole reason `setup` refuses to run from
 * postinstall (SPEC §12.7) simply does not apply.
 *
 * So Expo users get nearly the entire integration checklist automatically, including
 * the Application subclass, which on bare React Native `doctor` can only report because
 * the file belongs to the developer.
 *
 * Usage, in app.json / app.config.js:
 *
 *   {
 *     "plugins": [
 *       ["react-native-intune", { "androidSignatureHash": "Xo8W...yr9iU=" }]
 *     ]
 *   }
 *
 * Two props. `maxFileProtectionLevel` writes the plist-only `MaxFileProtectionLevel`
 * key, which matters for any app that reads its own files while the screen is locked —
 * the SDK's default makes them unreadable about ten seconds after the device locks.
 *
 * The one that cannot be omitted is `androidSignatureHash`. It cannot be derived: an EAS
 * build is signed with a keystore Expo manages, so the value comes from
 * `eas credentials` and only the project owner can read it. Without it the Android
 * redirect activity is skipped and a warning says so, rather than a plausible-looking
 * activity being written with the wrong hash — which fails at the first sign-in with an
 * error naming neither key.
 */

const {
  AndroidConfig,
  WarningAggregator,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withEntitlementsPlist,
  withInfoPlist,
  withMainApplication,
  withProjectBuildGradle,
} = require('@expo/config-plugins');

const {
  MARKER,
  withMamApplication,
  withMamClasspath,
  withMamPluginApplied,
} = require('./transforms');

const pkg = require('../package.json');

const BROKER_PACKAGES = [
  'com.microsoft.windowsintune.companyportal',
  'com.azure.authenticator',
  'com.microsoft.workaccount',
];

const QUERY_SCHEMES = ['msauthv2', 'msauthv3', 'companyportal'];

/**
 * `MaxFileProtectionLevel` is plist-only — the SDK reads it at launch and there is no
 * runtime setter, which is why `configure()` rejects the option when the plist disagrees
 * instead of ignoring it. Prebuild generates the plist, so this is exactly the kind of
 * key a config plugin should be writing.
 *
 * Keys are the `FileProtectionLevel` values from the public API; values are what the SDK
 * expects to read.
 */
const FILE_PROTECTION = {
  complete: 'NSFileProtectionComplete',
  completeUnlessOpen: 'NSFileProtectionCompleteUnlessOpen',
  completeUntilFirstUserAuthentication:
    'NSFileProtectionCompleteUntilFirstUserAuthentication',
  none: 'NSFileProtectionNone',
};

const DEFAULT_MSAL_GROUP = 'com.microsoft.adalcache';

/**
 * In this order, and the order is a requirement rather than a preference: without an
 * explicit access group iOS writes to the *first* group in the entitlements, so a
 * Microsoft group in that position would receive keychain items the app writes.
 *
 * `$(PRODUCT_BUNDLE_IDENTIFIER)` rather than a literal, because prebuild is where the
 * bundle id is decided and it can differ per build profile.
 */
const keychainGroups = (msalGroup) => [
  '$(AppIdentifierPrefix)$(PRODUCT_BUNDLE_IDENTIFIER)',
  '$(AppIdentifierPrefix)com.microsoft.intune.mam',
  `$(AppIdentifierPrefix)${msalGroup}`,
];

// ---------------------------------------------------------------- ios

const withKeychainGroups = (config, { keychainGroup }) =>
  withEntitlementsPlist(config, (c) => {
    const wanted = keychainGroups(keychainGroup);
    const existing = c.modResults['keychain-access-groups'] ?? [];
    const others = existing.filter((g) => !wanted.includes(g));
    c.modResults['keychain-access-groups'] = [...wanted, ...others];
    return c;
  });

const withMsalUrlScheme = (config, { maxFileProtectionLevel, keychainGroup }) =>
  withInfoPlist(config, (c) => {
    const scheme = 'msauth.$(PRODUCT_BUNDLE_IDENTIFIER)';
    const types = c.modResults.CFBundleURLTypes ?? [];
    const already = types.some((t) =>
      (t.CFBundleURLSchemes ?? []).includes(scheme)
    );
    if (!already) {
      types.push({ CFBundleURLSchemes: [scheme] });
    }
    c.modResults.CFBundleURLTypes = types;

    const queries = c.modResults.LSApplicationQueriesSchemes ?? [];
    for (const s of QUERY_SCHEMES) {
      if (!queries.includes(s)) {
        queries.push(s);
      }
    }
    c.modResults.LSApplicationQueriesSchemes = queries;

    // Identity is configured at runtime, and a plist key alongside a runtime override is
    // a known cause of enrollment failures whose error names the authority rather than
    // the conflict. `configure()` refuses to start when it finds one, so leaving these
    // in place would produce a prebuild that cannot run.
    //
    // ADALCacheKeychainGroupOverride is deliberately NOT removed: it has no runtime
    // equivalent and is the only way to set the keychain group (SPEC §5.1.4).
    const settings = c.modResults.IntuneMAMSettings;
    if (settings && typeof settings === 'object') {
      for (const key of ['ADALClientId', 'ADALAuthority', 'ADALRedirectUri']) {
        delete settings[key];
      }
    }

    // `configure({ keychainGroupOverride })` has no runtime equivalent for the SDK's own
    // side of it: `ADALCacheKeychainGroupOverride` is read from the plist at launch, and
    // `configure()` refuses the option when the two disagree. Prebuild regenerates the
    // plist, so without this an Expo app could not use a custom group at all — it would
    // fail with E_PLIST_CONFLICT and there would be nowhere to fix it.
    if (keychainGroup !== DEFAULT_MSAL_GROUP) {
      c.modResults.IntuneMAMSettings = {
        ...(c.modResults.IntuneMAMSettings ?? {}),
        ADALCacheKeychainGroupOverride: keychainGroup,
      };
    }

    if (maxFileProtectionLevel) {
      const value = FILE_PROTECTION[maxFileProtectionLevel];
      if (!value) {
        WarningAggregator.addWarningIOS(
          MARKER,
          `maxFileProtectionLevel "${maxFileProtectionLevel}" is not one of ` +
            `${Object.keys(FILE_PROTECTION).join(', ')}, so MaxFileProtectionLevel was ` +
            'not written. configure() will reject the option rather than ignore it.'
        );
      } else {
        c.modResults.IntuneMAMSettings = {
          ...(settings ?? {}),
          MaxFileProtectionLevel: value,
        };
      }
    }
    return c;
  });

// ---------------------------------------------------------------- android

const withBrokerQueries = (config) =>
  withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    manifest.queries = manifest.queries ?? [{}];
    const block = manifest.queries[0];
    block.package = block.package ?? [];
    for (const name of BROKER_PACKAGES) {
      const present = block.package.some((p) => p.$?.['android:name'] === name);
      if (!present) {
        block.package.push({ $: { 'android:name': name } });
      }
    }
    return c;
  });

const withRedirectActivity = (config, { androidSignatureHash }) =>
  withAndroidManifest(config, (c) => {
    if (!androidSignatureHash) {
      WarningAggregator.addWarningAndroid(
        MARKER,
        'androidSignatureHash was not provided, so the MSAL redirect activity was not ' +
          'added and sign-in will fail. Read it from `eas credentials` (or your own ' +
          'keystore) and pass it as a plugin prop.'
      );
      return c;
    }

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.activity = app.activity ?? [];
    const name = 'com.microsoft.identity.client.BrowserTabActivity';
    if (app.activity.some((a) => a.$?.['android:name'] === name)) {
      return c;
    }

    const packageName =
      AndroidConfig.Package.getPackage(c) ?? c.android?.package;

    app.activity.push({
      '$': { 'android:name': name, 'android:exported': 'true' },
      'intent-filter': [
        {
          action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
          category: [
            { $: { 'android:name': 'android.intent.category.DEFAULT' } },
            { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
          ],
          data: [
            {
              $: {
                'android:scheme': 'msauth',
                'android:host': packageName,
                // The DECODED hash — "/" and "=" literal. The redirect URI registered in
                // Entra percent-encodes them as %2F and %3D. Same value, two spellings,
                // in two places that must agree.
                'android:path': `/${decodeURIComponent(androidSignatureHash)}`,
              },
            },
          ],
        },
      ],
    });
    return c;
  });

const withGradle = (config) => {
  let next = withAppBuildGradle(config, (c) => {
    if (c.modResults.language !== 'groovy') {
      WarningAggregator.addWarningAndroid(
        MARKER,
        'android/app/build.gradle is Kotlin DSL, which this plugin does not edit. Apply ' +
          'the MAM plugin by hand — see `npx react-native-intune doctor`.'
      );
      return c;
    }
    c.modResults.contents = withMamPluginApplied(c.modResults.contents);
    return c;
  });

  next = withProjectBuildGradle(next, (c) => {
    if (c.modResults.language !== 'groovy') {
      WarningAggregator.addWarningAndroid(
        MARKER,
        'android/build.gradle is Kotlin DSL, which this plugin does not edit. Add the ' +
          'MAM plugin classpath by hand — see `npx react-native-intune doctor`.'
      );
      return c;
    }
    const result = withMamClasspath(c.modResults.contents);
    if (result === null) {
      WarningAggregator.addWarningAndroid(
        MARKER,
        'Could not find a buildscript { dependencies { } } block in ' +
          'android/build.gradle, so the MAM plugin classpath was not added.'
      );
      return c;
    }
    c.modResults.contents = result;
    return c;
  });

  return next;
};

const withMamApplicationClass = (config) =>
  withMainApplication(config, (c) => {
    const result = withMamApplication(
      c.modResults.contents,
      c.modResults.language
    );
    if (result === null) {
      // Said loudly, because this is one of the omissions that builds and runs while
      // leaving the app unprotected. A quiet skip here is the worst outcome available.
      WarningAggregator.addWarningAndroid(
        MARKER,
        'Could not make MainApplication extend MAMApplication — its shape was not ' +
          'recognised. THE APP WILL BUILD AND RUN WITHOUT PROTECTION until this is ' +
          'done by hand. Run `npx react-native-intune doctor` for the exact change.'
      );
      return c;
    }
    c.modResults.contents = result;
    return c;
  });

// ---------------------------------------------------------------- entry

const withIntune = (config, props = {}) => {
  const androidSignatureHash = props.androidSignatureHash ?? null;
  const maxFileProtectionLevel = props.maxFileProtectionLevel ?? null;
  const keychainGroup = props.keychainGroup ?? DEFAULT_MSAL_GROUP;

  let next = config;
  next = withKeychainGroups(next, { keychainGroup });
  next = withMsalUrlScheme(next, { maxFileProtectionLevel, keychainGroup });
  next = withBrokerQueries(next);
  next = withRedirectActivity(next, { androidSignatureHash });
  next = withGradle(next);
  next = withMamApplicationClass(next);
  return next;
};

/**
 * Run-once, so listing the plugin twice — easy to do when a config is assembled from
 * shared fragments — does not apply everything twice. The transforms are idempotent
 * anyway; this makes the intent explicit rather than relying on that.
 */
module.exports = createRunOncePlugin(withIntune, pkg.name, pkg.version);
