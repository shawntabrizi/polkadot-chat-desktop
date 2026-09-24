/**
 * M12i demo mode: one action that starts chats with the demo bots.
 *
 * Each bot, in order: look at what this device already has with it, resolve
 * the username on the People chain, then send a chat request whose first
 * message is "Hi!" (a pca bot does not greet an empty opener). The action is
 * idempotent: a bot with an open room, a pending request (either direction)
 * or a block gets nothing, and a bot already being sent to by an earlier
 * press is left to that press. A bot whose chat was deleted (M12e keeps the
 * contact) gets "Hi!" as a message, which brings the room back without a
 * second request.
 */

import { type HexString, bytesToHex } from '../../app/bytes';
import { type BlockedRow, type ContactRow, type RequestRow, type RoomRow, db } from '../../app/database';
import { type PeerIdentity, type UsernameResolver, canonicalUsername } from '../identity/lookup';

import type { DemoBot } from '../../../shared/demoBots';

/** The opener of every demo request: the bots answer a non-empty first message. */
export const DEMO_OPENER = 'Hi!';

/** A sent request with no accept after this long shows "No answer yet" (M12e wording). */
export const DEMO_NO_ANSWER_MS = 15_000;

/** What this device has for the demo bots: the rows the state is read from. */
export type DemoSnapshot = { contacts: ContactRow[]; rooms: RoomRow[]; requests: RequestRow[]; blocked: BlockedRow[] };

export const readDemoSnapshot = async (): Promise<DemoSnapshot> => {
  const [contacts, rooms, requests, blocked] = await Promise.all([db.contacts.toArray(), db.rooms.toArray(), db.requests.toArray(), db.blocked.toArray()]);
  return { contacts, rooms, requests, blocked };
};

export type DemoPeerState =
  | { kind: 'none' }
  /** A contact with a room: the chat is in the list. */
  | { kind: 'chatting'; peer: HexString }
  /** A contact whose chat was deleted on this device (M12e keeps the contact). */
  | { kind: 'contact'; peer: HexString }
  | { kind: 'pending'; peer: HexString; since: number }
  /** The bot sent us a request that waits in Requests. */
  | { kind: 'incoming'; peer: HexString }
  | { kind: 'blocked'; peer: HexString };

/** The bot's state by its username, or by its account once it is resolved. */
export const demoPeerState = (snapshot: DemoSnapshot, username: string, account: HexString | null = null): DemoPeerState => {
  const name = canonicalUsername(username);
  const same = (rowName: string, rowAccount: string) => canonicalUsername(rowName) === name || (account !== null && rowAccount === account);
  const blocked = snapshot.blocked.find(row => same(row.username, row.accountId));
  if (blocked) return { kind: 'blocked', peer: blocked.accountId };
  const contact = snapshot.contacts.find(row => same(row.username, row.accountId));
  if (contact) {
    const room = snapshot.rooms.some(row => row.peerAccountId === contact.accountId);
    return room ? { kind: 'chatting', peer: contact.accountId } : { kind: 'contact', peer: contact.accountId };
  }
  const pending = snapshot.requests.filter(row => row.status === 'pending' && same(row.peerUsername, row.peerAccountId));
  const outgoing = pending.find(row => row.direction === 'outgoing');
  if (outgoing) return { kind: 'pending', peer: outgoing.peerAccountId, since: outgoing.createdAt };
  const incoming = pending.find(row => row.direction === 'incoming');
  if (incoming) return { kind: 'incoming', peer: incoming.peerAccountId };
  return { kind: 'none' };
};

/** Nothing new goes out for these: the demo action would be a second request. */
const settled = (state: DemoPeerState): boolean => state.kind === 'chatting' || state.kind === 'pending' || state.kind === 'incoming' || state.kind === 'blocked';

/**
 * - `sent`: a chat request with the opener went out.
 * - `resumed`: the bot was a contact with no room; the opener went as a message.
 * - `skipped`: a room, a pending request or a block exists, or another press is sending.
 * - `notOnNetwork`: no one owns the username here, or the account has no chat key.
 * - `failed`: a chain read or the send failed; pressing again tries again.
 */
