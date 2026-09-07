#!/usr/bin/env node
/**
 * Reports what the consumer's project still needs, and changes nothing.
 *
 * The value is not the checklist — it is that most of these failures name the wrong
 * cause when they happen. A missing keychain entitlement surfaces as an authorization
 * error, a missing URL type as an infinite login loop with an empty log, an unregistered
 * auth callback as a licensing-shaped status that retries quietly forever. Every one of
 * them was found on a real device rather than by reading documentation.
 *
 * Usage:
 *   npx react-native-intune doctor
 *   npx react-native-intune doctor --json     # machine-readable, for CI
 *
 * Exit code: 1 when anything blocking is missing or wrong, 0 otherwise. Two exclusions,
 * both deliberate. Advisories never fail the run, because a tool whose non-zero exit can
 * mean "nothing important" teaches people to ignore it — and the exit exists for the
 * class of failure that leaves an app unprotected while looking fine. Checks that could
 * not be inspected are reported and do not fail either — a Kotlin DSL build file this
 * tool cannot parse should not break someone's CI — but they are never counted as
 * passing.
 */

import { execFileSync } from 'node:child_process';
import { checks } from './lib/checks.mjs';
import { findProject, rel } from './lib/project.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');

const SEVERITY_LABEL = {
  silent: 'leaves the app unprotected',
  loud: 'breaks the build or the first sign-in',
  advisory: 'advisory',
};

export function runChecks(project) {
  return checks
    .filter((c) => project[c.platform] !== null)
    .map((c) => {
      let result;
      try {
        result = c.inspect(project);
      } catch (e) {
        // A check that throws is a bug in this tool, not a finding about the project.
        // Say which, so nobody spends an afternoon on their manifest.
        result = {
          state: 'unknown',
          detail: `check failed to run: ${e.message}`,
        };
      }
      return { check: c, ...result };
    });
}

export function summarise(results) {
  const failing = results.filter((r) => r.state === 'missing' || r.state === 'wrong');
  return {
    ok: results.filter((r) => r.state === 'ok').length,
    failing,
    /**
     * What decides the exit code — advisories are excluded on purpose.
     *
     * `advisory` is defined as worth knowing and not blocking, so letting one fail a
     * build would contradict the label and, worse, teach people that a non-zero exit
     * from this tool can be ignored. That habit is exactly what must not form: the
     * whole point of the non-zero exit is the `silent` class, where the app builds and
     * runs while protecting nothing.
     */
    blocking: failing.filter((r) => r.check.severity !== 'advisory'),
    unknown: results.filter((r) => r.state === 'unknown'),
    skipped: results.filter((r) => r.state === 'skip'),
    // Ordered so the dangerous class is read first, whatever order the checks are in.
    silent: failing.filter((r) => r.check.severity === 'silent'),
  };
}

function main() {
  const project = findProject();

  if (project.isThisPackage) {
    process.stdout.write(
      `This is react-native-intune's own repository, not a project that consumes it.\n\n` +
        `Applying the MAM Gradle plugin here is the mistake these commands exist to\n` +
        `catch: it rewrites only the library, builds cleanly, and protects nothing.\n` +
        `Run this from your app's project root instead.\n`
    );
    process.exit(1);
  }

  if (!project.android && !project.ios) {
    process.stdout.write(
      `No native project found under ${project.root}.\n` +
        `Run this from a React Native project root — the folder holding android/ or ios/.\n`
    );
    process.exit(1);
  }

  const results = runChecks(project);
  const s = summarise(results);

  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        {
          root: project.root,
          results: results.map((r) => ({
            id: r.check.id,
            platform: r.check.platform,
            severity: r.check.severity,
            state: r.state,
            detail: r.detail ?? null,
          })),
        },
        null,
        2
      ) + '\n'
    );
    process.exit(s.blocking.length > 0 ? 1 : 0);
  }

  process.stdout.write(`\nreact-native-intune doctor\n${project.root}\n`);

  for (const platform of ['ios', 'android']) {
    const forPlatform = results.filter((r) => r.check.platform === platform);
    if (forPlatform.length === 0) {
      continue;
    }
    process.stdout.write(`\n${platform === 'ios' ? 'iOS' : 'Android'}\n`);
    for (const r of forPlatform) {
      process.stdout.write(`  ${glyph(r.state)} ${r.check.title}${suffix(r)}\n`);
    }
  }

  if (s.failing.length === 0 && s.unknown.length === 0) {
    process.stdout.write(
      `\nEverything this tool can check is in place.\n\n` +
        `It cannot check the parts that live outside your project: that the account is\n` +
        `licensed for Intune, that an App Protection Policy targets this app, and that\n` +
        `a broker is installed on the device. Enrollment needs all three.\n\n`
    );
    process.exit(0);
  }

  if (s.silent.length > 0) {
    process.stdout.write(
      `\n${'─'.repeat(72)}\n` +
        `${s.silent.length} of these build and run while leaving the app unprotected.\n` +
        `Nothing fails, nothing logs, and everyone believes protection is in place.\n` +
        `${'─'.repeat(72)}\n`
    );
  }

  for (const r of [...s.silent, ...s.failing.filter((f) => !s.silent.includes(f))]) {
    process.stdout.write(
      `\n${r.check.title}\n` +
        `  ${SEVERITY_LABEL[r.check.severity]}${r.detail ? ` — ${r.detail}` : ''}\n\n` +
        `  ${r.check.why}\n\n` +
        indent(r.check.instruction(project)) +
        '\n'
    );
  }

  if (s.unknown.length > 0) {
    process.stdout.write(
      `\nNot verified — check these by hand:\n` +
        s.unknown
          .map((r) => `  - ${r.check.title}${r.detail ? ` (${r.detail})` : ''}`)
          .join('\n') +
        '\n'
    );
  }

  const applicable = s.failing.filter((r) => typeof r.check.apply === 'function');
  if (applicable.length > 0) {
    process.stdout.write(
      `\n${applicable.length} of the above can be applied for you:\n` +
        `  npx react-native-intune setup\n`
    );
  }

  process.stdout.write('\n');
  process.exit(s.blocking.length > 0 ? 1 : 0);
}

function glyph(state) {
  return { ok: 'ok  ', missing: 'MISS', wrong: 'WRONG', unknown: '?   ', skip: '--  ' }[
    state
  ];
}

function suffix(r) {
  if (r.state === 'ok') {
    return r.detail ? `  (${r.detail})` : '';
  }
  if (r.state === 'skip') {
    return r.detail ? `  ${r.detail}` : '';
  }
  return '';
}

function indent(text) {
  return text
    .split('\n')
    .map((l) => (l.length > 0 ? `  ${l}` : l))
    .join('\n');
}

/** Exported for `setup`, which refuses to edit files the developer cannot revert. */
export function gitIsClean(root) {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
      // Not a git repository is an outcome this function reports, not an error the user
      // needs to see git's own words for. Without this, "fatal: not a git repository"
      // leaks to the terminal and reads like the tool broke.
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().length === 0;
  } catch {
    // Not a git repository, or no git. Absence of a safety net is not the same as a
    // dirty tree, and refusing to run would be unhelpful — the caller decides.
    return null;
  }
}

export { rel };

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
