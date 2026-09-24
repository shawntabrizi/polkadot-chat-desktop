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
import { type IdentityLookup, type PeerIdentity, type UsernameResolver, canonicalUsername } from '../identity/lookup';
import { readUserIdentity } from '../identity/userIdentity';

import type { DemoBot } from '../../../shared/demoBots';

/** The opener of every demo request: the bots answer a non-empty first message. */
export const DEMO_OPENER = 'Hi!';

/** A sent request with no accept after this long shows "No answer yet" (M12e wording). */
export const DEMO_NO_ANSWER_MS = 15_000;

/**
 * Before the first request: how often and how long to look for this
 * identity's identifier key on the People chain. A bot drops a request whose
 * sender has no key it can read (seen live: a sign-up 17 s old lost all seven
 * requests), so nothing goes out until the key is there.
 */
export const DEMO_KEY_POLL_MS = 2_000;
export const DEMO_KEY_WAIT_MS = 90_000;

/** The wait for the key: `reads` counts chain reads, so `reads > 1` means it was not there at once. */
export type DemoKeyWait = { visible: boolean; waitedMs: number; reads: number };

/**
 * True when this identity's identifier key reads back from the People chain
 * through the app's lookup (best block, like every read here). A failed read
 * counts as not visible: the wait asks again.
 */
export const selfKeyVisibleVia =
  (lookup: IdentityLookup) =>
  async (): Promise<boolean> => {
    const self = await readUserIdentity();
    return self !== null && (await lookup.getPeerIdentity(self.identityAccountId)) !== null;
  };

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
 * - `notRegistered`: this identity's key was not on the chain within
 *   `DEMO_KEY_WAIT_MS`; nothing went out, and pressing again tries again.
 */
export type DemoOutcome = 'sent' | 'resumed' | 'skipped' | 'notOnNetwork' | 'failed' | 'notRegistered';

export type DemoDeps = {
  snapshot: () => Promise<DemoSnapshot>;
  resolveUsername: UsernameResolver;
  getPeerIdentity: (accountId: Uint8Array) => Promise<PeerIdentity | null>;
  sendRequest: (peer: PeerIdentity, welcomeMessage: string) => Promise<void>;
  sendMessage: (peer: HexString, text: string) => Promise<void>;
  /** Whether this identity's identifier key reads back from the People chain now (`selfKeyVisibleVia`). */
  selfKeyVisible: () => Promise<boolean>;
};

/** `waiting`: the action waits for this identity's key before it sends anything. */
export type DemoProgress = (username: string, step: DemoOutcome | 'sending' | 'waiting', detail?: string) => void;

const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Asks every `DEMO_KEY_POLL_MS` until the key is visible or `DEMO_KEY_WAIT_MS` has passed. */
const waitForSelfKey = async (deps: DemoDeps, onWaiting: () => void): Promise<DemoKeyWait> => {
  const start = Date.now();
  let reads = 0;
  for (;;) {
    reads += 1;
    const visible = await deps.selfKeyVisible().catch(() => false);
    if (visible) return { visible, waitedMs: Date.now() - start, reads };
    if (reads === 1) onWaiting();
    if (Date.now() - start + DEMO_KEY_POLL_MS > DEMO_KEY_WAIT_MS) return { visible: false, waitedMs: Date.now() - start, reads };
    await pause(DEMO_KEY_POLL_MS);
  }
};

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

/**
 * Starts chats with `bots` in order, once this identity's key is visible on
 * the chain. One bot's failure does not stop the others. `onKeyWait` hears
 * how the wait for the key ended.
 */
export const startDemoChats = async (
  bots: readonly DemoBot[],
  deps: DemoDeps,
  onProgress: DemoProgress = () => undefined,
  onKeyWait: (wait: DemoKeyWait) => void = () => undefined,
): Promise<Map<string, DemoOutcome>> => {
  const outcomes = new Map<string, DemoOutcome>();
  const wait = await waitForSelfKey(deps, () => bots.forEach(bot => onProgress(bot.username, 'waiting')));
  onKeyWait(wait);
  if (!wait.visible) {
    console.warn('[demo] this identity has no key on the People chain after %d s; nothing sent', Math.round(wait.waitedMs / 1000));
    for (const bot of bots) {
      outcomes.set(bot.username, 'notRegistered');
      onProgress(bot.username, 'notRegistered');
    }
    return outcomes;
  }
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
export type DemoRowStatus = 'idle' | 'waiting' | 'sending' | 'sent' | 'noAnswer' | 'chatting' | 'incoming' | 'blocked' | 'notOnNetwork' | 'failed';

export const demoRowStatus = (state: DemoPeerState, local: DemoOutcome | 'sending' | 'waiting' | undefined, now: number): DemoRowStatus => {
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
    case 'waiting':
      return 'waiting';
    case 'sending':
      return 'sending';
    case 'sent':
    case 'resumed':
      return 'sent';
    case 'notOnNetwork':
      return 'notOnNetwork';
    case 'failed':
      return 'failed';
    // The pane says why nothing went out; the rows stay ready for another press.
    case 'notRegistered':
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
