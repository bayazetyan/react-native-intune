/**
 * One list of checks, two front-ends.
 *
 * `doctor` reports them and changes nothing; `setup` applies the ones that carry an
 * `apply`. Keeping them in one place is what stops the two commands from disagreeing —
 * a `doctor` that passes while `setup` still wants to change something is worse than
 * either alone.
 *
 * Severity is the risk model from SPEC §12.7, not a politeness scale:
 *
 * - `silent`  — omitting it builds, runs, and looks correct while leaving the app
 *               unprotected. For software a customer bought for security reasons this is
 *               the worst outcome, because everyone believes protection is in place.
 * - `loud`    — the build breaks, or the first sign-in fails. Costs an hour, not a
 *               breach. Most of these were found on real devices, and what makes them
 *               expensive is that the error names the wrong cause.
 * - `advisory` — worth knowing, not blocking.
 *
 * `state` is one of: `ok`, `missing`, `wrong`, `unknown`, `skip`. `unknown` is used
 * deliberately rather than guessed — a check that cannot see what it needs says so,
 * because a green result it did not earn is the one outcome this tool must never
 * produce.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { read, rel } from './project.mjs';

const MARKER = 'react-native-intune: managed block';

export const BROKER_PACKAGES = [
  'com.microsoft.windowsintune.companyportal',
  'com.azure.authenticator',
  'com.microsoft.workaccount',
];

export const MSAL_QUERY_SCHEMES = ['msauthv2', 'msauthv3'];

/**
 * The two groups whose names are fixed. The app's own group is the third requirement and
 * is checked separately, because its name is the app's and may be written either as
 * `$(PRODUCT_BUNDLE_IDENTIFIER)` or as the literal bundle id — both are valid, and
 * demanding one spelling reports a correctly configured project as broken.
 */
export const KEYCHAIN_GROUPS = [
  '$(AppIdentifierPrefix)com.microsoft.intune.mam',
  '$(AppIdentifierPrefix)com.microsoft.adalcache',
];

// ---------------------------------------------------------------- android

/**
 * Source text with `//` and block comments removed, for Gradle, Kotlin and Java alike.
 *
 * Every check that reads source for a declaration goes through this, because matching
 * text that includes comments is how `android-mam-application` reported this
 * repository's own example as passing for as long as it existed (issue #5). A `//` is
 * only a comment after whitespace or at the start of a line, so `https://` in a
 * repository URL survives.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/**
 * An actual application of the plugin: `apply plugin: "…"`, `id "…"` or `id("…")`. The
 * closing quote is required, so the `com.microsoft.intune.mam.build` classpath entry in
 * the root build file does not count.
 */
