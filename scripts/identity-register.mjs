#!/usr/bin/env node
// Register a desktop identity without Electron, for tests:
//   npm run identity:register -- <username> [--profile devnet|paseo]
// Runs the main-process flow (src/main/identity/service.ts) through tsx. The
// store is a plain file, .agent-runs/identity-<name>/identity.json (git-ignored,
// mode 0600), instead of Electron safeStorage. Prints no secret.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tsImport } from 'tsx/esm/api';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (path) => tsImport(join(root, path), import.meta.url);

const args = process.argv.slice(2);
const profileAt = args.indexOf('--profile');
const profile = profileAt >= 0 ? args[profileAt + 1] : 'devnet';
const rawName = args.find((arg, i) => !arg.startsWith('--') && (profileAt < 0 || i !== profileAt + 1));
if (!rawName) {
  console.error('usage: npm run identity:register -- <username> [--profile devnet|paseo]');
  process.exit(2);
}
if (profile !== 'devnet' && profile !== 'paseo') {
  console.error(`unknown profile "${profile}" (devnet or paseo)`);
  process.exit(2);
}

// The backend takes letters only. Test runs make names unique with a random
// number (pcdtest1234), so digits are spelled as letters (0 -> a ... 9 -> j).
const username = rawName.replace(/\d/g, (d) => String.fromCharCode(97 + Number(d)));
if (username !== rawName) console.log(`note: usernames are letters only; using ${username} for ${rawName}`);

const dir = join(root, '.agent-runs', `identity-${username}`);
const file = join(dir, 'identity.json');
const store = {
  load: () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null),
  save: (identity) => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file, `${JSON.stringify({ version: 1, ...identity }, null, 2)}\n`, { mode: 0o600 });
  },
};

const { createIdentity } = await load('src/main/identity/service.ts');
const { withPeopleDirectory } = await load('src/main/identity/directory.ts');

let last = null;
const onProgress = (line) => {
  if (line === last) process.stdout.write('.');
  else process.stdout.write(`${last ? '\n' : ''}${line}`);
  last = line;
};

let result;
try {
  result = await createIdentity({ username, digits: null, profile, onProgress, store });
} catch (error) {
  console.log(`\nREGISTER_FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
console.log('');
console.log(`profile ${profile}`);
console.log(`username ${result.username}`);
console.log(`accountHex ${result.accountHex}`);
console.log(`identifierKeyHex ${result.identifierKeyHex}`);
console.log(`confirmed ${result.confirmed}`);
console.log(`identity file ${file}`);

const key = await withPeopleDirectory(profile, (directory) => directory.identifierKeyFor(result.accountHex)).catch((error) => {
  console.log(`DIRECTORY_FAIL ${error instanceof Error ? error.message : String(error)}`);
  return null;
});
if (key == null) {
  console.log('NOT_ON_CHAIN');
  process.exit(1);
}
console.log(`ON_CHAIN key_type=${Number.parseInt(key.slice(2, 4), 16)}`);
console.log(`on-chain identifierKey matches: ${key === result.identifierKeyHex}`);
process.exit(0);
