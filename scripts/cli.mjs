#!/usr/bin/env node
/**
 * `npx react-native-intune <command>`.
 *
 * Three commands, and the split between them is the point (SPEC §12.7): `doctor` reads
 * and reports, `setup` writes only when asked, `fetch-sdks` touches nothing but this
 * package's own vendor directory. Nothing here ever runs from `postinstall` except
 * `fetch-sdks`, which is why that one is safe to.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const COMMANDS = {
  doctor: {
    script: 'doctor.mjs',
    summary: 'report what your project still needs; changes nothing',
  },
  setup: {
    script: 'setup.mjs',
    summary: 'apply what can be applied, and print the rest',
  },
  'fetch-sdks': {
    script: 'fetch-sdks.mjs',
    summary: "download the pinned Microsoft SDKs into this package's vendor/",
  },
};

const [command, ...rest] = process.argv.slice(2);

if (!command || command === '--help' || command === '-h' || command === 'help') {
  usage();
  process.exit(command ? 0 : 1);
}

if (command === '--version' || command === '-v') {
  const pkg = await import('node:fs').then((fs) =>
    JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'))
  );
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

const entry = COMMANDS[command];
if (!entry) {
  process.stderr.write(`Unknown command: ${command}\n\n`);
  usage();
  process.exit(1);
}

// Spawned rather than imported so each command keeps its own exit code, and so a crash
// in one cannot take the router's error reporting with it.
const result = spawnSync(process.execPath, [path.join(HERE, entry.script), ...rest], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);

function usage() {
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  process.stdout.write(
    `\nreact-native-intune\n\n` +
      `Usage: npx react-native-intune <command>\n\n` +
      Object.entries(COMMANDS)
        .map(([name, c]) => `  ${name.padEnd(width)}  ${c.summary}\n`)
        .join('') +
      `\nStart with \`doctor\`. It is read-only, and most Intune setup mistakes fail\n` +
      `later with an error naming the wrong cause.\n\n`
  );
}
