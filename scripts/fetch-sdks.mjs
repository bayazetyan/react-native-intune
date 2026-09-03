#!/usr/bin/env node
/**
 * Downloads the pinned Microsoft Intune App SDK builds into vendor/.
 *
 * Why this exists: the SDKs are Microsoft's, under Microsoft's licence terms, and are
 * not ours to redistribute. They are never committed to this repository and never
 * published in the npm tarball. This script fetches them at install time instead.
 *
 * Safe to run from postinstall: it only ever writes inside this package's own vendor/
 * directory. It never touches the consumer's project files — that is what
 * `react-native-intune setup` is for, and that one is never automatic.
 *
 * Usage:
 *   node scripts/fetch-sdks.mjs                 # fetch what is missing
 *   node scripts/fetch-sdks.mjs --force         # re-fetch even if present
 *   node scripts/fetch-sdks.mjs --platform ios  # ios | android
 *   node scripts/fetch-sdks.mjs --check         # verify only, exit 1 if incomplete
 *   node scripts/fetch-sdks.mjs --soft          # never exit non-zero (for postinstall)
 *   node scripts/fetch-sdks.mjs --print-layout  # list the archive's artifacts and exit
 *   node scripts/fetch-sdks.mjs --print-layout-all  # ... including every nested file
 *
 * Requires Node 18+ (global fetch) and the `tar` CLI.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor');
/**
 * Lives at the repository root, not inside vendor/, because vendor/ is gitignored and
 * this file is meant to be committed: it records the resolved tag and a sha256 per
 * artifact, so every developer and CI run can verify they built against identical
 * binaries rather than whatever "latest" meant that day.
 */
const LOCK = path.join(ROOT, 'sdk-lock.json');
const CONFIG = path.join(ROOT, 'sdk-versions.json');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const opt = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};

const FORCE = has('--force');
/**
 * Never fail the process. Used by postinstall: a library must remain installable
 * without network access or a GitHub token. The build is where a missing SDK must
 * fail loudly — the podspec raises, and Gradle checks before compiling.
 */
const SOFT = has('--soft');
const CHECK_ONLY = has('--check');
const PRINT_LAYOUT = has('--print-layout') || has('--print-layout-all');
const PRINT_ALL = has('--print-layout-all');
const ONLY = opt('--platform');
const QUIET = has('--quiet') || process.env.npm_config_loglevel === 'silent';

const log = (...m) => !QUIET && console.log('[react-native-intune]', ...m);
const warn = (...m) => console.warn('[react-native-intune]', ...m);

const LICENCE_NOTICE = `
  The Microsoft Intune App SDK is a Microsoft product, licensed by Microsoft under its
  own terms. This library neither includes nor relicenses it, and downloading it here
  does not grant you any rights to it. Review and accept Microsoft's terms before use:
    iOS      https://github.com/msintuneappsdk/ms-intune-app-sdk-ios
    Android  https://github.com/microsoftconnect/ms-intune-app-sdk-android
`;

// ---------------------------------------------------------------- helpers

function readConfig() {
  if (!fs.existsSync(CONFIG)) fail(`sdk-versions.json not found at ${CONFIG}`);
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  for (const p of ['ios', 'android']) {
    if (!cfg[p]) fail(`sdk-versions.json is missing the "${p}" section`);
    if (cfg[p].tag === 'LATEST') {
      warn(
        `"${p}.tag" is still LATEST. Pin a real release tag before shipping — an ` +
          `unpinned SDK means two developers can build against different binaries.`
      );
    }
  }
  return cfg;
}

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(LOCK, 'utf8'));
  } catch {
    return {};
  }
}

function writeLock(lock) {
  fs.writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
}

function fail(msg) {
  if (SOFT) {
    console.warn(
      `\n[react-native-intune] Could not fetch the Microsoft SDKs yet.\n\n` +
        msg
          .split('\n')
          .map((l) => `  ${l}`)
          .join('\n') +
        `\n\n  Installation continues. Run \`yarn fetch-sdks\` before building —\n` +
        `  the iOS pod install and the Android build will fail with instructions if it is missing.\n`
    );
    process.exit(0);
  }
  console.error(`\n[react-native-intune] ${msg}\n`);
  process.exit(1);
}

/**
 * Turn a simple `**\/name` or `**\/name*.jar` pattern into a RegExp against a POSIX path.
 *
 * Tokens are substituted via placeholders rather than sequential string replacement:
 * replacing `*` after inserting the `**\/` expansion would corrupt the `*` inside it,
 * which silently breaks matching for nested paths.
 */
function globToRegExp(glob) {
  const ANY_DIRS = '\u0000';
  const ANY_SEG = '\u0001';
  const body = glob
    .replace(/\*\*\//g, ANY_DIRS)
    .replace(/\*/g, ANY_SEG)
    .replace(/[.+^${}()|[\]\\?]/g, '\\$&')
    .split(ANY_DIRS)
    .join('(?:[^\\0]*/)?')
    .split(ANY_SEG)
    .join('[^/]*');
  return new RegExp(`^${body}$`);
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs).split(path.sep).join('/');
    // An .xcframework is a directory but must be treated as a single artifact.
    if (entry.isDirectory() && !entry.name.endsWith('.xcframework')) {
      out.push({ rel, abs, dir: true });
      walk(abs, base, out);
    } else {
      out.push({ rel, abs, dir: entry.isDirectory() });
    }
  }
  return out;
}

