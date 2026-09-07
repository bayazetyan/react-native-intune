#!/usr/bin/env node
//
// Creates example/tenant.json from tenant.example.json when it is missing.
//
// Why a script rather than just gitignoring the file: Metro resolves imports statically,
// so an absent module fails the bundle even behind a try/catch. The file therefore has to
// exist on a fresh clone. It is created with placeholders rather than real values, so a
// contributor gets a build that runs and an obvious thing to fill in.
//
// Wired into the example's `start`, `ios` and `android` scripts, so there is nothing to
// remember and no README step to skip.

import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'tenant.json');
const template = join(here, '..', 'tenant.example.json');

if (existsSync(target)) {
  process.exit(0);
}

if (!existsSync(template)) {
  // Not fatal on its own, but the app will fail to bundle next, and this says why.
  console.error(
    '[react-native-intune] example/tenant.example.json is missing, so ' +
      'example/tenant.json cannot be created. The example app will not bundle.'
  );
  process.exit(1);
}

copyFileSync(template, target);

console.log(
  '\n[react-native-intune] Created example/tenant.json from the template.\n' +
    '  It is gitignored. Fill in tenantId and clientId from your own Entra app\n' +
    '  registration — see docs/tenant-setup.md if you do not have one yet.\n' +
    '  The app will start with the placeholders, and configure() will fail against them.\n'
);