export type DemoOutcome = 'sent' | 'resumed' | 'skipped' | 'notOnNetwork' | 'failed';

export type DemoDeps = {
  snapshot: () => Promise<DemoSnapshot>;
  resolveUsername: UsernameResolver;
  getPeerIdentity: (accountId: Uint8Array) => Promise<PeerIdentity | null>;
  sendRequest: (peer: PeerIdentity, welcomeMessage: string) => Promise<void>;
  sendMessage: (peer: HexString, text: string) => Promise<void>;
};

export type DemoProgress = (username: string, step: DemoOutcome | 'sending', detail?: string) => void;

// Usernames a press is working on now, across every screen (onboarding and
// Settings can both press before the first request row exists).
const inFlight = new Set<string>();

const startOne = async (bot: DemoBot, deps: DemoDeps): Promise<DemoOutcome> => {
  if (settled(demoPeerState(await deps.snapshot(), bot.username))) return 'skipped';
  const accountId = await deps.resolveUsername(bot.username);
  if (!accountId) return 'notOnNetwork';
  const account = bytesToHex(accountId);
  const state = demoPeerState(await deps.snapshot(), bot.username, account);
  if (settled(state)) return 'skipped';
  if (state.kind === 'contact') {
    await deps.sendMessage(state.peer, DEMO_OPENER);
    return 'resumed';
  }
  const peer = await deps.getPeerIdentity(accountId);
  if (!peer) return 'notOnNetwork';
  await deps.sendRequest(peer, DEMO_OPENER);
  return 'sent';
};

/** Starts chats with `bots` in order. One bot's failure does not stop the others. */
export const startDemoChats = async (bots: readonly DemoBot[], deps: DemoDeps, onProgress: DemoProgress = () => undefined): Promise<Map<string, DemoOutcome>> => {
  const outcomes = new Map<string, DemoOutcome>();
  for (const bot of bots) {
    const key = canonicalUsername(bot.username);
    if (inFlight.has(key)) {
      outcomes.set(bot.username, 'skipped');
      onProgress(bot.username, 'skipped');
      continue;
    }
    inFlight.add(key);
    onProgress(bot.username, 'sending');
    try {
      const outcome = await startOne(bot, deps);
      outcomes.set(bot.username, outcome);
      onProgress(bot.username, outcome);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn('[demo] %s: %s', bot.username, detail);
      outcomes.set(bot.username, 'failed');
      onProgress(bot.username, 'failed', detail);
    } finally {
      inFlight.delete(key);
    }
  }
  return outcomes;
};

/** What a row shows. The database wins over the press's own record, which only fills the gaps. */
export type DemoRowStatus = 'idle' | 'sending' | 'sent' | 'noAnswer' | 'chatting' | 'incoming' | 'blocked' | 'notOnNetwork' | 'failed';

export const demoRowStatus = (state: DemoPeerState, local: DemoOutcome | 'sending' | undefined, now: number): DemoRowStatus => {
  switch (state.kind) {
    case 'chatting':
      return 'chatting';
    case 'pending':
      return now - state.since < DEMO_NO_ANSWER_MS ? 'sent' : 'noAnswer';
    case 'incoming':
      return 'incoming';
    case 'blocked':
      return 'blocked';
    case 'contact':
    case 'none':
      break;
  }
  switch (local) {
    case 'sending':
      return 'sending';
    case 'sent':
    case 'resumed':
      return 'sent';
    case 'notOnNetwork':
      return 'notOnNetwork';
    case 'failed':
      return 'failed';
    case 'skipped':
    case undefined:
      return 'idle';
  }
};

/** The demo chats "Remove demo chats" deletes: open rooms and pending requests of the bots. */
export const demoChatsToRemove = (snapshot: DemoSnapshot, bots: readonly DemoBot[]): { peer: HexString; username: string }[] =>
  bots.flatMap(bot => {
    const state = demoPeerState(snapshot, bot.username);
    return state.kind === 'chatting' || state.kind === 'pending' ? [{ peer: state.peer, username: bot.username }] : [];
  });
