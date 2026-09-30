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
 * files attached to GitHub releases, and the pins live in sdk-versions.json. So this reads
 * the pins from there, asks GitHub for each repository's latest release, and files one
 * issue per newer version — once. An issue for a version, open or closed, is never filed
 * again, so closing one as "not taking this release" is a decision that sticks.
 *
 * Runs from .github/workflows/sdk-watch.yml. Locally, without GITHUB_TOKEN, it only
 * reports what it would file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const REPO = process.env.GITHUB_REPOSITORY ?? 'bayazetyan/react-native-intune';
const TOKEN = process.env.GITHUB_TOKEN;
const LABEL = 'sdk-update';

const pins = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'sdk-versions.json'), 'utf8')
);

/**
 * What to watch, and where each pin is written. `files` is what a bump has to change,
 * listed in the issue so nobody has to rediscover it.
 */
const WATCHED = [
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

const clean = (tag) => String(tag).replace(/^v/i, '');

/** Numeric comparison of dotted versions; a prerelease suffix is ignored. */
const newer = (a, b) => {
  const pa = clean(a).split(/[.-]/).map(Number);
  const pb = clean(b).split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) {
      return (pa[i] || 0) > (pb[i] || 0);
    }
  }
  return false;
};

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

const body = (w, release) => {
  const notes = (release.body ?? '').trim();
  const excerpt =
    notes.length > 3000
      ? `${notes.slice(0, 3000)}\n\n… (truncated — see the release)`
      : notes;
  return `**${w.name} ${clean(release.tag_name)}** was released on ${release.published_at.slice(0, 10)}. This repository pins **${w.pinned}**.

${release.html_url}

## Before bumping

- [ ] Read the release notes below for raised minimums — iOS, Xcode, Android, Gradle, AGP, Kotlin. **Raising any of them is a major version here**, because it breaks consumers' builds; otherwise this is a minor (new capability) or a patch (fixes only).
- [ ] Update the pin:
${w.files.map((f) => `  - ${f}`).join('\n')}
- [ ] \`yarn fetch-sdks\`, then \`yarn lint && yarn typecheck && yarn test\`
- [ ] \`yarn verify:bare\` and \`yarn verify:expo\` — both build debug and release from a packed tarball
- [ ] Enrollment on a device, through the broker, against the test tenant — a build proves nothing about the SDK's behaviour
- [ ] Anything the SDK changed that surprised you goes on the traps page

Closing this without bumping is a decision, not an oversight: this workflow never files an issue for the same version twice.

<details><summary>Release notes</summary>

${excerpt || '_The release has no notes._'}

</details>
`;
};

async function main() {
  const filed = await filedTitles();
  let opened = 0;

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

  for (const w of WATCHED) {
    const release = await github(`/repos/${w.repo}/releases/latest`);
    const latest = clean(release.tag_name);
    if (!newer(latest, w.pinned)) {
      console.log(`${w.name}: ${w.pinned} is current`);
      continue;
    }
    const title = `${w.name} ${latest} is available (pinned: ${w.pinned})`;
    if (filed.has(title)) {
      console.log(`${w.name}: ${latest} already has an issue`);
      continue;
    }
    if (!TOKEN) {
      console.log(`${w.name}: would file "${title}"`);
      continue;
    }
    const issue = await github(`/repos/${REPO}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title, body: body(w, release), labels: [LABEL] }),
    });
    console.log(`${w.name}: filed #${issue.number}`);
    opened += 1;
  }
  console.log(`${opened} issue(s) filed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
