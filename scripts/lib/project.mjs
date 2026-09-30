/**
 * Locates the consumer's project files.
 *
 * `doctor` and `setup` run from the consumer's project root — `npx react-native-intune
 * doctor` — so everything here resolves from `process.cwd()`, never from this package's
 * own directory. Getting that backwards would have the tool inspect itself and report
 * a perfectly configured project every time.
 *
 * Every accessor returns `null` rather than throwing when a file is absent. A React
 * Native project missing its Android folder is a normal state (iOS-only app), not an
 * error, and a tool that crashes on it is a tool people stop running.
 */

import fs from 'node:fs';
import path from 'node:path';

export function findProject(cwd = process.cwd()) {
  const root = findProjectRoot(cwd);
  return {
    root,
    isThisPackage: isThisPackage(root),
    android: findAndroid(root),
    ios: findIos(root),
  };
}

/**
 * True when the "project" found is this library's own repository.
 *
 * It qualifies on the surface — a package.json beside an `android/` directory — and
 * configuring it would be the exact mistake these tools exist to prevent: the MAM plugin
 * applied to the library rewrites only the library, builds cleanly, and protects
 * nothing. Refusing here is cheaper than explaining it later.
 */
function isThisPackage(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return pkg.name === 'react-native-intune';
  } catch {
    return false;
  }
}

/**
 * Walks up looking for a `package.json` next to an `android/` or `ios/` directory.
 *
 * Not just the nearest `package.json`: in a monorepo that is often a workspace package
 * with no native project in it, and the app lives a level up or across. Requiring the
 * native folder alongside is what distinguishes "the app" from "a package".
 */
function findProjectRoot(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    const hasManifest = fs.existsSync(path.join(dir, 'package.json'));
    const hasNative =
      fs.existsSync(path.join(dir, 'android')) ||
      fs.existsSync(path.join(dir, 'ios'));
    if (hasManifest && hasNative) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // No native project above us. Return the starting point so the caller reports
      // "nothing to inspect" against a path the user recognises.
      return path.resolve(cwd);
    }
    dir = parent;
  }
}

function findAndroid(root) {
  const dir = path.join(root, 'android');
  if (!fs.existsSync(dir)) {
    return null;
  }
  return {
    dir,
    appBuildGradle: existing(path.join(dir, 'app', 'build.gradle')),
    // Kotlin DSL is not handled by `setup`'s text insertion, but `doctor` still needs to
    // see it so it can say so instead of reporting a missing plugin.
    appBuildGradleKts: existing(path.join(dir, 'app', 'build.gradle.kts')),
    rootBuildGradle: existing(path.join(dir, 'build.gradle')),
    rootBuildGradleKts: existing(path.join(dir, 'build.gradle.kts')),
    manifest: existing(path.join(dir, 'app', 'src', 'main', 'AndroidManifest.xml')),
    gradleProperties: existing(path.join(dir, 'gradle.properties')),
    debugKeystore: existing(path.join(dir, 'app', 'debug.keystore')),
    // The Application subclass, if there is one to inspect. Both languages, both of the
    // conventional source roots.
    applicationSources: findApplicationSources(dir),
  };
}

function findIos(root) {
  const dir = path.join(root, 'ios');
  if (!fs.existsSync(dir)) {
    return null;
  }
  const xcodeproj = firstMatching(dir, (name) => name.endsWith('.xcodeproj'));
  const appName = xcodeproj ? path.basename(xcodeproj, '.xcodeproj') : null;
  const appDir = appName ? existing(path.join(dir, appName)) : null;

  return {
    dir,
    appName,
    xcodeproj,
    pbxproj: xcodeproj ? existing(path.join(xcodeproj, 'project.pbxproj')) : null,
    infoPlist: appDir ? existing(path.join(appDir, 'Info.plist')) : null,
    // Xcode's default name, which is what the template produces. A custom name is
    // reported as "not found" rather than guessed at — a wrong entitlements file edited
    // silently is worse than an honest miss.
    entitlements: appDir
      ? existing(path.join(appDir, `${appName}.entitlements`))
      : null,
    appDelegate: appDir ? findAppDelegate(appDir) : null,
    podfile: existing(path.join(dir, 'Podfile')),
  };
}

function findApplicationSources(androidDir) {
  const roots = [
    path.join(androidDir, 'app', 'src', 'main', 'java'),
    path.join(androidDir, 'app', 'src', 'main', 'kotlin'),
  ].filter((p) => fs.existsSync(p));

  const found = [];
  for (const r of roots) {
    walk(r, (file) => {
      if (/(Application)\.(kt|java)$/.test(path.basename(file))) {
        found.push(file);
      }
    });
  }
  return found;
}

function findAppDelegate(appDir) {
  for (const name of ['AppDelegate.swift', 'AppDelegate.mm', 'AppDelegate.m']) {
    const p = path.join(appDir, name);
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

// ---------------------------------------------------------------- small helpers

function existing(p) {
  return fs.existsSync(p) ? p : null;
}

function firstMatching(dir, predicate) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (predicate(e.name)) {
      return path.join(dir, e.name);
    }
  }
  return null;
}

function walk(dir, onFile, depth = 0) {
  // Bounded: a source tree deeper than this is not holding an Application class, and an
  // unbounded walk over node_modules in a misconfigured project is a hang.
  if (depth > 12) {
    return;
  }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'build' || e.name.startsWith('.')) {
        continue;
      }
      walk(p, onFile, depth + 1);
    } else {
      onFile(p);
    }
  }
}

/**
 * Edits `setup` has decided on but not yet written, by path.
 *
 * Several checks change the same file — three edit Info.plist, three project.pbxproj —
 * and each computes its edit from what it reads. Reading through this means the second
 * edit starts from the first one's result instead of from the original file, which it
 * would otherwise silently overwrite.
 */
export const pending = new Map();

/** Reads a file, or returns an empty string. Callers treat absent and empty alike. */
export function read(file) {
  if (!file) {
    return '';
  }
  if (pending.has(file)) {
    return pending.get(file);
  }
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** Path relative to the project root, for output a user can act on. */
export function rel(project, file) {
  return file ? path.relative(project.root, file) : '(not found)';
}
