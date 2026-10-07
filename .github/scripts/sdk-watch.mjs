#!/usr/bin/env node
/**
 * Opens an issue when Microsoft publishes a newer Intune SDK or MSAL than the one pinned.
 *
 * Why this exists: on 2026-09-30, three of the four pinned SDKs were already behind —
 * Intune iOS 21.9.0, MSAL iOS 2.16.0 and MSAL Android 8.5.0 had shipped between one and
 * three weeks earlier, and nothing here said so. Microsoft requires apps to stay on
 * recent SDKs and has blocked launches for apps that fell behind, so an unnoticed release
 * is a release this library's consumers cannot ship.
 *
 * None of these are on a registry Dependabot or Renovate can watch: the Intune SDKs are
 * files attached to GitHub releases, and the pins live in sdk-versions.json.
 *
 * **It watches release lines, not "the latest release".** Microsoft ships parallel lines
 * — 20.x for Xcode 16, 21.x for Xcode 26, 22.x for Xcode 27 — and on 2026-10-02 it
 * published 21.9.1 and 22.1.1 on the same day. The first version of this script asked
 * only for the latest release, saw 22.1.1, and never reported 21.9.1: a deadlock fix and
 * a first-launch black-screen fix on exactly the line this library pins. So, for each pin:
 *
 * - a newer release **in the same major** is an update for that line, one issue each;
 * - a **newer major** is reported once per major, from main only, because moving to it is
 *   a major version of this library and a decision rather than a bump.
 *
 * Pins are read from main and from every maintenance branch named like `1.x`, which keep
 * an older SDK line for people who cannot move with main. Those get same-line updates
 * only, titled with the branch.
 *
 * An issue for a version, open or closed, is never filed again, so closing one as "not
 * taking this release" is a decision that sticks.
 *
 * Runs from .github/workflows/sdk-watch.yml. Locally, without GITHUB_TOKEN, it only
 * reports what it would file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const REPO = process.env.GITHUB_REPOSITORY ?? 'bayazetyan/react-native-intune';
const TOKEN = process.env.GITHUB_TOKEN;
const LABEL = 'sdk-update';

/**
 * What to watch, read from one sdk-versions.json, and where each pin is written. `files`
 * is what a bump has to change, listed in the issue so nobody has to rediscover it.
 */
export function watched(pins) {
  return [
    {
      name: 'Intune App SDK for iOS',
      repo: pins.ios.repo,
      pinned: pins.ios.tag,
      files: [
        'sdk-versions.json → ios.tag',
        'sdk-lock.json (fetch-sdks rewrites it)',
      ],
    },
    {
      name: 'Intune App SDK for Android',
      repo: pins.android.repo,
      pinned: pins.android.tag,
      files: [
        'sdk-versions.json → android.tag, and toolchain.requires for its matrix row',
        'sdk-lock.json (fetch-sdks rewrites it)',
      ],
    },
    {
      name: 'MSAL for iOS',
      repo: 'AzureAD/microsoft-authentication-library-for-objc',
      pinned: pins.toolchain.msal_ios,
      files: [
        'sdk-versions.json → toolchain.msal_ios',
        'RNIntune.podspec → s.dependency "MSAL"',
      ],
    },
    {
      name: 'MSAL for Android',
      repo: 'AzureAD/microsoft-authentication-library-for-android',
      pinned: pins.toolchain.msal_android,
      files: [
        'sdk-versions.json → toolchain.msal_android',
        'android/build.gradle → com.microsoft.identity.client:msal',
      ],
    },
  ];
}

const clean = (tag) => String(tag).replace(/^v/i, '');
const parts = (v) => clean(v).split(/[.-]/).map(Number);
const major = (v) => parts(v)[0];

/** Numeric comparison of dotted versions; a prerelease suffix is ignored. */
export function newer(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) {
      return (pa[i] || 0) > (pb[i] || 0);
    }
  }
  return false;
}

const stable = (releases) => releases.filter((r) => !r.draft && !r.prerelease);
const newest = (releases) =>
  releases.reduce(
    (best, r) => (!best || newer(r.tag_name, best.tag_name) ? r : best),
    null
  );

/** The newest release in the pinned major that is newer than the pin, or null. */
export function newestInLine(releases, pinned) {
  return newest(
    stable(releases).filter(
      (r) => major(r.tag_name) === major(pinned) && newer(r.tag_name, pinned)
    )
  );
}

/** The newest release of a higher major than the pin, or null. */
export function newestAbove(releases, pinned) {
  return newest(
    stable(releases).filter((r) => major(r.tag_name) > major(pinned))
  );
}

