/**
 * M12i demo mode. Why these rules matter:
 * - A second press (or the onboarding and Settings both pressing) must not
 *   send a second request: a bot answers each request, so a double request
 *   is a double greeting, and on a paid bot a confusing chat.
 * - A username that does not resolve (a bot renamed, the wrong network) is
 *   skipped and reported; it must not stop the bots after it.
 * - The opener is never empty: pca bots do not greet an empty first message,
 *   so an empty opener leaves the new person looking at a silent chat.
 * - A bot that does not answer reads "No answer yet" (M12e), never an error.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { type HexString, bytesToHex } from '../../app/bytes';
import { appDatabase, db } from '../../app/database';
import type { PeerIdentity } from '../identity/lookup';

import type { DemoBot } from '../../../shared/demoBots';

import {
  DEMO_NO_ANSWER_MS,
  DEMO_OPENER,
  type DemoDeps,
  type DemoSnapshot,
  demoChatsToRemove,
  demoPeerState,
  demoRowStatus,
  readDemoSnapshot,
  startDemoChats,
} from './demo';

const bot = (username: string): DemoBot => ({ username, tagline: `${username} tagline`, tag: 'utility' });
const BOTS = [bot('pcdpirate.81'), bot('pcdghost.99'), bot('pcdpeer.47')];

const accountOf = (username: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(username).slice(0, 32));
  return bytes;
};

/** A fake network and device: `pcdghost.99` is owned by no one; sends write the rows the app would write. */
const world = (options: { failOnce?: string } = {}) => {
  const snapshot: DemoSnapshot = { contacts: [], rooms: [], requests: [], blocked: [] };
  const requests: { username: string; text: string }[] = [];
  const messages: { peer: HexString; text: string }[] = [];
  let failing = options.failOnce ?? null;
  const deps: DemoDeps = {
    snapshot: async () => structuredClone(snapshot),
    resolveUsername: async username => (username === 'pcdghost.99' ? null : accountOf(username)),
    getPeerIdentity: async accountId => ({
      accountId,
      username: new TextDecoder().decode(accountId).replace(/\0+$/, ''),
      chatPublicKey: new Uint8Array(32).fill(1),
    }),
    sendRequest: async (peer: PeerIdentity, text: string) => {
      // A pause, so two presses that run together really overlap.
      await new Promise(resolve => setTimeout(resolve, 5));
      if (failing === peer.username) {
        failing = null;
        throw new Error('submit failed');
      }
      requests.push({ username: peer.username, text });
      snapshot.requests.push({
        requestId: `r-${requests.length}`,
        peerAccountId: bytesToHex(peer.accountId),
        peerUsername: peer.username,
        peerChatPublicKey: peer.chatPublicKey,
        direction: 'outgoing',
        status: 'pending',
        welcomeMessage: text,
        timestamp: Date.now(),
        senderDevice: null,
        createdAt: Date.now(),
      });
    },
    sendMessage: async (peer, text) => {
      messages.push({ peer, text });
      snapshot.rooms.push({ peerAccountId: peer, unreadCount: 0, lastMessageAt: Date.now(), lastPreview: text, createdAt: Date.now(), updatedAt: Date.now() });
    },
  };
  /** The bot accepted: the request is done and the contact and room exist (as `establishContact` writes them). */
  const accept = (username: string) => {
    const account = bytesToHex(accountOf(username));
    snapshot.requests = snapshot.requests.map(row => (row.peerUsername === username ? { ...row, status: 'accepted' } : row));
    snapshot.contacts.push({ accountId: account, username, chatPublicKey: new Uint8Array(32), devices: [], createdAt: 0, updatedAt: 0 });
    snapshot.rooms.push({ peerAccountId: account, unreadCount: 0, lastMessageAt: 0, lastPreview: '', createdAt: 0, updatedAt: 0 });
  };
  return { snapshot, deps, requests, messages, accept };
};

