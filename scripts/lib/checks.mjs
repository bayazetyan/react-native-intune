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
import { createRequire } from 'node:module';
import {
  entitlementsWithKeychainGroups,
  pbxprojAddConfiguratorPhase,
  pbxprojSetDeploymentTarget,
  pbxprojSetEntitlements,
  plistEnsureStrings,
  plistEnsureUrlScheme,
  plistRemoveKeys,
} from './edits.mjs';
import { read, rel } from './project.mjs';

/**
 * The Expo plugin's transforms, used here for the same edits in a bare project. One
 * implementation of each, already tested and already run against real builds, rather
 * than a second one that drifts.
 */
const transforms = createRequire(import.meta.url)('../../plugin/transforms.js');

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
    apply(project) {
      const file = project.android.appBuildGradle;
      const src = read(file);
      // The Kotlin DSL is not edited — reported instead, like it is inspected.
      return src ? { file, contents: transforms.withMamPluginApplied(src) } : null;
    },
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
    apply(project) {
      const file = project.android.rootBuildGradle;
      const src = read(file);
      const contents = src && transforms.withMamClasspath(src);
      return contents ? { file, contents } : null;
    },
  },

  {
    id: 'android-min-sdk',
    platform: 'android',
    title: 'minSdk 24 or later',
    severity: 'loud',
    /**
     * MSAL requires 24 and React Native 0.74's template ships 23. Loud rather than silent
     * — the manifest merger fails and names MSAL — but it is the first thing a 0.74
     * project hits, and cheaper found here than after a Gradle run.
     */
    inspect(project) {
      const root = read(project.android.rootBuildGradle);
      const properties = read(path.join(project.android.dir, 'gradle.properties'));
      const value =
        firstMatch(root, /minSdkVersion\s*=\s*(\d+)/) ??
        firstMatch(properties, /^android\.minSdkVersion\s*=\s*(\d+)/m) ??
        firstMatch(read(project.android.appBuildGradle), /minSdk(?:Version)?\s*=?\s*(\d+)/);
      if (!value) {
        return { state: 'unknown', detail: 'no literal minSdkVersion in the build files' };
      }
      return Number(value) >= 24
        ? { state: 'ok', detail: value }
        : { state: 'wrong', detail: `minSdkVersion ${value}` };
    },
    why:
      'MSAL declares minSdk 24. Below it the manifest merger refuses the build, and the ' +
      'fix is one number.',
    instruction: () =>
      `In android/build.gradle:

    buildscript {
      ext {
        minSdkVersion = 24
      }
    }`,
    apply(project) {
      const file = project.android.rootBuildGradle;
      const src = read(file);
      const m = src && src.match(/(minSdkVersion\s*=\s*)(\d+)/);
      return m && Number(m[2]) < 24
        ? { file, contents: src.replace(m[0], `${m[1]}24`) }
        : null;
    },
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
    /**
     * An edit to the developer's own source, which setup otherwise avoids — but the change
     * is one line after `super.onCreate()`, it is shown as a diff before anything is
     * written, and the tree has to be clean so it is one revert away. Leaving it manual
     * leaves the one silent omission here that nothing else would catch.
     */
    apply(project) {
      const [file] = project.android.applicationSources;
      if (!file) {
        return null;
      }
      const contents = transforms.withMamApplication(
        read(file),
        file.endsWith('.kt') ? 'kt' : 'java'
      );
      return contents ? { file, contents } : null;
    },
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
    /**
     * Written with the hash of android/app/debug.keystore, computed here — the key a
     * debug build is signed with, and the one most apps are first run with. A release
     * signed with another key needs that key's hash as a second <data> entry, which
     * setup cannot know; the comment it writes says so.
     */
    apply(project) {
      const file = project.android.manifest;
      const src = read(file);
      const hash = signatureHash(project);
      const applicationId = read(project.android.appBuildGradle).match(
        /applicationId\s*=?\s*["']([\w.]+)["']/
      )?.[1];
      if (!src || !hash || !applicationId || !/<\/application>/.test(src)) {
        return null;
      }
      const activity = `
        <!-- ${MARKER}: the MSAL redirect. The path is the hash of the debug keystore;
             a release build signed with another key needs that key's hash as a second
             <data> element, and the matching redirect URI registered in Entra. -->
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
        </activity>
`;
      return {
        file,
        contents: src.replace(/(\n?)([ \t]*)<\/application>/, `${activity}$2</application>`),
      };
    },
  },

  {
    id: 'android-toolchain',
    platform: 'android',
    title: 'App toolchain is a tested combination',
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
      // React Native's templates leave AGP and Kotlin to React Native's own version
      // catalog — `classpath("com.android.tools.build:gradle")` with no version, which
      // the React Native Gradle plugin resolves from it. So that catalog is where the
      // versions the app actually builds with are written.
      const catalog = read(
        path.join(project.root, 'node_modules/react-native/gradle/libs.versions.toml')
      );
      found.agp ||= firstMatch(catalog, /^agp\s*=\s*"([\d.]+)"/m);
      found.kotlin ||= firstMatch(catalog, /^kotlin\s*=\s*"([\d.]+)"/m);
      const rn = (() => {
        try {
          return JSON.parse(
            read(path.join(project.root, 'node_modules/react-native/package.json')) || '{}'
          ).version;
        } catch {
          return undefined;
        }
      })();

      const seen = Object.keys(REQUIRED_TOOLCHAIN).filter((k) => found[k]);
      if (seen.length === 0) {
        return {
          state: 'unknown',
          detail: 'could not read any version from the build files',
        };
      }
      const unread = Object.keys(REQUIRED_TOOLCHAIN).filter((k) => !found[k]);
      const partly = unread.length > 0 ? `; ${unread.join(', ')} not read` : '';
      const agrees = (row) =>
        seen.every((k) => row[k] === undefined || row[k] === found[k]) &&
        seen.some((k) => row[k] !== undefined);

      if (agrees(REQUIRED_TOOLCHAIN)) {
        return { state: 'ok', detail: `on Microsoft's tested row${partly}` };
      }
      // Off Microsoft's row, but a combination this project has built and run — which is
      // worth saying so, and worth saying whose claim it is.
      // The row for this project's own React Native version first, so a report names the
      // combination that was actually built rather than one that happens to share a
      // Gradle version.
      const candidates = VERIFIED_TOOLCHAINS.filter(agrees);
      const ours =
        candidates.find((v) => rn && String(v.reactNative).includes(rn)) ?? candidates[0];
      if (ours) {
        return {
          state: 'ok',
          detail:
            `${seen.map((k) => `${k} ${found[k]}`).join(', ')} — verified by this project ` +
            `on ${ours.date} (React Native ${ours.reactNative}), not by Microsoft${partly}`,
        };
      }
      return {
        state: 'wrong',
        detail:
          seen.map((k) => `${k} ${found[k]}`).join(', ') +
          ' — neither Microsoft\u2019s row nor a combination verified here' +
          partly,
      };
    },
    why:
      'Microsoft tests specific combinations of Gradle, AGP and Kotlin against each MAM ' +
      'SDK release. A mixed row is untested rather than broken — but the MAM plugin ' +
      'rewrites bytecode in your app module, so when a mixed row does fail it fails ' +
      'inside javassist and the error names one of your classes, never a version.',
    instruction: () =>
      `Microsoft's tested row for the pinned MAM SDK:

    Gradle ${REQUIRED_TOOLCHAIN.gradle}   AGP ${REQUIRED_TOOLCHAIN.agp}   Kotlin ${REQUIRED_TOOLCHAIN.kotlin}   Java 17

  Built and run by this project, off that row:

${VERIFIED_TOOLCHAINS.map(
  (v) =>
    `    Gradle ${v.gradle}${v.agp ? `   AGP ${v.agp}` : ''}   Kotlin ${v.kotlin}   ` +
    `(React Native ${v.reactNative}, ${v.date})`
).join('\n')}

  Anything else is untested rather than broken. If a build fails inside the MAM plugin
  with an error naming one of your classes, move to one of these first.`,
  },
];