async function github(url, options = {}) {
  const response = await fetch(`https://api.github.com${url}`, {
    ...options,
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok && response.status !== 422) {
    throw new Error(
      `${options.method ?? 'GET'} ${url}: ${response.status} ${await response.text()}`
    );
  }
  return response.status === 204 ? null : response.json();
}

/** Every issue this workflow has ever filed, open or closed, by title. */
async function filedTitles() {
  if (!TOKEN) {
    return new Set();
  }
  const titles = new Set();
  for (let page = 1; ; page += 1) {
    const issues = await github(
      `/repos/${REPO}/issues?labels=${LABEL}&state=all&per_page=100&page=${page}`
    );
    issues.forEach((i) => titles.add(i.title));
    if (issues.length < 100) {
      return titles;
    }
  }
}

/** main's pins, from the checkout, and each maintenance branch's, from the API. */
async function pinSources() {
  const sources = [
    {
      branch: 'main',
      pins: JSON.parse(
        fs.readFileSync(path.join(ROOT, 'sdk-versions.json'), 'utf8')
      ),
    },
  ];
  const branches = await github(`/repos/${REPO}/branches?per_page=100`);
  for (const { name } of branches.filter((b) => /^\d+\.x$/.test(b.name))) {
    const file = await github(
      `/repos/${REPO}/contents/sdk-versions.json?ref=${name}`
    );
    sources.push({
      branch: name,
      pins: JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')),
    });
  }
  return sources;
}

const excerpt = (release) => {
  const notes = (release.body ?? '').trim();
  return notes.length > 3000
    ? `${notes.slice(0, 3000)}\n\n… (truncated — see the release)`
    : notes;
};

const notesBlock = (release) => `<details><summary>Release notes</summary>

${excerpt(release) || '_The release has no notes._'}

</details>
`;

/** An update within the pinned line — a bump on the branch it names. */
const lineBody = (
  w,
  release,
  branch
) => `**${w.name} ${clean(release.tag_name)}** was released on ${release.published_at.slice(0, 10)}. \`${branch}\` pins **${w.pinned}**, and this is in the same line.

${release.html_url}

## Before bumping${branch === 'main' ? '' : ` — on \`${branch}\``}

- [ ] Read the release notes below for raised minimums — iOS, Xcode, Android, Gradle, AGP, Kotlin. **Raising any of them is a major version here**, because it breaks consumers' builds; otherwise this is a minor (new capability) or a patch (fixes only).
- [ ] Update the pin:
${w.files.map((f) => `  - ${f}`).join('\n')}
- [ ] \`yarn fetch-sdks\`, then \`yarn lint && yarn typecheck && yarn test\`
- [ ] \`yarn verify:bare\` and \`yarn verify:expo\` — both build debug and release from a packed tarball
- [ ] Enrollment on a device, through the broker, against the test tenant — a build proves nothing about the SDK's behaviour
- [ ] Anything the SDK changed that surprised you goes on the traps page

Closing this without bumping is a decision, not an oversight: this workflow never files an issue for the same version twice.

${notesBlock(release)}`;

/** A new major line — a decision about this library's next major, not a bump. */
const majorBody = (
  w,
  release
) => `**${w.name} ${major(release.tag_name)}.x** is out — newest ${clean(release.tag_name)}, released ${release.published_at.slice(0, 10)}. main pins **${w.pinned}**, line ${major(w.pinned)}.x.

${release.html_url}

A new major line of the SDK, reported once; updates within it are not reported here until a branch pins it. If it raises any minimum — iOS, Xcode, Android, Gradle, AGP, Kotlin — moving main to it is a **major version of this library**.

## When moving to it

- [ ] Read the release notes for what it requires, and what it says about the line it replaces
- [ ] Cut a maintenance branch from the last release tag, named after this library's current major (\`1.x\` for 1.y.z), so fixes on the ${major(w.pinned)}.x line keep shipping for people who cannot move — this workflow watches that branch's pins too
- [ ] Then move main's pins:
${w.files.map((f) => `  - ${f}`).join('\n')}
- [ ] Builds, \`verify:bare\` and \`verify:expo\`, and enrollment on a device through the broker
- [ ] The versioning page and the README status

${notesBlock(release)}`;

async function main() {
  const filed = await filedTitles();
  const releases = new Map();
  const releasesOf = async (repo) => {
    if (!releases.has(repo)) {
      releases.set(repo, await github(`/repos/${repo}/releases?per_page=100`));
    }
    return releases.get(repo);
  };

  if (TOKEN) {
    // Created once; 422 means it already exists.
    await github(`/repos/${REPO}/labels`, {
      method: 'POST',
      body: JSON.stringify({
        name: LABEL,
        color: 'd4a72c',
        description: 'A newer Microsoft SDK than the one pinned',
      }),
    });
  }

  const wanted = [];
  for (const { branch, pins } of await pinSources()) {
    const prefix = branch === 'main' ? '' : `[${branch}] `;
    for (const w of watched(pins)) {
      const all = await releasesOf(w.repo);

      const update = newestInLine(all, w.pinned);
      if (update) {
        wanted.push({
          title: `${prefix}${w.name} ${clean(update.tag_name)} is available (pinned: ${w.pinned})`,
          body: lineBody(w, update, branch),
        });
      } else {
        console.log(`${prefix}${w.name}: ${w.pinned} is current in its line`);
      }

      const above = branch === 'main' ? newestAbove(all, w.pinned) : null;
      if (above) {
        const line = `${w.name} ${major(above.tag_name)}.`;
        // Once per major. Anything already filed for that major counts, including an
        // issue from before this script knew about lines — "22.1.1 is available" is the
        // same question as "22.x is out".
        if ([...filed].some((t) => t.startsWith(line))) {
          console.log(
            `${w.name}: ${major(above.tag_name)}.x already has an issue`
          );
        } else {
          wanted.push({
            title: `${w.name} ${major(above.tag_name)}.x is available — a new major line (pinned: ${w.pinned})`,
            body: majorBody(w, above),
          });
        }
      }
    }
  }

  let opened = 0;
  for (const { title, body } of wanted) {
    if (filed.has(title)) {
      console.log(`already filed: ${title}`);
      continue;
    }
    if (!TOKEN) {
      console.log(`would file: ${title}`);
      continue;
    }
    const issue = await github(`/repos/${REPO}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title, body, labels: [LABEL] }),
    });
    console.log(`filed #${issue.number}: ${title}`);
    opened += 1;
  }
  console.log(`${opened} issue(s) filed`);
}

// Run only when executed, so the tests can import the pure functions above.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
