/**
 * Which profile takes a group invite link that macOS gives to the app
 * (docs/questions.md M18 "Invite links with several processes"). macOS gives
 * a `polkadot-chat://` link to one running process, not to a chosen profile.
 * So with more than one profile the app asks first: "Which profile should
 * join?". The chosen profile gets the link as `--open-link <url>`: a running
 * profile gets it through `second-instance`, a closed one at its start.
 *
 * Plain Node (no Electron import), so the rules run in a spec.
 */

import { isGroupInviteUrl } from '../shared/openUrl';

import type { ProfilesFile } from './profiles';

export const OPEN_LINK_FLAG = '--open-link';

/** `--open-link <url>` or `--open-link=<url>`, when it holds a group invite link. */
export const openLinkFlag = (argv: readonly string[]): string | null => {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const value = arg === OPEN_LINK_FLAG ? argv[i + 1] : arg.startsWith(`${OPEN_LINK_FLAG}=`) ? arg.slice(OPEN_LINK_FLAG.length + 1) : undefined;
    if (value !== undefined) return isGroupInviteUrl(value) ? value.trim() : null;
  }
  return null;
};

/** `argv` without `--open-link` and its value (a relaunch must not open the link again). */
export const withoutOpenLink = (argv: readonly string[]): string[] =>
  argv.filter((arg, index) => arg !== OPEN_LINK_FLAG && !arg.startsWith(`${OPEN_LINK_FLAG}=`) && argv[index - 1] !== OPEN_LINK_FLAG);

export type InviteChoice = { name: string; label: string };

/**
 * The buttons of the question, or null when there is nothing to ask (one
 * profile or none). The label is what the picker shows first: the username,
 * else the rename, else the folder name. This window's profile comes first.
 */
export const inviteChoices = (file: ProfilesFile | null, current: string | null): InviteChoice[] | null => {
  if (!file || file.profiles.length < 2) return null;
  const choices = file.profiles.map(entry => {
    const label = entry.username ?? entry.label ?? entry.name;
    return { name: entry.name, label: entry.name === current ? `${label} (this window)` : label };
  });
  return [...choices.filter(choice => choice.name === current), ...choices.filter(choice => choice.name !== current)];
};

export type InviteRoute = { kind: 'here' } | { kind: 'profile'; name: string } | { kind: 'cancel' };

/** The answer to the question: a button index, or the Cancel button after the last choice. */
export const inviteRouteOf = (choices: InviteChoice[], response: number, current: string | null): InviteRoute => {
  const choice = choices[response];
  if (!choice) return { kind: 'cancel' };
  return choice.name === current ? { kind: 'here' } : { kind: 'profile', name: choice.name };
};
