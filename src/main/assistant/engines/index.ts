/** Every Assistant engine, by id. No `electron` import (the e2e script loads this in Node). */

import { claudeEngine } from './claude';
import { codexEngine } from './codex';
import { opencodeEngine } from './opencode';
import { proxyEngine } from './proxy';
import type { Engine, EngineId } from './types';

export const ENGINES: Record<EngineId, Engine> = {
  proxy: proxyEngine,
  claude: claudeEngine,
  codex: codexEngine,
  opencode: opencodeEngine,
};

export { ENGINE_IDS, isEngineId } from './types';
export type { Engine, EngineDetection, EngineEvent, EngineId, EngineRunInput, EngineRunResult, Turn } from './types';
