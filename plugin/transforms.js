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
 * Registers the auth callback in the generated Application class.
 *
 * **It deliberately does not touch the superclass.** An earlier version rewrote
 * `: Application()` to `: MAMApplication()` in source, which does not compile in a
 * consumer app: this package declares the MAM AAR as `implementation files(...)`, and
 * `implementation` is not transitive, so the SDK's classes are not on the app module's
 * compile classpath. The superclass resolves to an error type and every member
 * inheriting from it fails with it — see issue #5.
 *
 * The superclass is the MAM Gradle plugin's job, in bytecode, which is what Microsoft's
 * own guidance describes and what this repository's example app has always relied on.
 * Rewriting it here was both broken and redundant.
 *
 * The callback goes in `onCreate` deliberately: the MAM plugin rewrites `onCreate` into
 * `onMAMCreate` at build time, so writing `onMAMCreate` here would leave a method the
 * plugin never calls.
 *
 * Returns null when the file does not look the way we expect. A warning the consumer can
 * act on beats a generated file that does not compile.
 */
function withMamApplication(contents, language) {
  const isKotlin = language === 'kt';

  const migrated = revertLegacySuperclass(contents, isKotlin);
  if (migrated === null) {
    return null;
  }
  if (/RNIntuneAuthCallback\s*\.\s*register/.test(migrated)) {
    return migrated;
  }

  // `MAMApplication` is accepted as well as `Application`: an app that has wired the SDK
  // into its own module may extend it directly, and the plugin's rewrite is then a no-op
  // rather than an error. What matters is that there is an Application subclass at all —
  // with none, the Gradle plugin has nothing to transform.
  const appClass = isKotlin
    ? /class\s+\w+\s*:\s*(?:MAM)?Application\s*\(\s*\)/
    : /class\s+\w+\s+extends\s+(?:MAM)?Application\b/;
  if (!appClass.test(migrated)) {
    return null;
  }

  const next = addImports(migrated, [
    `import com.reactnativeintune.RNIntuneAuthCallback${isKotlin ? '' : ';'}`,
  ]);
  if (next === null) {
    return null;
  }

  // After `super.onCreate()`, not at the top of the method. The superclass is what
  // initialises the MAM machinery the callback registers with, so registering first is
  // registering against nothing — and it fails the way everything here fails, by
  // reporting a licensing-shaped enrollment status that retries quietly.
  const onCreate = isKotlin
    ? /(override\s+fun\s+onCreate\s*\(\s*\)\s*\{[^\n]*\n\s*super\.onCreate\s*\(\s*\)\s*\n)/
    : /(public\s+void\s+onCreate\s*\(\s*\)\s*\{[^\n]*\n\s*super\.onCreate\s*\(\s*\)\s*;\s*\n)/;
  if (!onCreate.test(next)) {
    return null;
  }
  const end = isKotlin ? '' : ';';
  const call =
    `    ${CALLBACK_COMMENT}\n` +
    `    // time, so this belongs here rather than in an onMAMCreate we write.\n` +
    `    RNIntuneAuthCallback.register(this)${end}\n`;

  return next.replace(onCreate, `$1${call}`);
}

/**
 * The first line of the comment this transform writes above the callback. It is also
 * how a file this transform has already touched is recognised — see below.
 */
const CALLBACK_COMMENT = `// ${MARKER}: the MAM plugin rewrites onCreate into onMAMCreate at build`;

/**
 * Undoes what 0.1.0 wrote, so the fix reaches people the defect already reached.
 *
 * 0.1.0 rewrote the superclass to `MAMApplication` in source and added its import. The
 * idempotency guard above would leave such a file untouched — it already registers the
 * callback — so `expo prebuild` without `--clean` would keep a file that does not
 * compile, on the version that is supposed to fix it.
 *
 * Only a file carrying this transform's own comment is changed. That comment is proof
 * the superclass was ours to write; an app that extends `MAMApplication` deliberately,
 * with the SDK on its own classpath, is left alone.
 */
function revertLegacySuperclass(contents, isKotlin) {
  if (!contents.includes(CALLBACK_COMMENT)) {
    return contents;
  }
  const superclass = isKotlin
    ? /(class\s+\w+\s*:\s*)MAMApplication(\s*\(\s*\))/
    : /(class\s+\w+\s+extends\s+)MAMApplication\b/;
  if (!superclass.test(contents)) {
    return contents;
  }
  const reverted = contents
    .replace(superclass, isKotlin ? '$1Application$2' : '$1Application')
    .replace(
      /^import com\.microsoft\.intune\.mam\.client\.app\.MAMApplication;?\n/m,
      ''
    );
  return addImports(reverted, [
    `import android.app.Application${isKotlin ? '' : ';'}`,
  ]);
}

/**
 * Adds each missing import after the last existing one. Null when the file has no
 * import to anchor on, which a generated Application class always has.
 */
function addImports(contents, imports) {
  const missing = imports.filter((i) => !contents.includes(i));
  if (missing.length === 0) {
    return contents;
  }
  const lastImport = [...contents.matchAll(/^import .*$/gm)].pop();
  if (!lastImport) {
    return null;
  }
  const at = lastImport.index + lastImport[0].length;
  return `${contents.slice(0, at)}\n${missing.join('\n')}${contents.slice(at)}`;
}

module.exports = {
  MARKER,
  withMamPluginApplied,
  withMamClasspath,
  withMamApplication,
};