// ---------------------------------------------------------------- ios

/**
 * The lowest iOS the vendored MAM SDK runs on. Read from the binary (`otool -l` on
 * IntuneMAMSwift.framework reports `minos 17.0` in 21.8.0, 21.9.0 and 21.9.1), not from
 * Microsoft's release notes — the SDK should move this, not a guess.
 */
const MIN_IOS = [17, 0];

const versionAtLeast = (value, [major, minor]) => {
  const [a = 0, b = 0] = String(value).split('.').map(Number);
  return a > major || (a === major && b >= minor);
};

/**
 * The deployment target each configuration of each application target actually builds
 * with: the target's own setting, or the project-level one it inherits when it sets
 * none. A value elsewhere in the file — a project-level default the target overrides,
 * another target — says nothing about what the app is built for, and counting those is
 * how an Expo project, whose project level reads 16.4 while the app target reads 17.0,
 * was reported as wrong.
 */
function appDeploymentTargets(pbxproj) {
  const object = (isa) =>
    new RegExp(
      `(\\w{24})\\s*(?:/\\*[^*]*\\*/)?\\s*=\\s*\\{\\s*isa\\s*=\\s*${isa};([\\s\\S]*?)\\n\\t\\t\\};`,
      'g'
    );
  const configs = new Map();
  for (const [, id, body] of pbxproj.matchAll(object('XCBuildConfiguration'))) {
    configs.set(id, {
      name: body.match(/\bname\s*=\s*"?([^";]+)"?;/)?.[1],
      value: body.match(/IPHONEOS_DEPLOYMENT_TARGET\s*=\s*"?([\d.]+)"?;/)?.[1],
    });
  }
  const lists = new Map();
  for (const [, id, body] of pbxproj.matchAll(object('XCConfigurationList'))) {
    const ids = body.match(/buildConfigurations\s*=\s*\(([^)]*)\)/)?.[1] ?? '';
    lists.set(id, [...ids.matchAll(/\w{24}/g)].map((m) => m[0]));
  }
  const listOf = (body) => body.match(/buildConfigurationList\s*=\s*(\w{24})/)?.[1];

  const [, , projectBody = ''] = [...pbxproj.matchAll(object('PBXProject'))][0] ?? [];
  const inherited = new Map(
    (lists.get(listOf(projectBody)) ?? []).map((id) => [
      configs.get(id)?.name,
      configs.get(id)?.value,
    ])
  );

  const effective = [];
  for (const [, , body] of pbxproj.matchAll(object('PBXNativeTarget'))) {
    if (!/productType\s*=\s*"com\.apple\.product-type\.application"/.test(body)) {
      continue;
    }
    for (const id of lists.get(listOf(body)) ?? []) {
      const c = configs.get(id) ?? {};
      effective.push({ name: c.name, value: c.value ?? inherited.get(c.name) ?? null });
    }
  }
  return effective;
}

