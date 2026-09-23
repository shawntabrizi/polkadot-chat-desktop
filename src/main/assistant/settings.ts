/**
 * Assistant settings on disk: `<userData>/assistant.json` holds the engine
 * (the proxy or a local agent CLI), the tools a CLI engine may use (none by
 * default), the model, the proxy base URL and the API key encrypted with
 * Electron `safeStorage` (as the identity mnemonic in `identity/store.ts`).
 * The key never leaves the main process; the renderer only learns whether
 * one is stored.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { app, safeStorage } from 'electron';

import { DEFAULT_BASE_URL, DEFAULT_MODEL } from './client';
import { type EngineId, isEngineId } from './engines/types';
import { type ToolCapability, createToolPolicy } from './toolPolicy';

type SettingsFile = {
  version: 1;
  model: string;
  baseUrl: string;
  /** base64 of the `safeStorage` ciphertext; null when no key is stored. */
  keyEncrypted: string | null;
  /** Absent in files written before M6: the proxy. */
  engine: EngineId;
  /** Canonical capability list (toolPolicy.ts); empty = tools off. */
  tools: ToolCapability[];
};

export type AssistantConfig = { model: string; baseUrl: string; key: string | undefined; engine: EngineId; tools: ToolCapability[] };

export type PublicAssistantSettings = { model: string; baseUrl: string; hasKey: boolean; envKey: boolean; engine: EngineId; tools: ToolCapability[] };

const settingsPath = (): string => join(app.getPath('userData'), 'assistant.json');

const DEFAULTS: SettingsFile = { version: 1, model: DEFAULT_MODEL, baseUrl: DEFAULT_BASE_URL, keyEncrypted: null, engine: 'proxy', tools: [] };

/** A stored list that no longer parses (hand-edited) means tools off, never more. */
const readTools = (value: unknown): ToolCapability[] => {
  if (!Array.isArray(value)) return [];
  try {
    return [...createToolPolicy({ capabilities: value.map(String) }).capabilities];
  } catch {
    return [];
  }
};

const readFile = (): SettingsFile => {
  const path = settingsPath();
  if (!existsSync(path)) return DEFAULTS;
  const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<SettingsFile> | null;
  return {
    version: 1,
    model: typeof value?.model === 'string' && value.model ? value.model : DEFAULT_MODEL,
    baseUrl: typeof value?.baseUrl === 'string' && value.baseUrl ? value.baseUrl : DEFAULT_BASE_URL,
    keyEncrypted: typeof value?.keyEncrypted === 'string' && value.keyEncrypted ? value.keyEncrypted : null,
    engine: isEngineId(value?.engine) ? value.engine : 'proxy',
    tools: readTools(value?.tools),
  };
};

const writeFile = (file: SettingsFile): void => {
  const target = settingsPath();
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, target);
};

/** What the renderer may see: no key, only whether one is stored. */
export const publicSettings = (): PublicAssistantSettings => {
  const file = readFile();
  return {
    model: file.model,
    baseUrl: file.baseUrl,
    hasKey: file.keyEncrypted !== null,
    envKey: Boolean(process.env.LLM_PROXY_KEY),
    engine: file.engine,
    tools: file.tools,
  };
};

/**
 * `key: ''` removes the stored key. A stored key needs the OS keychain: there
 * is no plaintext fallback, as for the mnemonic.
 */
export const updateSettings = (update: { model?: string; baseUrl?: string; key?: string; engine?: EngineId; tools?: readonly string[] }): void => {
  const file = readFile();
  let keyEncrypted = file.keyEncrypted;
  if (update.key !== undefined) {
    if (update.key === '') keyEncrypted = null;
    else {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('The system keychain is not available, so the API key cannot be stored safely.');
      }
      keyEncrypted = safeStorage.encryptString(update.key).toString('base64');
    }
  }
  writeFile({
    version: 1,
    model: update.model?.trim() || file.model,
    baseUrl: update.baseUrl?.trim() || file.baseUrl,
    keyEncrypted,
    engine: update.engine ?? file.engine,
    tools: update.tools ? [...createToolPolicy({ capabilities: update.tools }).capabilities] : file.tools,
  });
};

/** The config for one request. A stored key wins over `LLM_PROXY_KEY`. */
export const assistantConfig = (): AssistantConfig => {
  const file = readFile();
  const stored = file.keyEncrypted ? safeStorage.decryptString(Buffer.from(file.keyEncrypted, 'base64')) : undefined;
  return { model: file.model, baseUrl: file.baseUrl, key: stored ?? process.env.LLM_PROXY_KEY, engine: file.engine, tools: file.tools };
};
