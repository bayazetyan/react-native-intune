#!/usr/bin/env node
/**
 * Applies the changes `doctor` reports, on command and never automatically.
 *
 * These files live in the consumer's git. A script that edits them at install time
 * fights the developer's own changes, re-applies on every version bump, and produces
 * "why did my project change" reports — which is why mature libraries abandoned
 * install-time patching (SPEC §12.7).
 *
 * Usage:
 *   npx react-native-intune setup
 *   npx react-native-intune setup --yes       # no prompt, for CI
 *   npx react-native-intune setup --dry-run   # same as doctor
 *   npx react-native-intune setup --force     # allow a dirty git tree
 *
 * Exit code: non-zero while manual steps remain, so a partial setup cannot be mistaken
 * for a complete one. That is deliberate — the steps it cannot do are the ones that
 * leave the app unprotected.
 */

import fs from 'node:fs';
import readline from 'node:readline';
import { findProject, rel } from './lib/project.mjs';
import { gitIsClean, runChecks, summarise } from './doctor.mjs';

const args = process.argv.slice(2);
const flags = {
  yes: args.includes('--yes') || args.includes('-y'),
  dryRun: args.includes('--dry-run'),
  force: args.includes('--force'),
};

async function main() {
  if (flags.dryRun) {
    // Documented as equivalent to doctor, so it runs the same checks rather than a
    // second implementation that can drift out of agreement with it.
    const project = findProject();
    const s = summarise(runChecks(project));
    report(project, s);
    process.exit(s.blocking.length > 0 ? 1 : 0);
  }

  const project = findProject();

  if (project.isThisPackage) {
    fail(
      `This is react-native-intune's own repository, not a project that consumes it.\n\n` +
        `Applying the MAM Gradle plugin here is the mistake these commands exist to\n` +
        `catch: it rewrites only the library, builds cleanly, and protects nothing.\n` +
        `Run this from your app's project root instead.`
    );
  }

  if (!project.android && !project.ios) {
    fail(
      `No native project found under ${project.root}.\n` +
        `Run this from a React Native project root — the folder holding android/ or ios/.`
    );
  }

  const clean = gitIsClean(project.root);
  if (clean === false && !flags.force) {
    fail(
      `Your git tree has uncommitted changes.\n\n` +
        `This command edits files in your repository. Commit or stash first, so a\n` +
        `revert is one command away — or pass --force if you know what you are doing.`
    );
  }
  if (clean === null) {
    process.stdout.write(
      `Note: not a git repository, so there is no clean revert. Continuing.\n\n`
    );
  }

  const results = runChecks(project);
  const s = summarise(results);

  const edits = [];
  for (const r of s.failing) {
    if (typeof r.check.apply !== 'function') {
      continue;
    }
    const edit = r.check.apply(project);
    if (edit) {
      edits.push({ ...edit, check: r.check, before: fs.readFileSync(edit.file, 'utf8') });
    }
  }

  if (edits.length === 0) {
    process.stdout.write(
      s.failing.length === 0
        ? `Nothing to change — everything this tool can apply is already in place.\n\n`
        : `Nothing here can be applied automatically.\n\n`
    );
  } else {
    process.stdout.write(`\nThese files will change:\n\n`);
    for (const e of edits) {
      process.stdout.write(`  ${rel(project, e.file)}  — ${e.check.title}\n`);
      process.stdout.write(diff(e.before, e.contents));
    }

    if (!flags.yes && !(await confirm())) {
      process.stdout.write(`\nNothing written.\n\n`);
      process.exit(1);
    }

    for (const e of edits) {
      fs.writeFileSync(e.file, e.contents);
      process.stdout.write(`  wrote ${rel(project, e.file)}\n`);
    }
    process.stdout.write('\n');
  }

  // Re-inspect rather than assume the edits worked. A check that still fails after its
  // own apply is a bug worth surfacing here instead of at the next build.
  const after = summarise(runChecks(findProject()));
  report(project, after, { afterApply: true });
  process.exit(after.blocking.length > 0 ? 1 : 0);
}

function report(project, s, { afterApply = false } = {}) {
  if (s.failing.length === 0) {
    process.stdout.write(
      afterApply
        ? `Done. Everything this tool can check is in place.\n\n`
        : `Everything this tool can check is in place.\n\n`
    );
    return;
  }

  const manual = s.failing.filter((r) => typeof r.check.apply !== 'function');
  const stillBroken = s.failing.filter((r) => typeof r.check.apply === 'function');

  if (stillBroken.length > 0) {
    process.stdout.write(
      `Still failing after being applied — please report this:\n` +
        stillBroken.map((r) => `  - ${r.check.id}`).join('\n') +
        '\n\n'
    );
  }

  if (manual.length > 0) {
    process.stdout.write(
      `${manual.length} step${manual.length === 1 ? '' : 's'} left for you. ` +
        `They change your own source or need a value only you have:\n\n`
    );
    for (const r of manual) {
      const danger =
        r.check.severity === 'silent'
          ? '  This one builds and runs while leaving the app unprotected.\n'
          : '';
      process.stdout.write(
        `${r.check.title}\n${danger}\n` +
          r.check
            .instruction(project)
            .split('\n')
            .map((l) => (l.length > 0 ? `  ${l}` : l))
            .join('\n') +
          '\n\n'
      );
    }
    process.stdout.write(
      `Exiting non-zero while these remain, so a partial setup is not mistaken for a\n` +
        `complete one. Run \`npx react-native-intune doctor\` to re-check.\n\n`
    );
  }
}

/**
 * A unified-ish diff, good enough to read before agreeing to it.
 *
 * Deliberately not a dependency: this package ships to consumers, and a diff renderer
 * is not worth a supply-chain entry.
 */
function diff(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    // Find where the streams line up again, looking a bounded distance ahead. Enough
    // for inserted blocks, which is all these edits are.
    let resync = -1;
    for (let k = j; k < Math.min(b.length, j + 200); k += 1) {
      if (a[i] !== undefined && b[k] === a[i]) {
        resync = k;
        break;
      }
    }
    if (resync === -1) {
      if (a[i] !== undefined) {
        out.push(`      - ${a[i]}`);
        i += 1;
      }
      if (b[j] !== undefined) {
        out.push(`      + ${b[j]}`);
        j += 1;
      }
    } else {
      for (let k = j; k < resync; k += 1) {
        out.push(`      + ${b[k]}`);
      }
      j = resync;
    }
  }
  return out.length > 0 ? `${out.join('\n')}\n\n` : '      (no textual change)\n\n';
}

function confirm() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question('Apply these changes? [y/N] ', (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function fail(message) {
  process.stderr.write(`\n${message}\n\n`);
  process.exit(1);
}

main().catch((e) => fail(e.stack ?? String(e)));