/** Ruby comments — whole-line or trailing — so a commented-out platform line is ignored. */
const stripRubyComments = (src) => src.replace(/(^|\s)#.*$/gm, '$1');

/**
 * The Run Script phase setup adds. It fails the build when the tool is missing rather
 * than skipping it, because a skipped run leaves a plist without the schemes the SDK
 * needs, and that fails at sign-in with an empty log instead of here with a reason.
 */
const CONFIGURATOR_SCRIPT = `# ${MARKER}: Microsoft's IntuneMAMConfigurator, run on this app's Info.plist and
# entitlements. A build phase rather than a manual step, because what it writes is not a
# fixed list and changes between SDK versions. It is idempotent.
set -euo pipefail

CONFIGURATOR="$SRCROOT/../node_modules/react-native-intune/vendor/ios/IntuneMAMConfigurator"

if [ ! -x "$CONFIGURATOR" ]; then
  echo "error: IntuneMAMConfigurator is missing — run: node node_modules/react-native-intune/scripts/fetch-sdks.mjs"
  exit 1
fi

"$CONFIGURATOR" -i "$SRCROOT/$INFOPLIST_FILE" -e "$SRCROOT/$CODE_SIGN_ENTITLEMENTS"
`;

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

      const effective = appDeploymentTargets(read(project.ios.pbxproj));
      if (effective.length === 0) {
        return {
          state: 'unknown',
          detail: `${source} targets ${target}; no application target found in the Xcode project`,
        };
      }
      // A configuration that sets it nowhere builds for the SDK's own default, which is
      // the newest iOS — not a problem, so only explicit low values count.
      const low = effective.filter((e) => e.value && !versionAtLeast(e.value, MIN_IOS));
      if (low.length > 0) {
        return {
          state: 'wrong',
          detail:
            `${source} targets ${target}, but the app target builds for ` +
            low.map((e) => `${e.value} (${e.name})`).join(', '),
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
    /**
     * The Podfile and the app target together — raising one without the other is the case
     * this check exists to catch. An Expo Podfile is left alone: prebuild regenerates it,
     * and the value belongs in expo-build-properties.
     */
    apply(project) {
      const podfile = project.ios.podfile;
      const src = read(podfile);
      const line = src.match(/^(\s*platform\s+:ios\s*,\s*)(.+)$/m);
      if (!line || /ios\.deploymentTarget/.test(line[2])) {
        return null;
      }
      const version = MIN_IOS.join('.');
      const edits = [{ file: podfile, contents: src.replace(line[0], `${line[1]}'${version}'`) }];
      const pbxproj = read(project.ios.pbxproj);
      const next =
        pbxproj &&
        pbxprojSetDeploymentTarget(pbxproj, version, (v) => versionAtLeast(v, MIN_IOS));
      if (next) {
        edits.push({ file: project.ios.pbxproj, contents: next });
      }
      return edits;
    },
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
    /**
     * React Native's template has no entitlements file, so this usually creates one and
     * points the app target at it. An app target that already names a differently-called
     * entitlements file is left to be edited by hand: creating a second file it never
     * reads would look fixed and change nothing.
     */
    apply(project) {
      const ios = project.ios;
      const pbxproj = read(ios.pbxproj);
      if (!ios.appName || !pbxproj) {
        return null;
      }
      if (!ios.entitlements && /CODE_SIGN_ENTITLEMENTS\s*=/.test(pbxproj)) {
        return null;
      }
      const file =
        ios.entitlements ?? path.join(ios.dir, ios.appName, `${ios.appName}.entitlements`);
      const contents = entitlementsWithKeychainGroups(read(file), [
        '$(AppIdentifierPrefix)$(PRODUCT_BUNDLE_IDENTIFIER)',
        ...KEYCHAIN_GROUPS,
      ]);
      if (!contents) {
        return null;
      }
      const edits = [{ file, contents }];
      const next = pbxprojSetEntitlements(
        pbxproj,
        `${ios.appName}/${ios.appName}.entitlements`
      );
      if (next) {
        edits.push({ file: ios.pbxproj, contents: next });
      }
      return edits;
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
    apply(project) {
      const file = project.ios.infoPlist;
      const src = read(file);
      const contents = src && plistEnsureUrlScheme(src, 'msauth.$(PRODUCT_BUNDLE_IDENTIFIER)');
      return contents ? { file, contents } : null;
    },
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
    apply(project) {
      const file = project.ios.infoPlist;
      const src = read(file);
      const contents =
        src && plistEnsureStrings(src, 'LSApplicationQueriesSchemes', MSAL_QUERY_SCHEMES);
      return contents ? { file, contents } : null;
    },
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
    apply(project) {
      const file = project.ios.infoPlist;
      const src = read(file);
      return src
        ? {
            file,
            contents: plistRemoveKeys(src, ['ADALClientId', 'ADALAuthority', 'ADALRedirectUri']),
          }
        : null;
    },
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
    /** The Expo plugin's transform, which adds the method when a template has none. */
    apply(project) {
      const file = project.ios.appDelegate;
      if (!file) {
        return null;
      }
      const contents = transforms.withMsalResponseHandler(
        read(file),
        file.endsWith('.swift') ? 'swift' : 'objcpp'
      );
      return contents ? { file, contents } : null;
    },
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

  setup adds it for you. It runs Microsoft's tool as it is — setup writes the phase,
  not a wrapper around what the tool does.`,
    apply(project) {
      const file = project.ios.pbxproj;
      const src = read(file);
      const contents = src && pbxprojAddConfiguratorPhase(src, CONFIGURATOR_SCRIPT);
      return contents ? { file, contents } : null;
    },
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
const TOOLCHAIN = (() => {
  try {
    const url = new URL('../../sdk-versions.json', import.meta.url);
    return JSON.parse(fs.readFileSync(url, 'utf8')).toolchain ?? {};
  } catch {
    return {};
  }
})();
const REQUIRED_TOOLCHAIN = TOOLCHAIN.requires
  ? {
      gradle: TOOLCHAIN.requires.gradle,
      agp: TOOLCHAIN.requires.agp,
      kotlin: TOOLCHAIN.requires.kotlin,
    }
  : {};

/**
 * Combinations this project has built and run itself, off Microsoft's row — see the
 * comment in sdk-versions.json for what qualifies one.
 */
const VERIFIED_TOOLCHAINS = TOOLCHAIN.verified ?? [];

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