function sha256OfPath(target) {
  const hash = createHash('sha256');
  const add = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(p).sort()) add(path.join(p, name));
    } else {
      hash.update(path.basename(p));
      hash.update(fs.readFileSync(p));
    }
  };
  add(target);
  return hash.digest('hex');
}

function copyInto(from, toRel, { executable = false } = {}) {
  const isDirTarget = toRel.endsWith('/');
  const dest = isDirTarget
    ? path.join(VENDOR, toRel, path.basename(from))
    : path.join(VENDOR, toRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(from, dest, { recursive: true });
  if (executable) fs.chmodSync(dest, 0o755);
  return dest;
}

/**
 * Mount a .dmg, copy one named file out of it, unmount. No-op off macOS.
 * Returns the destination path, or null when extraction was not possible.
 */
function extractFromDmg(dmgPath, innerName, destRel) {
  if (process.platform !== 'darwin') {
    log(`  (${path.basename(dmgPath)} kept as-is — extraction needs macOS)`);
    return null;
  }
  let mountPoint = null;
  try {
    const out = execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-plist', dmgPath], {
      encoding: 'utf8',
    });
    // Cheap plist scrape: the mount point is the only /Volumes path in the output.
    mountPoint = (out.match(/<string>(\/Volumes\/[^<]+)<\/string>/) ?? [])[1] ?? null;
    if (!mountPoint) throw new Error('could not determine the mount point');

    const found = walk(mountPoint).find((e) => !e.dir && path.basename(e.rel) === innerName);
    if (!found) throw new Error(`${innerName} was not inside the disk image`);

    return copyInto(found.abs, destRel, { executable: true });
  } catch (e) {
    warn(
      `Could not extract ${innerName} from ${path.basename(dmgPath)}: ${e.message}\n` +
        `  The disk image is at vendor/${path.relative(VENDOR, dmgPath)} — open it and copy\n` +
        `  ${innerName} to vendor/${destRel} by hand.`
    );
    return null;
  } finally {
    if (mountPoint) {
      try {
        execFileSync('hdiutil', ['detach', mountPoint, '-quiet'], { stdio: 'pipe' });
      } catch {
        /* leaving a volume mounted is not worth failing the install over */
      }
    }
  }
}

// ---------------------------------------------------------------- download

async function resolveTag(repo, tag) {
  if (tag && tag !== 'LATEST') return tag;
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      accept: 'application/vnd.github+json',
      // A token lifts the very low unauthenticated rate limit. Optional.
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    fail(
      `Could not resolve the latest release for ${repo} (HTTP ${res.status}).\n` +
        `  GitHub rate-limits unauthenticated requests aggressively. Either:\n` +
        `    - pin an explicit tag in sdk-versions.json (recommended), or\n` +
        `    - set GITHUB_TOKEN in your environment, or\n` +
        `    - download the SDK manually and place it under vendor/ (see README).`
    );
  }
  const json = await res.json();
  if (!json.tag_name) fail(`${repo} has no published releases to resolve.`);
  return json.tag_name;
}

/**
 * Download the source tarball for a tag and return the extraction directory.
 *
 * The tarball is used rather than release assets on purpose: both SDK repositories
 * carry the binaries in the repository tree, and asset naming has changed across
 * releases. Extracting the tree and locating artifacts by pattern is stable across
 * both layouts, so this keeps working when Microsoft reorganises a release.
 */