const MAM_PLUGIN_APPLIED =
  /(?:apply\s+plugin\s*:\s*|\bid\s*\(?\s*)['"]com\.microsoft\.intune\.mam['"]/;

/**
 * Whether the MAM Gradle plugin is applied to the app module. Shared by the plugin check
 * and the Application check, which both depend on the answer and must never disagree
 * about it.
 */
function mamPluginApplied(project) {
  const a = project.android;
  if (a.appBuildGradleKts && !a.appBuildGradle) {
    return {
      state: 'unknown',
      detail:
        'app/build.gradle.kts — the Kotlin DSL is not inspected. Check by hand that ' +
        'the plugin is applied.',
    };
  }
  const src = read(a.appBuildGradle);
  if (!src) {
    return { state: 'unknown', detail: 'android/app/build.gradle not found' };
  }
  return MAM_PLUGIN_APPLIED.test(stripComments(src))
    ? { state: 'ok' }
    : { state: 'missing' };
}

const androidChecks = [
  {
    id: 'android-mam-plugin',
    platform: 'android',
    title: 'MAM Gradle plugin applied to the app module',
    severity: 'silent',
    inspect: mamPluginApplied,
    why:
      'The plugin rewrites bytecode across the app and every dependency. Applied to ' +
      'the library instead of the app module it rewrites only the library, builds ' +
      'cleanly, and protects nothing.',
    instruction: () =>
      `In android/app/build.gradle, after the other plugins:

    apply plugin: "com.microsoft.intune.mam"

    intunemam {
        report = true       // an HTML report of every replacement
        verify = true       // catches plugin-induced runtime failures
        incremental = true  // the default is false
    }`,
  },

  {
    id: 'android-mam-plugin-classpath',
    platform: 'android',
    title: 'MAM Gradle plugin on the buildscript classpath',
    severity: 'loud',
    inspect(project) {
      const src = read(project.android.rootBuildGradle);
      if (!src) {
        return { state: 'unknown', detail: 'android/build.gradle not found' };
      }
      return /com\.microsoft\.intune\.mam\.build/.test(src)
        ? { state: 'ok' }
        : { state: 'missing' };
    },
    why: 'Without it the plugin id cannot resolve and the build fails immediately.',
    instruction: () =>
      `In android/build.gradle, inside buildscript { dependencies { } }:

    classpath files("$rootDir/../node_modules/react-native-intune/vendor/android/GradlePlugin/com.microsoft.intune.mam.build.jar")

  And javassist, whose version must match the SDK exactly:

    classpath "org.javassist:javassist:3.29.2-GA"`,
  },

  {
    id: 'android-broker-queries',
    platform: 'android',
    title: '<queries> for the broker apps',
    severity: 'loud',
    inspect(project) {
      const src = read(project.android.manifest);
      if (!src) {
        return { state: 'unknown', detail: 'AndroidManifest.xml not found' };
      }
      const missing = BROKER_PACKAGES.filter((p) => !src.includes(p));
      if (missing.length === 0) {
        return { state: 'ok' };
      }
      return {
        state: src.includes('<queries>') ? 'wrong' : 'missing',
        detail: `missing: ${missing.join(', ')}`,
      };
    },
    why:
      'Mandatory on Android 11+. Without it an installed broker is invisible to the ' +
      'app, so MSAL silently falls back to a browser and brokered auth "just does not ' +
      'work" with no error.',
    instruction: () =>
      `In android/app/src/main/AndroidManifest.xml, as a direct child of <manifest>:

    <queries>
${BROKER_PACKAGES.map((p) => `        <package android:name="${p}" />`).join('\n')}
    </queries>`,
    apply(project) {
      const file = project.android.manifest;
      const src = read(file);
      if (!src) {
        return null;
      }
      const block = `    <!-- ${MARKER} -->
    <queries>
${BROKER_PACKAGES.map((p) => `        <package android:name="${p}" />`).join('\n')}
    </queries>
`;
      let next;
      if (src.includes('<queries>')) {
        // Merge into the existing block rather than adding a second one — two <queries>
        // elements are legal but make the next reader wonder which one wins.
        next = src.replace(
          /<queries>/,
          `<queries>\n${BROKER_PACKAGES.filter((p) => !src.includes(p))
            .map((p) => `        <package android:name="${p}" />`)
            .join('\n')}`
        );
      } else {
        next = src.replace(/(<manifest[^>]*>\n)/, `$1\n${block}`);
      }
      return next === src ? null : { file, contents: next };
    },
  },

  {
    id: 'android-mam-application',
    platform: 'android',
    title: 'Application class is transformed into a MAMApplication',
    severity: 'silent',
    /**
     * What makes the app a MAMApplication is the Gradle plugin's bytecode rewrite, not
     * the text of the source file — so this reads both, and a plain `Application`
     * subclass with the plugin applied is the correct, expected shape.
     *
     * The previous version matched the substring `MAMApplication` anywhere in the
     * source. It reported this repository's own example as passing because the word
     * appears in a *comment* there, which is why nobody noticed it was asserting the
     * wrong thing entirely. Issue #5.
     */
    inspect(project) {
      const sources = project.android.applicationSources;
      if (sources.length === 0) {
        return {
          state: 'missing',
          detail: 'no Application subclass found in android/app/src/main',
        };
      }

      // A class declaration, never a mention: comments are stripped first, so neither
      // an explanatory comment nor a commented-out example counts.
      const declared = /class\s+\w+\s*(?::\s*|\s+extends\s+)MAMApplication\b/;
      const explicit = sources.find((f) => declared.test(stripComments(read(f))));
      const a = project.android;

      if (explicit) {
        // Legitimate only when the app module has the SDK on its own compile classpath.
        // This package declares the AAR as `implementation`, which is not transitive,
        // so without that the supertype does not resolve — exactly the shape a 0.1.0
        // Expo prebuild wrote, which must not read as protected (issue #5).
        if (a.appBuildGradleKts && !a.appBuildGradle) {
          return {
            state: 'unknown',
            detail:
              `${rel(project, explicit)} extends MAMApplication directly, and the ` +
              'Kotlin DSL build file is not inspected — check by hand that the MAM SDK ' +
              'is on the app module\u2019s classpath, or this does not compile.',
          };
        }
        const gradle = stripComments(read(a.appBuildGradle));
        if (/Microsoft\.Intune\.MAM\.SDK/.test(gradle)) {
          return {
            state: 'ok',
            detail: `${rel(project, explicit)} extends MAMApplication directly`,
          };
        }
        return {
          state: 'wrong',
          detail:
            `${rel(project, explicit)} extends MAMApplication in source, but the MAM ` +
            'SDK is not on the app module\u2019s classpath, so it does not compile. If ' +
            'expo prebuild wrote it, re-run prebuild with this version.',
        };
      }

      const plugin = mamPluginApplied(project);
      if (plugin.state === 'unknown') {
        return {
          state: 'unknown',
          detail: `whether the plugin transforms the class cannot be read: ${plugin.detail}`,
        };
      }
      if (plugin.state === 'ok') {
        return {
          state: 'ok',
          detail: `${rel(project, sources[0])} — superclass rewritten by the Gradle plugin`,
        };
      }
      return {
        state: 'wrong',
        detail:
          `found ${sources.map((f) => rel(project, f)).join(', ')}, and the MAM ` +
          'Gradle plugin is not applied to the app module — so nothing rewrites it',
      };
    },
    why:
      'One of the three omissions that build and run while protecting nothing. The ' +
      'Gradle plugin transforms an Application subclass into a MAMApplication; with ' +
      'none to transform, or with the plugin not applied, the SDK is present and inert.',
    instruction: () =>
      `Keep your Application class extending android.app.Application — the MAM Gradle
  plugin rewrites the superclass at build time, and writing MAMApplication in source
  does not compile unless you put the SDK on your app module's classpath yourself.

  Apply the plugin (see the "MAM Gradle plugin applied to the app module" check), and
  register the auth callback from onCreate, which the plugin rewrites into onMAMCreate:

    class MainApplication : Application(), ReactApplication {
      override fun onCreate() {
        super.onCreate()
        RNIntuneAuthCallback.register(this)
        // ... the rest of your existing onCreate body
      }
    }

  This is a change to your own source, so setup reports it rather than editing it.`,
  },

  {
    id: 'android-auth-callback',
    platform: 'android',
    title: 'MAM auth callback registered',
    severity: 'silent',
    inspect(project) {
      const sources = project.android.applicationSources;
      if (sources.length === 0) {
        return { state: 'missing', detail: 'no Application subclass found' };
      }
      return sources.some((f) =>
        /RNIntuneAuthCallback\s*\.\s*register/.test(stripComments(read(f)))
      )
        ? { state: 'ok' }
        : { state: 'missing' };
    },
    why:
      'The SDK asks for a MAM service token on its own schedule, before any JS exists. ' +
      'Without the callback registered, enrollment reports AUTHORIZATION_NEEDED with ' +
      'APP_DID_NOT_PROVIDE_TOKEN — which reads like a licensing problem, and retries ' +
      'on a backoff so it never gets louder.',
    instruction: () =>
      `In your Application's onMAMCreate, after super:

    RNIntuneAuthCallback.register(this)

  Code inside your own class, so setup reports it rather than editing it.`,
  },

  {
    id: 'android-browser-tab-activity',
    platform: 'android',
    title: 'BrowserTabActivity for the MSAL redirect',
    severity: 'loud',
    inspect(project) {
      const src = read(project.android.manifest);
      if (!src) {
        return { state: 'unknown', detail: 'AndroidManifest.xml not found' };
      }
      return /BrowserTabActivity/.test(src) ? { state: 'ok' } : { state: 'missing' };
    },
    why:
      'MSAL needs it to receive the sign-in redirect. Absent, sign-in loops back to ' +
      'the login screen with nothing in the logs naming the cause.',
    instruction(project) {
      const hash = signatureHash(project);
      const shown = hash ?? '<your signature hash>';
      return `In AndroidManifest.xml, inside <application>:

    <activity
      android:name="com.microsoft.identity.client.BrowserTabActivity"
      android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data
          android:scheme="msauth"
          android:host="<your.package.name>"
          android:path="/${shown}" />
      </intent-filter>
    </activity>

  Two details that each cost a build cycle:

  - android:path takes the DECODED hash — "/" and "=" literal — while the redirect URI
    registered in Entra percent-encodes them as %2F and %3D. Same value, written two
    ways, in two places that must agree.
  - The hash must be of the key that ACTUALLY signs the build.${
    hash
      ? `\n\n  Computed from android/app/debug.keystore just now: ${hash}`
      : `\n\n  Could not compute it here — keytool or openssl is unavailable. Derive it with:

    keytool -exportcert -alias androiddebugkey \\
      -keystore android/app/debug.keystore -storepass android \\
      | openssl sha1 -binary | openssl base64`
  }`;
    },
  },

  {
    id: 'android-toolchain',
    platform: 'android',
    title: 'App toolchain on the MAM compatibility matrix row',
    /**
     * Advisory, and deliberately so. Mixing matrix rows is *untested* by Microsoft, not
     * known-broken — plenty of combinations work. But when one does not, the failure lands
     * inside javassist's bytecode rewriting and names a class in the app rather than a
     * version anywhere, so knowing the row was mixed is worth the twenty lines it takes
     * to say it.
     *
     * This is what the open question about the host app's toolchain reduces to for a
     * library: there is no single host app to inspect, so the row is published and every
     * consumer is measured against it.
     */
    severity: 'advisory',
    inspect(project) {
      const root = read(project.android.rootBuildGradle);
      const kts = read(project.android.rootBuildGradleKts);
      const src = root || kts;
      if (!src) {
        return { state: 'unknown', detail: 'android/build.gradle not found' };
      }

      if (Object.keys(REQUIRED_TOOLCHAIN).length === 0) {
        return {
          state: 'unknown',
          detail: "this library's own sdk-versions.json could not be read",
        };
      }

      const found = {
        agp: firstMatch(src, /com\.android\.tools\.build:gradle:([\d.]+)/),
        kotlin: firstMatch(src, /kotlin(?:-gradle-plugin|\("jvm"\))?[:"' ]+version[:"' ]+([\d.]+)/i) ||
          firstMatch(src, /kotlin-gradle-plugin:([\d.]+)/) ||
          firstMatch(src, /kotlinVersion["' ]*[:=]["' ]*([\d.]+)/),
        gradle: gradleWrapperVersion(project),
      };

      const mismatched = Object.entries(REQUIRED_TOOLCHAIN)
        .filter(([k]) => found[k])
        .filter(([k, want]) => found[k] !== want)
        .map(([k, want]) => `${k} ${found[k]} vs ${want}`);

      const unseen = Object.keys(REQUIRED_TOOLCHAIN).filter((k) => !found[k]);

      if (mismatched.length > 0) {
        return { state: 'wrong', detail: mismatched.join(', ') };
      }
      if (unseen.length === Object.keys(REQUIRED_TOOLCHAIN).length) {
        return {
          state: 'unknown',
          detail: 'could not read any version from the build files',
        };
      }
      return {
        state: 'ok',
        detail: unseen.length > 0 ? `${unseen.join(', ')} not read` : undefined,
      };
    },
    why:
      'Microsoft tests specific combinations of Gradle, AGP and Kotlin against each MAM ' +
      'SDK release. A mixed row is untested rather than broken — but the MAM plugin ' +
      'rewrites bytecode in your app module, so when a mixed row does fail it fails ' +
      'inside javassist and the error names one of your classes, never a version.',
    instruction: () =>
      `The row this library is pinned to:

    Gradle  ${REQUIRED_TOOLCHAIN.gradle}
    AGP     ${REQUIRED_TOOLCHAIN.agp}
    Kotlin  ${REQUIRED_TOOLCHAIN.kotlin}
    Java    17

Matching it exactly is the tested path. If your app cannot move, the alternative is
pinning an older MAM SDK whose row you do match — see sdk-versions.json.`,
  },
];

// ---------------------------------------------------------------- ios

/**
 * The lowest iOS the vendored MAM SDK runs on. Read from the binary (`otool -l` on
 * IntuneMAMSwift.framework in the 21.8.0 drop reports `minos 17.0`), not from
 * Microsoft's release notes — the SDK should move this, not a guess.
 */
const MIN_IOS = [17, 0];

const versionAtLeast = (value, [major, minor]) => {
  const [a = 0, b = 0] = String(value).split('.').map(Number);
  return a > major || (a === major && b >= minor);
};

/** Ruby comments — whole-line or trailing — so a commented-out platform line is ignored. */
const stripRubyComments = (src) => src.replace(/(^|\s)#.*$/gm, '$1');

const iosChecks = [
  {
    id: 'ios-deployment-target',
    platform: 'ios',
    title: `Deployment target is iOS ${MIN_IOS.join('.')} or later`,
    severity: 'loud',
    /**
     * React Native's template targets `min_ios_version_supported` — 15.1 — and the SDK
     * is built for 17.0, so a new project fails at `pod install` before anything else
     * here can be tried. The Podfile and the Xcode target are read separately because
     * they disagree independently: a raised Podfile with a 15.1 app target installs the
     * pod and builds, then crashes at launch on any iOS 16 device it was allowed onto.
     */
    inspect(project) {
      const podfile = stripRubyComments(read(project.ios.podfile));
      if (!podfile) {
        return { state: 'unknown', detail: 'ios/Podfile not found' };
      }
      const line = podfile.match(/^\s*platform\s+:ios\s*,\s*(.+)$/m)?.[1]?.trim();
      if (!line) {
        return { state: 'unknown', detail: 'no `platform :ios` line in the Podfile' };
      }

      let target = line.match(/^['"]([\d.]+)['"]$/)?.[1];
      let source = 'Podfile';
      if (!target && /ios\.deploymentTarget/.test(line)) {
        // Expo's generated Podfile reads Podfile.properties.json first, which is what
        // expo-build-properties writes, and falls back to the template minimum.
        const props = path.join(path.dirname(project.ios.podfile), 'Podfile.properties.json');
        try {
          target = JSON.parse(read(props) || '{}')['ios.deploymentTarget'];
          source = 'Podfile.properties.json';
        } catch {
          return { state: 'unknown', detail: 'Podfile.properties.json is not valid JSON' };
        }
        if (!target) {
          return {
            state: 'wrong',
            detail:
              'ios.deploymentTarget is not set, so the Podfile falls back to ' +
              'min_ios_version_supported',
          };
        }
      }
      if (!target) {
        return /min_ios_version_supported/.test(line)
          ? {
              state: 'wrong',
              detail: 'the Podfile uses min_ios_version_supported, which is below 17.0',
            }
          : { state: 'unknown', detail: `cannot read a version from: ${line}` };
      }
      if (!versionAtLeast(target, MIN_IOS)) {
        return { state: 'wrong', detail: `${source} targets ${target}` };
      }

      const pbxproj = read(project.ios.pbxproj);
      const low = [
        ...new Set(
          [...pbxproj.matchAll(/IPHONEOS_DEPLOYMENT_TARGET\s*=\s*"?([\d.]+)"?;/g)]
            .map((m) => m[1])
            .filter((v) => !versionAtLeast(v, MIN_IOS))
        ),
      ];
      if (low.length > 0) {
        return {
          state: 'wrong',
          detail: `${source} targets ${target}, but the Xcode project still has ${low.join(', ')}`,
        };
      }
      return { state: 'ok', detail: `${source}: ${target}` };
    },
    why:
      'MAM SDK 21.x is built for iOS 17.0. Below it CocoaPods refuses the pod; with only ' +
      'the Podfile raised, the app builds and then crashes at launch on older devices it ' +
      'still claims to support.',
    instruction: () =>
      `In ios/Podfile:

    platform :ios, '17.0'

  and set Minimum Deployments to 17.0 on your app target in Xcode
  (IPHONEOS_DEPLOYMENT_TARGET), then run pod install again.

  Expo: set it with expo-build-properties — { "ios": { "deploymentTarget": "17.0" } }.`,
  },

  {
    id: 'ios-keychain-groups',
    platform: 'ios',
    title: 'Keychain sharing groups, in order',
    severity: 'loud',
    inspect(project) {
      const file = project.ios.entitlements;
      if (!file) {
        return { state: 'missing', detail: 'no .entitlements file found' };
      }
      // Only the array's own <string> entries, not the whole file: an explanatory
      // comment mentioning a group name would otherwise satisfy the check.
      const entries = keychainEntries(read(file));
      if (entries === null) {
        return { state: 'missing', detail: 'no keychain-access-groups array' };
      }

      const missing = KEYCHAIN_GROUPS.filter((g) => !entries.includes(g));
      if (missing.length > 0) {
        return { state: 'wrong', detail: `missing: ${missing.join(', ')}` };
      }

      // The app's own group, in either accepted spelling.
      const bundleId = bundleIdentifier(project);
      const ownGroup = entries.findIndex(
        (e) =>
          e === '$(AppIdentifierPrefix)$(PRODUCT_BUNDLE_IDENTIFIER)' ||
          (bundleId && e === `$(AppIdentifierPrefix)${bundleId}`)
      );
      if (ownGroup === -1) {
        return {
          state: 'wrong',
          detail: bundleId
            ? `the app's own group is absent — expected $(AppIdentifierPrefix)${bundleId} or the $(PRODUCT_BUNDLE_IDENTIFIER) form`
            : "the app's own group is absent, and the bundle id could not be read to name it",
        };
      }
      if (ownGroup !== 0) {
        return { state: 'wrong', detail: "the app's own group must be first" };
      }
      return { state: 'ok' };
    },
    why:
      'Without them the keychain returns -34018 (errSecMissingEntitlement), which the ' +
      'SDK surfaces as an authorization failure — an error naming neither the keychain ' +
      'nor the entitlement. Found this way on a device.',
    instruction: (project) => {
      const own = bundleIdentifier(project)
        ? `$(AppIdentifierPrefix)${bundleIdentifier(project)}`
        : '$(AppIdentifierPrefix)$(PRODUCT_BUNDLE_IDENTIFIER)';
      return `In your app's .entitlements, keychain-access-groups in exactly this order:

    <key>keychain-access-groups</key>
    <array>
        <string>${own}</string>
${KEYCHAIN_GROUPS.map((g) => `        <string>${g}</string>`).join('\n')}
    </array>

  The app's own group first, then the SDK's, then MSAL's cache. The first entry may be
  written as the literal bundle id or as $(PRODUCT_BUNDLE_IDENTIFIER) — both work.`;
    },
  },

  {
    id: 'ios-url-types',
    platform: 'ios',
    title: 'CFBundleURLTypes for the MSAL redirect',
    severity: 'loud',
    inspect(project) {
      const src = read(project.ios.infoPlist);
      if (!src) {
        return { state: 'unknown', detail: 'Info.plist not found' };
      }
      if (!src.includes('CFBundleURLTypes')) {
        return { state: 'missing' };
      }
      return /msauth\./.test(src)
        ? { state: 'ok' }
        : { state: 'wrong', detail: 'CFBundleURLTypes present but no msauth. scheme' };
    },
    why:
      'Without it the sign-in redirect never comes back and the login screen reopens ' +
      'forever — a silent loop with no error at all. Found this way on a device.',
    instruction: () =>
      `In Info.plist:

    <key>CFBundleURLTypes</key>
    <array>
      <dict>
        <key>CFBundleURLSchemes</key>
        <array>
          <string>msauth.$(PRODUCT_BUNDLE_IDENTIFIER)</string>
        </array>
      </dict>
    </array>`,
  },

  {
    id: 'ios-query-schemes',
    platform: 'ios',
    title: 'LSApplicationQueriesSchemes for the brokers',
    severity: 'loud',
    inspect(project) {
      const src = read(project.ios.infoPlist);
      if (!src) {
        return { state: 'unknown', detail: 'Info.plist not found' };
      }
      const missing = MSAL_QUERY_SCHEMES.filter((s) => !src.includes(`<string>${s}<`));
      return missing.length === 0
        ? { state: 'ok' }
        : { state: 'missing', detail: `missing: ${missing.join(', ')}` };
    },
    why:
      'MSAL queries msauthv2://broker to decide whether a broker is present. Without ' +
      'the scheme declared, canOpenURL answers no for a broker that is installed, and ' +
      'the app tells users to install what they already have.',
    instruction: () =>
      `In Info.plist:

    <key>LSApplicationQueriesSchemes</key>
    <array>
${MSAL_QUERY_SCHEMES.map((s) => `        <string>${s}</string>`).join('\n')}
        <string>companyportal</string>
    </array>`,
  },

  {
    id: 'ios-no-adal-keys',
    platform: 'ios',
    title: 'No ADAL* identity keys in Info.plist',
    severity: 'silent',
    inspect(project) {
      const src = read(project.ios.infoPlist);
      if (!src) {
        return { state: 'unknown', detail: 'Info.plist not found' };
      }
      const found = ['ADALClientId', 'ADALAuthority', 'ADALRedirectUri'].filter((k) =>
        src.includes(k)
      );
      return found.length === 0
        ? { state: 'ok' }
        : { state: 'wrong', detail: `present: ${found.join(', ')}` };
    },
    why:
      'This module configures identity at runtime. A plist key alongside a runtime ' +
      'override is a known cause of enrollment failures, and the failure names the ' +
      'authority rather than the conflict. configure() refuses to start when it sees ' +
      'one, so this is caught — but it is cheaper to find here.',
    instruction: () =>
      `Remove ADALClientId, ADALAuthority and ADALRedirectUri from
  Info.plist -> IntuneMAMSettings. Identity comes from configure() at runtime.

  Note: ADALCacheKeychainGroupOverride is a different key and is NOT removed — it has
  no runtime equivalent and is the only way to set the keychain group.`,
  },

  {
    id: 'ios-msal-response-handler',
    platform: 'ios',
    title: 'AppDelegate forwards the MSAL redirect',
    severity: 'loud',
    inspect(project) {
      const file = project.ios.appDelegate;
      if (!file) {
        return { state: 'unknown', detail: 'AppDelegate not found' };
      }
      return /handleMSALResponse/.test(read(file))
        ? { state: 'ok' }
        : { state: 'missing', detail: rel(project, file) };
    },
    why:
      'The URL type alone is not enough: without the forward, the redirect reaches the ' +
      'app and is dropped, producing the same silent login loop. Both halves were ' +
      'needed on a device.',
    instruction: () =>
      `In AppDelegate.swift:

    import MSAL

    func application(_ app: UIApplication, open url: URL,
                     options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
      MSALPublicClientApplication.handleMSALResponse(
        url, sourceApplication: options[.sourceApplication] as? String)
    }

  Code in your own AppDelegate, so setup reports it rather than editing it.`,
  },

  {
    id: 'ios-scene-configurations',
    platform: 'ios',
    title: 'UISceneConfigurations is non-empty',
    severity: 'silent',
    inspect(project) {
      const src = read(project.ios.infoPlist);
      if (!src) {
        return { state: 'unknown', detail: 'Info.plist not found' };
      }
      if (!src.includes('UIApplicationSceneManifest')) {
        // No scene manifest at all is the pre-scene lifecycle, which is fine.
        return { state: 'skip', detail: 'no scene manifest — not applicable' };
      }
      if (!src.includes('UISceneConfigurations')) {
        return { state: 'wrong', detail: 'scene manifest present, configurations absent' };
      }
      // An empty <dict/> is the documented failure, and it is easy to miss by eye.
      return /<key>UISceneConfigurations<\/key>\s*<dict\s*\/>/.test(src)
        ? { state: 'wrong', detail: 'UISceneConfigurations is an empty dict' }
        : { state: 'ok' };
    },
    why:
      'Microsoft documents that with an empty or missing UISceneConfigurations in a ' +
      'SwiftUI app, policy applies successfully and the SDK still fails to protect the ' +
      'app. Success is reported and nothing is protected.',
    instruction: () =>
      `Populate UIApplicationSceneManifest -> UISceneConfigurations with your scene
  delegate rather than leaving it empty. An empty dict is the failing state.`,
  },

  {
    id: 'ios-configurator-phase',
    platform: 'ios',
    title: 'IntuneMAMConfigurator build phase',
    severity: 'advisory',
    inspect(project) {
      const src = read(project.ios.pbxproj);
      if (!src) {
        return { state: 'unknown', detail: 'project.pbxproj not found' };
      }
      return /IntuneMAMConfigurator/.test(src)
        ? { state: 'ok' }
        : { state: 'missing' };
    },
    why:
      "Microsoft's own tool writes the plist and entitlements the SDK needs. It is " +
      'idempotent and must re-run on every SDK bump, which is why it belongs in a build ' +
      'phase rather than in someone\'s memory.',
    instruction: () =>
      `Add a "Run Script" build phase to your app target, before Compile Sources:

    "$SRCROOT/../node_modules/react-native-intune/vendor/ios/IntuneMAMConfigurator" \\
      -i "$SRCROOT/$INFOPLIST_FILE" \\
      -e "$SRCROOT/${'$'}{CODE_SIGN_ENTITLEMENTS}"

  Not wrapped by setup: it is Microsoft's tool, and wrapping it means owning what it
  does. The line above is what to paste.`,
  },
];

export const checks = [...androidChecks, ...iosChecks];

/** The <string> entries of the keychain-access-groups array, in order, or null. */
function keychainEntries(src) {
  const m = src.match(
    /<key>keychain-access-groups<\/key>\s*<array>([\s\S]*?)<\/array>/
  );
  if (!m) {
    return null;
  }
  return [...m[1].matchAll(/<string>([^<]*)<\/string>/g)].map((x) => x[1].trim());
}

/**
 * The app's bundle identifier, from the Xcode project.
 *
 * Read rather than assumed so the keychain check can accept the literal spelling. The
 * first non-variable value wins: a project defines it per configuration, and they agree
 * in every template.
 */
function bundleIdentifier(project) {
  const src = read(project.ios?.pbxproj);
  for (const m of src.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)) {
    const value = m[1].trim().replace(/^"|"$/g, '');
    if (value && !value.startsWith('$')) {
      return value;
    }
  }
  return null;
}

/**
 * The SHA-1 of the debug keystore, base64 — the value the MSAL redirect URI needs.
 *
 * Computed rather than asked for, because getting it wrong is the single most common
 * Android setup failure and the error names neither keystore. Returns null when the
 * tools are unavailable; the instruction then prints the command instead.
 *
 * Note which keystore: `android/app/debug.keystore`, the one React Native's template
 * ships and signs debug builds with — not `~/.android/debug.keystore`. They are
 * different keys, and using the machine's one is exactly the mistake this project made.
 */
export function signatureHash(project) {
  const keystore = project.android?.debugKeystore;
  if (!keystore || !fs.existsSync(keystore)) {
    return null;
  }
  try {
    const cert = execFileSync(
      'keytool',
      [
        '-exportcert',
        '-alias',
        'androiddebugkey',
        '-keystore',
        keystore,
        '-storepass',
        'android',
      ],
      { maxBuffer: 1 << 20 }
    );
    const sha1 = execFileSync('openssl', ['sha1', '-binary'], { input: cert });
    return execFileSync('openssl', ['base64'], { input: sha1 }).toString().trim();
  } catch {
    return null;
  }
}

/**
 * The compatibility-matrix row this library is pinned to, read from sdk-versions.json so
 * there is one copy. Duplicating it here is how the two drift and the check starts
 * reporting a row nobody targets.
 */
const REQUIRED_TOOLCHAIN = (() => {
  try {
    const url = new URL('../../sdk-versions.json', import.meta.url);
    const { toolchain } = JSON.parse(fs.readFileSync(url, 'utf8'));
    const { requires } = toolchain;
    return { gradle: requires.gradle, agp: requires.agp, kotlin: requires.kotlin };
  } catch {
    return {};
  }
})();

function firstMatch(src, re) {
  const m = src.match(re);
  return m ? m[1] : null;
}

/** Gradle's version lives in the wrapper properties, not in any build file. */
function gradleWrapperVersion(project) {
  const src = read(
    `${project.android.dir}/gradle/wrapper/gradle-wrapper.properties`
  );
  return firstMatch(src, /gradle-([\d.]+)-(?:bin|all)\.zip/);
}

export { MARKER };