describe('startDemoChats', () => {
  it('sends one request with a non-empty opener to each bot, in order, and skips a name no one owns', async () => {
    const w = world();
    const steps: string[] = [];
    const outcomes = await startDemoChats(BOTS, w.deps, (username, step) => steps.push(`${username}:${step}`));

    expect(DEMO_OPENER.trim()).not.toBe('');
    expect(w.requests).toEqual([
      { username: 'pcdpirate.81', text: DEMO_OPENER },
      { username: 'pcdpeer.47', text: DEMO_OPENER },
    ]);
    // The unresolved bot is reported and the bot after it still gets its request.
    expect(outcomes.get('pcdghost.99')).toBe('notOnNetwork');
    expect(steps).toEqual(['pcdpirate.81:sending', 'pcdpirate.81:sent', 'pcdghost.99:sending', 'pcdghost.99:notOnNetwork', 'pcdpeer.47:sending', 'pcdpeer.47:sent']);
  });

  it('sends nothing on a second run: pending requests and open rooms are left alone', async () => {
    const w = world();
    await startDemoChats(BOTS, w.deps);
    w.accept('pcdpirate.81');
    const before = w.requests.length;

    const again = await startDemoChats(BOTS, w.deps);

    expect(w.requests.length).toBe(before);
    expect(w.messages).toEqual([]);
    expect(again.get('pcdpirate.81')).toBe('skipped');
    expect(again.get('pcdpeer.47')).toBe('skipped');
  });

  it('sends each bot one request when two presses run at the same time (onboarding and Settings)', async () => {
    const w = world();
    await Promise.all([startDemoChats(BOTS, w.deps), startDemoChats(BOTS, w.deps)]);
    expect(w.requests.map(row => row.username).sort()).toEqual(['pcdpeer.47', 'pcdpirate.81']);
  });

  it('brings a deleted demo chat back with a message, not a second request (M12e delete keeps the contact)', async () => {
    const w = world();
    w.accept('pcdpeer.47');
    w.snapshot.rooms = [];

    const outcomes = await startDemoChats([bot('pcdpeer.47')], w.deps);

    expect(outcomes.get('pcdpeer.47')).toBe('resumed');
    expect(w.requests).toEqual([]);
    expect(w.messages).toEqual([{ peer: bytesToHex(accountOf('pcdpeer.47')), text: DEMO_OPENER }]);
  });

  it('keeps going after a failed send, and a later press tries that bot again', async () => {
    const w = world({ failOnce: 'pcdpirate.81' });
    const first = await startDemoChats(BOTS, w.deps);
    expect(first.get('pcdpirate.81')).toBe('failed');
    expect(first.get('pcdpeer.47')).toBe('sent');

    const second = await startDemoChats(BOTS, w.deps);
    expect(second.get('pcdpirate.81')).toBe('sent');
    expect(second.get('pcdpeer.47')).toBe('skipped');
  });

  it('never sends to a blocked bot', async () => {
    const w = world();
    w.snapshot.blocked.push({ accountId: bytesToHex(accountOf('pcdpirate.81')), username: 'pcdpirate.81', blockedAt: 0 });
    const outcomes = await startDemoChats([bot('pcdpirate.81')], w.deps);
    expect(outcomes.get('pcdpirate.81')).toBe('skipped');
    expect(w.requests).toEqual([]);
  });
});

describe('demo row status', () => {
  it('shows "no answer yet" for a request the bot has not accepted, never an error', () => {
    const since = 1_000_000;
    const pending = { kind: 'pending' as const, peer: '0x01' as HexString, since };
    expect(demoRowStatus(pending, 'sent', since + 1_000)).toBe('sent');
    expect(demoRowStatus(pending, 'sent', since + DEMO_NO_ANSWER_MS)).toBe('noAnswer');
  });

  it('lets the database win over the press record: an accepted bot is chatting', () => {
    expect(demoRowStatus({ kind: 'chatting', peer: '0x01' }, 'sent', 0)).toBe('chatting');
    expect(demoRowStatus({ kind: 'none' }, 'notOnNetwork', 0)).toBe('notOnNetwork');
    expect(demoRowStatus({ kind: 'none' }, undefined, 0)).toBe('idle');
  });

  it('matches a bot by username with the chain padding (name.5 is name.05)', () => {
    const snapshot: DemoSnapshot = {
      contacts: [{ accountId: '0x05', username: 'pcdcolor.05', chatPublicKey: new Uint8Array(32), devices: [], createdAt: 0, updatedAt: 0 }],
      rooms: [{ peerAccountId: '0x05', unreadCount: 0, lastMessageAt: 0, lastPreview: '', createdAt: 0, updatedAt: 0 }],
      requests: [],
      blocked: [],
    };
    expect(demoPeerState(snapshot, 'pcdcolor.5')).toEqual({ kind: 'chatting', peer: '0x05' });
  });
});

describe('the device database', () => {
  beforeEach(async () => {
    await appDatabase.delete();
    await appDatabase.open();
  });

  it('reads open rooms and pending requests, which "Remove demo chats" then deletes', async () => {
    await db.contacts.put({ accountId: '0xaa', username: 'pcdpirate.81', chatPublicKey: new Uint8Array(32), devices: [], createdAt: 0, updatedAt: 0 });
    await db.rooms.put({ peerAccountId: '0xaa', unreadCount: 0, lastMessageAt: 0, lastPreview: '', createdAt: 0, updatedAt: 0 });
    await db.requests.put({
      requestId: 'r1',
      peerAccountId: '0xbb',
      peerUsername: 'pcdpeer.47',
      peerChatPublicKey: new Uint8Array(32),
      direction: 'outgoing',
      status: 'pending',
      welcomeMessage: DEMO_OPENER,
      timestamp: 0,
      senderDevice: null,
      createdAt: 0,
    });
    // A contact who is not a demo bot is never touched.
    await db.contacts.put({ accountId: '0xcc', username: 'friend.12', chatPublicKey: new Uint8Array(32), devices: [], createdAt: 0, updatedAt: 0 });
    await db.rooms.put({ peerAccountId: '0xcc', unreadCount: 0, lastMessageAt: 0, lastPreview: '', createdAt: 0, updatedAt: 0 });

    const remove = demoChatsToRemove(await readDemoSnapshot(), BOTS);

    expect(remove).toEqual([
      { peer: '0xaa', username: 'pcdpirate.81' },
      { peer: '0xbb', username: 'pcdpeer.47' },
    ]);
  });
});
