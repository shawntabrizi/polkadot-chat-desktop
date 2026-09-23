/**
 * The composer's command menu (M10 step 3): which of a peer's spec 0008
 * commands show while the draft is `/…`, and the keyboard selection. Pure,
 * so the rules have specs without a DOM.
 */

import type { BotCommand } from '../domain/chat/content';

/**
 * What follows the slash while the draft is a lone command word at the
 * start (`/`, `/sta`); null otherwise (no slash first, or a space typed:
 * the command is chosen and its arguments follow).
 */
export const commandQuery = (draft: string): string | null => {
  const match = /^\/(\S*)$/u.exec(draft);
  return match ? (match[1] ?? '') : null;
};

/**
 * The commands whose name contains the query, ignoring case: names that
 * start with it first, then the rest, each in the bot's own order.
 */
export const filterCommands = (commands: readonly BotCommand[], query: string): BotCommand[] => {
  const needle = query.toLowerCase();
  const starts = commands.filter(command => command.name.toLowerCase().startsWith(needle));
  const contains = commands.filter(command => !command.name.toLowerCase().startsWith(needle) && command.name.toLowerCase().includes(needle));
  return [...starts, ...contains];
};

/** ↑/↓ over `count` rows; wraps at both ends, as a menu does. */
export const moveSelection = (count: number, index: number, step: 1 | -1): number => (count === 0 ? 0 : (index + step + count) % count);

/** The draft after a pick: the command and a space, ready for its arguments. */
export const commandText = (command: BotCommand): string => `/${command.name} `;
