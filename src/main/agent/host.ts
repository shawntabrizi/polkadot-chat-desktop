/**
 * M13: the entry of the agent's Electron utility process. It gives
 * `node:crypto` the cipher bot-core needs (chachaShim.ts), then loads pca
 * bot-core (`PCD_BOT_CORE_ENTRY`, the package's index.mjs), which reads its
 * configuration from the environment and runs until the process is killed.
 */

import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';

import { installChachaShim } from './chachaShim';

installChachaShim(crypto as never);
syncBuiltinESMExports();

// A utility process drops empty environment values, and bot-core reads an
// empty BOT_ACK_TEXT as "no welcome text". PCD_EMPTY_ENV names them.
for (const name of (process.env.PCD_EMPTY_ENV ?? '').split(',')) if (name) process.env[name] = '';
delete process.env.PCD_EMPTY_ENV;

const entry = process.env.PCD_BOT_CORE_ENTRY;
if (!entry) {
  console.error('PCD_BOT_CORE_ENTRY is not set');
  process.exit(2);
}
delete process.env.PCD_BOT_CORE_ENTRY;
await import(pathToFileURL(entry).href);
