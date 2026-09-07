/**
 * The text surgery the Expo config plugin performs, as pure functions.
 *
 * Separated from the plugin wiring for one reason: `@expo/config-plugins` is not
 * installed unless the consumer uses Expo, so anything importing it cannot be tested
 * here. These take a string and return a string, so they are tested directly — which
 * matters, because two of them edit generated Kotlin and a bad regex silently produces
 * a file that does not compile.
 *
 * Every function is idempotent. `expo prebuild` runs plugins against freshly generated
 * files most of the time, but `prebuild` without `--clean` runs them against files a
 * previous run already touched, so applying twice has to be a no-op.
 */

const MARKER = 'react-native-intune';

const MAM_PLUGIN_BLOCK = `
// ${MARKER}: the MAM Gradle plugin rewrites bytecode across the app and every
// dependency. It belongs in the app module — applied to a library it rewrites only that
// library, builds cleanly, and protects nothing.
apply plugin: "com.microsoft.intune.mam"

intunemam {
    report = true
    verify = true
    incremental = true
}
`;

/** Applies the MAM plugin to android/app/build.gradle. */
function withMamPluginApplied(contents) {
  if (contents.includes('com.microsoft.intune.mam')) {
    return contents;
  }
  return `${contents.trimEnd()}\n${MAM_PLUGIN_BLOCK}`;
}

/**
 * Adds the plugin jar and javassist to the root buildscript classpath.
 *
 * javassist's version must match the SDK exactly — the plugin uses it to rewrite
 * bytecode, and a mismatch fails in ways that point at the rewritten class rather than
 * at the version.
 */
function withMamClasspath(contents, { javassist = '3.29.2-GA' } = {}) {
  if (contents.includes('com.microsoft.intune.mam.build')) {
    return contents;
  }
  const lines = [
    `        // ${MARKER}: managed block`,
    '        classpath files("$rootDir/../node_modules/react-native-intune/vendor/android/GradlePlugin/com.microsoft.intune.mam.build.jar")',
    `        classpath "org.javassist:javassist:${javassist}"`,
  ].join('\n');

  // Anchor on the buildscript's own dependencies block. Matching `dependencies {`
  // anywhere would hit the app-level one in a single-file project and put a buildscript
  // classpath where it does nothing.
  const anchor = /(buildscript\s*\{[\s\S]*?dependencies\s*\{\s*\n)/;
  if (!anchor.test(contents)) {
    return null;
  }
  return contents.replace(anchor, `$1${lines}\n`);
}

/**
 * Makes the generated Application class derive from MAMApplication and register the auth
 * callback.
 *
 * This is the difference Expo makes. On bare React Native this file is the developer's
 * own source, so `doctor` can only report it; under prebuild the file is generated, so
 * there is nothing of theirs to overwrite. It is also one of the three omissions that
 * build and run while protecting nothing, which is why automating it is worth the
 * string surgery.
 *
 * The callback goes in `onCreate` deliberately: the MAM plugin rewrites `onCreate` into
 * `onMAMCreate` at build time, so writing `onMAMCreate` here would leave a method the
 * plugin never calls.
 *
 * Returns null when the file does not look the way we expect. A warning the consumer can
 * act on beats a generated file that does not compile.
 */
function withMamApplication(contents, language) {
  if (contents.includes('MAMApplication')) {
    return contents;
  }

  const isKotlin = language === 'kt';
  const superclass = isKotlin
    ? /(class\s+\w+\s*:\s*)Application(\s*\(\s*\))?/
    : /(class\s+\w+\s+extends\s+)Application/;
  if (!superclass.test(contents)) {
    return null;
  }

  let next = contents.replace(superclass, '$1MAMApplication()');
  if (!isKotlin) {
    next = next.replace(
      /(class\s+\w+\s+extends\s+)MAMApplication\(\)/,
      '$1MAMApplication'
    );
  }

  // Imports. `android.app.Application` may still be referenced elsewhere in the file, so
  // it is added alongside rather than replacing anything.
  const imports = isKotlin
    ? [
        'import com.microsoft.intune.mam.client.app.MAMApplication',
        'import com.reactnativeintune.RNIntuneAuthCallback',
      ]
    : [
        'import com.microsoft.intune.mam.client.app.MAMApplication;',
        'import com.reactnativeintune.RNIntuneAuthCallback;',
      ];
  const missing = imports.filter((i) => !next.includes(i));
  if (missing.length > 0) {
    const lastImport = [...next.matchAll(/^import .*$/gm)].pop();
    if (!lastImport) {
      return null;
    }
    const at = lastImport.index + lastImport[0].length;
    next = `${next.slice(0, at)}\n${missing.join('\n')}${next.slice(at)}`;
  }

  if (!/RNIntuneAuthCallback\s*\.\s*register/.test(next)) {
    // After `super.onCreate()`, not at the top of the method. The superclass is what
    // initialises the MAM machinery the callback registers with, so registering first
    // is registering against nothing — and it fails the way everything here fails, by
    // reporting a licensing-shaped enrollment status that retries quietly.
    const onCreate = isKotlin
      ? /(override\s+fun\s+onCreate\s*\(\s*\)\s*\{[^\n]*\n\s*super\.onCreate\s*\(\s*\)\s*\n)/
      : /(public\s+void\s+onCreate\s*\(\s*\)\s*\{[^\n]*\n\s*super\.onCreate\s*\(\s*\)\s*;\s*\n)/;
    if (!onCreate.test(next)) {
      return null;
    }
    const call = isKotlin
      ? `    // ${MARKER}: the MAM plugin rewrites onCreate into onMAMCreate at build\n` +
        `    // time, so this belongs here rather than in an onMAMCreate we write.\n` +
        '    RNIntuneAuthCallback.register(this)\n'
      : `    // ${MARKER}: the MAM plugin rewrites onCreate into onMAMCreate at build\n` +
        `    // time, so this belongs here rather than in an onMAMCreate we write.\n` +
        '    RNIntuneAuthCallback.register(this);\n';
    next = next.replace(onCreate, `$1${call}`);
  }

  return next;
}

module.exports = {
  MARKER,
  withMamPluginApplied,
  withMamClasspath,
  withMamApplication,
};
