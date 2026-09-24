/**
 * M12i demo mode: the bots a new person can talk to without discovering
 * anyone. The built-in list is the fallback; `PCD_DEMO_MANIFEST_URL` may point
 * to a JSON of the same shape (`{ "devnet": [...], "paseo": [...] }`), which
 * the main process fetches and checks with `parseDemoManifest`.
 *
 * Usernames come from the bots' pca configs (`~/.pca/bots/<bot>/config.json`,
 * read 2026-09-24); they all run on the owner's VPS on devnet.
 */

import type { NetworkProfileId } from './network';

export type DemoBotTag = 'assistant' | 'game' | 'payments' | 'utility';

export type DemoBot = { username: string; tagline: string; tag: DemoBotTag };

export type DemoManifest = Record<NetworkProfileId, readonly DemoBot[]>;

export const DEMO_BOT_TAGS: readonly DemoBotTag[] = ['assistant', 'game', 'payments', 'utility'];

export const DEMO_TAG_LABELS: Record<DemoBotTag, string> = {
  assistant: 'Assistant',
  game: 'Game',
  payments: 'Payments',
  utility: 'Utility',
};

export const BUILT_IN_DEMO_BOTS: DemoManifest = {
  devnet: [
    { username: 'pcdpirate.81', tagline: 'Captain Dot — a pirate who jokes', tag: 'assistant' },
    { username: 'pcdguide.70', tagline: 'Guide — Polkadot support with buttons', tag: 'assistant' },
    { username: 'pcdmeter.01', tagline: 'Meter — a paid assistant, 0.1 PAS per reply', tag: 'payments' },
    { username: 'pcdflip.44', tagline: 'Flip — coin flips for 0.5 PAS', tag: 'game' },
    { username: 'pcdfaucet.77', tagline: 'Faucet bot — test funds', tag: 'utility' },
    { username: 'pcdpeer.47', tagline: 'Echo — repeats what you say', tag: 'utility' },
    { username: 'pcdcolor.05', tagline: 'Color — answers with a colour', tag: 'utility' },
  ],
  // No demo bots run on Paseo: the onboarding step and Settings › Demo are hidden.
  paseo: [],
};

/** Limits of a fetched manifest (a trust boundary: it names who the app sends requests to). */
export const DEMO_MANIFEST_LIMITS = { maxBytes: 64 * 1024, maxBots: 20, maxTagline: 80 } as const;

/** A lite username as the chain stores it: letters, a dot, two digits. */
const USERNAME = /^[a-z]{1,29}\.\d{2}$/;

const parseBot = (value: unknown): DemoBot | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { username, tagline, tag } = value as Record<string, unknown>;
  if (typeof username !== 'string' || !USERNAME.test(username)) return null;
  if (typeof tagline !== 'string') return null;
  const text = tagline.trim();
  if (text === '' || text.length > DEMO_MANIFEST_LIMITS.maxTagline) return null;
  if (typeof tag !== 'string' || !DEMO_BOT_TAGS.includes(tag as DemoBotTag)) return null;
  return { username, tagline: text, tag: tag as DemoBotTag };
};

const parseList = (value: unknown): DemoBot[] | null => {
  if (!Array.isArray(value) || value.length > DEMO_MANIFEST_LIMITS.maxBots) return null;
  const bots = value.map(parseBot);
  if (bots.some(bot => bot === null)) return null;
  const valid = bots as DemoBot[];
  if (new Set(valid.map(bot => bot.username)).size !== valid.length) return null;
  return valid;
};

/**
 * Checks a fetched manifest. The rules (docs/decisions.md "## M12i"):
 * - the body is a JSON object; keys other than `devnet` and `paseo` are ignored;
 * - a profile key that is present holds an array of at most 20 bots; a missing
 *   key keeps the built-in list of that profile;
 * - each bot has exactly the three fields in use: `username` (`name.NN`,
 *   lowercase letters, two digits), `tagline` (1–80 characters after trim),
 *   `tag` (one of the four tags); extra fields are ignored;
 * - no username twice in one list.
 * Any broken list makes the whole manifest invalid (`null`): the caller then
 * uses the built-in list, so a half-valid file never mixes with it.
 */
export const parseDemoManifest = (value: unknown, fallback: DemoManifest = BUILT_IN_DEMO_BOTS): DemoManifest | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const result: Record<NetworkProfileId, readonly DemoBot[]> = { ...fallback };
  for (const profile of Object.keys(fallback) as NetworkProfileId[]) {
    if (!(profile in record)) continue;
    const list = parseList(record[profile]);
    if (!list) return null;
    result[profile] = list;
  }
  return result;
};
