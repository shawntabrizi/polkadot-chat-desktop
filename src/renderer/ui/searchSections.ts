/**
 * The unified search in the left pane (M7b): which rows each section shows,
 * the one keyboard order across the sections, and the message snippet. Pure,
 * so the rules have specs without a DOM.
 */

import { bytesToHex } from '../app/bytes';
import type { SearchResult } from '../domain/identity/search';

/** The global search waits for a pause and this many letters: each search mines a proof of work. */
export const GLOBAL_SEARCH_MIN_LENGTH = 3;
export const GLOBAL_SEARCH_DELAY_MS = 400;
/** Rows per global page; "Show more" fetches the next page. */
export const GLOBAL_PAGE_SIZE = 8;
/** Recent contacts under the empty field after "+" (M7b step 3). */
export const RECENT_LIMIT = 5;

export const normalizeQuery = (query: string): string => query.trim().toLowerCase();

/** A chat or contact matches when its name contains the query, ignoring case. */
export const chatMatches = (name: string, query: string): boolean => {
  const needle = normalizeQuery(query);
  return needle === '' || name.toLowerCase().includes(needle);
};

/** The query the network search takes, or null while it is too short. */
export const globalQuery = (query: string): string | null => {
  const prefix = normalizeQuery(query);
  return prefix.length >= GLOBAL_SEARCH_MIN_LENGTH ? prefix : null;
};

export type ChatHit = { key: string; peer: string };
export type MessageHit = { messageId: string };

export type Sections<C extends ChatHit, M extends MessageHit> = {
  chats: C[];
  global: SearchResult[];
  messages: M[];
  /** Keyboard order: every row of every section, top to bottom. */
  order: string[];
};

export const resultKey = {
  chat: (hit: ChatHit): string => `chat:${hit.key}`,
  global: (hit: SearchResult): string => `global:${hit.candidateAccountId}`,
  message: (hit: MessageHit): string => `message:${hit.messageId}`,
};

/**
 * Chats and contacts first, then global hits that are not already in the
 * first section (the same person twice reads as two people), then messages.
 */
export const assembleSections = <C extends ChatHit, M extends MessageHit>(chats: C[], global: SearchResult[], messages: M[]): Sections<C, M> => {
  const local = new Set(chats.map(hit => hit.peer));
  const others = global.filter(hit => !local.has(bytesToHex(hit.accountId)));
  return {
    chats,
    global: others,
    messages,
    order: [...chats.map(resultKey.chat), ...others.map(resultKey.global), ...messages.map(resultKey.message)],
  };
};

/** ↑/↓ over the order; from nothing, ↓ takes the first row and ↑ the last. Stops at the ends. */
export const moveHighlight = (order: readonly string[], current: string | null, step: 1 | -1): string | null => {
  if (order.length === 0) return null;
  const index = current === null ? -1 : order.indexOf(current);
  if (index === -1) return (step === 1 ? order[0] : order.at(-1)) ?? null;
  return order[Math.min(order.length - 1, Math.max(0, index + step))] ?? null;
};

export type Snippet = { before: string; match: string; after: string };

/** Characters kept before the match, so it stays visible in a one-line row. */
const SNIPPET_LEAD = 24;

/** One line of the message around the first match; the match is shown bold. */
export const snippetOf = (text: string, query: string): Snippet => {
  const line = text.replace(/\s+/g, ' ').trim();
  const needle = normalizeQuery(query);
  const at = needle === '' ? -1 : line.toLowerCase().indexOf(needle);
  if (at === -1) return { before: line, match: '', after: '' };
  const start = Math.max(0, at - SNIPPET_LEAD);
  return {
    before: `${start > 0 ? '…' : ''}${line.slice(start, at)}`,
    match: line.slice(at, at + needle.length),
    after: line.slice(at + needle.length),
  };
};