async function downloadTree(repo, tag) {
  const url = `https://codeload.github.com/${repo}/tar.gz/refs/tags/${encodeURIComponent(tag)}`;
  log(`fetching ${repo}@${tag}`);
  const res = await fetch(url);
  if (!res.ok) {
    fail(
      `Download failed for ${repo}@${tag} (HTTP ${res.status}).\n` +
        `  Check that the tag exists: https://github.com/${repo}/tags`
    );
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-intune-'));
  const tgz = path.join(tmp, 'sdk.tar.gz');
  fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  const out = path.join(tmp, 'src');
  fs.mkdirSync(out);
  try {
    execFileSync('tar', ['-xzf', tgz, '-C', out, '--strip-components=1'], { stdio: 'pipe' });
  } catch (e) {
    fail(`Could not extract the archive. Is the \`tar\` CLI available?\n  ${e.message}`);
  }
  fs.rmSync(tgz, { force: true });
  return { dir: out, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------- platform

async function fetchPlatform(name, cfg, lock) {
  const spec = cfg[name];
  const tag = await resolveTag(spec.repo, spec.tag);

  const satisfied =
    !FORCE &&
    lock[name]?.tag === tag &&
    spec.expect
      .filter((e) => e.required)
      .every((e) => fs.existsSync(path.join(VENDOR, e.as.replace(/\/$/, ''))));

  if (satisfied) {
    log(`${name}: already at ${tag}`);
    return { name, tag, skipped: true };
  }

  const { dir, cleanup } = await downloadTree(spec.repo, tag);
  try {
    const entries = walk(dir);

    if (PRINT_LAYOUT) {
      console.log(`\n--- ${spec.repo}@${tag} ---`);
      // Top level first, then the bundle/framework artifacts, then everything else.
      // Directories matter here: .xcframework and .bundle are single artifacts, and
      // hiding them would omit exactly the entries the globs need to match.
      const interesting = PRINT_ALL
        ? entries
        : entries.filter(
            (e) => !e.rel.includes('/') || /\.(xcframework|bundle|aar|jar|dmg)$/.test(e.rel)
          );
      for (const e of interesting.sort((a, b) => a.rel.localeCompare(b.rel))) {
        console.log(`   ${e.dir ? '[dir] ' : '      '}${e.rel}`);
      }
      const hidden = entries.length - interesting.length;
      if (hidden > 0) console.log(`   … ${hidden} nested files omitted (pass --print-layout-all to see them)`);
      return { name, tag, printed: true };
    }

    const resolved = {};
    const missing = [];

    for (const want of spec.expect) {
      const re = globToRegExp(want.glob);
      const hits = entries.filter((e) => re.test(e.rel));
      if (hits.length === 0) {
        if (want.required) missing.push(want.glob);
        continue;
      }
      // Shallowest path wins: repositories often ship a copy inside a sample app too.
      hits.sort((a, b) => a.rel.split('/').length - b.rel.split('/').length);
      for (const hit of want.as.endsWith('/') ? hits : [hits[0]]) {
        const dest = copyInto(hit.abs, want.as, { executable: want.executable });
        resolved[path.relative(VENDOR, dest)] = sha256OfPath(dest);
        log(`  ${path.relative(VENDOR, dest)}`);

        // Microsoft ships IntuneMAMConfigurator inside a .dmg. Mount it and take the
        // binary out so consumers can call it from an Xcode build phase. macOS only —
        // the dmg is kept either way so a Linux CI checkout is still complete.
        if (want.extractDmg) {
          const extracted = extractFromDmg(dest, want.extractDmg, want.extractAs);
          if (extracted) {
            resolved[path.relative(VENDOR, extracted)] = sha256OfPath(extracted);
            log(`  ${path.relative(VENDOR, extracted)}`);
          }
        }
      }
    }

    if (missing.length) {
      fail(
        `${spec.repo}@${tag} did not contain expected artifacts:\n` +
          missing.map((m) => `    ${m}`).join('\n') +
          `\n\n  Microsoft may have changed the release layout. Run:\n` +
          `    node scripts/fetch-sdks.mjs --platform ${name} --print-layout\n` +
          `  and update the "expect" globs in sdk-versions.json to match.`
      );
    }

    return { name, tag, files: resolved };
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------- check

function check(cfg, lock) {
  const problems = [];
  for (const name of ['ios', 'android']) {
    if (ONLY && ONLY !== name) continue;
    if (!lock[name]) {
      problems.push(`${name}: not fetched`);
      continue;
    }
    for (const want of cfg[name].expect.filter((e) => e.required)) {
      const target = path.join(VENDOR, want.as.replace(/\/$/, ''));
      if (!fs.existsSync(target)) problems.push(`${name}: missing ${want.as}`);
    }
    for (const [rel, expected] of Object.entries(lock[name].files ?? {})) {
      const target = path.join(VENDOR, rel);
      if (fs.existsSync(target) && sha256OfPath(target) !== expected) {
        problems.push(`${name}: ${rel} has been modified since it was fetched`);
      }
    }
  }

  if (problems.length) {
    console.error('\n[react-native-intune] vendor/ is incomplete:\n');
    for (const p of problems) console.error(`    ${p}`);
    console.error('\n  Run: npx react-native-intune fetch-sdks\n');
    process.exit(1);
  }
  log('vendor/ is complete');
}

// ---------------------------------------------------------------- main

async function main() {
  const cfg = readConfig();
  const lock = readLock();

  if (CHECK_ONLY) return check(cfg, lock);

  const platforms = ['ios', 'android'].filter((p) => !ONLY || ONLY === p);
  if (platforms.length === 0) fail(`--platform must be "ios" or "android", got "${ONLY}"`);

  // Only iOS artifacts are needed on a machine that cannot build for iOS anyway,
  // but fetching both keeps the lockfile meaningful and the download is one-time.
  if (!QUIET && !PRINT_LAYOUT) console.log(LICENCE_NOTICE);

  for (const name of platforms) {
    const result = await fetchPlatform(name, cfg, lock);
    if (result.printed) continue;
    if (result.skipped) continue;
    lock[name] = { repo: cfg[name].repo, tag: result.tag, fetchedAt: new Date().toISOString(), files: result.files };
    writeLock(lock);
  }

  if (!PRINT_LAYOUT) log('done — vendor/ ready');
}

main().catch((e) => fail(e?.stack ?? String(e)));
