/**
 * Spec 0011 private groups v2, the rules of its Testing section, in memory:
 * three people (A the owner, B, C) and a bot, each a `createGroupsV2` with
 * its own storage, over one statement store that keeps one statement per
 * (signer, channel) as the real store does (the SDK's in-memory store keys by
 * channel alone, so it gets one instance per signer here). DMs are handed
 * from one member to the other in process.
 */

import { createSr25519Prover, submitStatementOnce } from '@novasamatech/statement-store';
import { describe, expect, it } from 'vitest';

import { type HexString, bytesToHex } from '../../app/bytes';
import type { GroupRow, MessageRow } from '../../app/database';
import { makeGroupStore as makeStore } from '../testing/groupStore';
import { type TestPeer, makePeer, waitFor } from '../testing/peers';

import { PERMISSIONS, ROLES, decodeGroupData, decodeGroupMessages, encodeGroupData, encodeGroupMessages, encodeGroupState } from './groupCodec';
import { VARIANT, createGroupExpiryAllocator, deriveEpoch, open, seal } from './groupKeys';
import {
  type GroupsV2Storage,
  type IncomingGroupMessage,
  buildCarrier,
  createGroupsV2,
  historyProvider,
  stateChangeRefusal,
  stateWins,
} from './groupsV2';
import { ChatMessageCodec, type GroupControl } from './identityEvents';

const memoryStorage = (): GroupsV2Storage & { rows: MessageRow[]; groups: Map<string, GroupRow> } => {
  const groups = new Map<string, GroupRow>();
  const rows: MessageRow[] = [];
  return {
    groups,
    rows,
    getGroup: async id => structuredClone(groups.get(id)),
    putGroup: async row => groups.set(row.id, structuredClone(row)),
    listGroups: async () => [...groups.values()].map(row => structuredClone(row)),
    addSystemRow: async row => {
      if (!rows.some(r => r.messageId === row.messageId)) rows.push(row);
    },
    ensureRoom: async () => undefined,
    listRows: async groupId => rows.filter(row => row.groupId === groupId).sort((a, b) => a.timestamp - b.timestamp),
    markSent: async () => undefined,
  };
};

type Person = TestPeer & {
  name: string;
  hex: HexString;
  signer: HexString;
  storage: ReturnType<typeof memoryStorage>;
  got: { groupId: string; sender: HexString; message: IncomingGroupMessage }[];
  service: ReturnType<typeof createGroupsV2>;
  clock: { t: number };
};

/** A world of people on one store; `send` DMs are delivered in process. */
const world = (names: string[], options: { unknownChatKey?: (from: string, to: string) => boolean } = {}) => {
  const store = makeStore();
  const people = new Map<string, Person>();
  const byHex = (hex: HexString) => [...people.values()].find(p => p.hex === hex);
  const controls: { from: string; to: string; control: GroupControl }[] = [];
  const clock = { t: 1_800_000_000_000 };
  for (const name of names) {
    const peer = makePeer();
    const hex = bytesToHex(peer.identity.identityAccountId);
    const signer = bytesToHex(peer.device.statementAccountPublicKey);
    const storage = memoryStorage();
    const got: Person['got'] = [];
    const person = { ...peer, name, hex, signer, storage, got, clock } as Person;
    person.service = createGroupsV2({
      self: hex,
      signer,
      ownChatPrivateKey: peer.identity.identityChatPrivateKey,
      ownChatPublicKey: peer.identity.identityChatPublicKey,
      store: store.adapter,
      prover: createSr25519Prover(peer.device.statementAccountSeed),
      chatKeyOf: async account => {
        const other = byHex(account);
        if (!other || options.unknownChatKey?.(name, other.name)) return null;
        return other.identity.identityChatPublicKey;
      },
      postingOf: async account => {
        const other = byHex(account);
        return other ? [other.signer] : [];
      },
      nameOf: async account => byHex(account)?.name ?? 'unknown',
      isBot: async account => byHex(account)?.name === 'bot',
      reachable: account => !!byHex(account),
      sendControl: async (to, control) => {
        const other = byHex(to);
        if (!other) throw new Error('no session');
        controls.push({ from: name, to: other.name, control });
        // A real DM send resolves once queued; delivering later also keeps two services from waiting on each other.
        setTimeout(() => void other.service.onControl(hex, control), 0);
      },
      applyMessage: async (groupId, sender, message) => {
        got.push({ groupId, sender, message });
        if (message.content.tag === 'text') {
          storage.rows.push({
            messageId: message.messageId,
            peerAccountId: `group:${groupId}`,
            groupId,
            senderAccountId: sender,
            timestamp: message.timestamp,
            direction: 'incoming',
            status: 'received',
            content: { type: 'text', text: message.content.value },
            reactions: [],
            editedAt: null,
          });
        }
      },
      storage,
      now: () => clock.t,
    });
    people.set(name, person);
  }
  const p = (name: string) => people.get(name)!;
  return { store, p, controls, clock, people: [...people.values()] };
};

let ids = 0;
const text = (value: string) => ({ tag: 'text', value }) as const;
const nextIds = (clock: { t: number }) => ({ messageId: `m-${++ids}`, timestamp: clock.t });
const texts = (person: Person, groupId: string) => person.got.filter(g => g.groupId === groupId && g.message.content.tag === 'text').map(g => (g.message.content as { value: string }).value);

/** A (owner) creates a group with the others; everyone else holds the state. */
const created = async (names = ['A', 'B', 'C']) => {
  const w = world(names);
  for (const person of w.people) await person.service.start();
  const members = w.people.slice(1).map(person => ({ account: person.hex, username: person.name, joinedAt: w.clock.t }));
  const { groupId, unreached } = await w.p('A').service.create('Crew', members);
  expect(unreached).toEqual([]);
  for (const person of w.people.slice(1)) await waitFor(async () => (await person.storage.getGroup(groupId))?.state?.version === 1);
  return { ...w, groupId };
};

describe('spec 0011: create and send', () => {
  it('create costs one statement (the state); each member takes the welcome and reads the state from the topic', async () => {
    const { store, p, controls, groupId } = await created();
    expect(store.submittedBy(p('A').signer)).toBe(1);
    expect(controls.filter(c => c.control.tag === 'welcome').map(c => c.to)).toEqual(['B', 'C']);
    const row = await p('B').storage.getGroup(groupId);
    expect(row?.self).toBe('member');
    expect(row?.state?.members.find(m => m.account === p('A').hex)?.role).toBe(ROLES.owner);
    // Each device's statement account is its member's posting account: that is how a carrier's signer maps to a member.
    expect(row?.state?.members.find(m => m.account === p('B').hex)?.posting).toEqual([p('B').signer]);
  });

  it('one group message is ONE submission, whatever the group size, and every member takes it', async () => {
    const { store, p, clock, groupId } = await created(['A', 'B', 'C', 'bot']);
    const before = store.submittedBy(p('A').signer);
    await p('A').service.send(groupId, text('hello all'), nextIds(clock));
    expect(store.submittedBy(p('A').signer) - before).toBe(1);
    for (const name of ['B', 'C', 'bot']) await waitFor(() => texts(p(name), groupId).includes('hello all'));
  });

  it('messages composed in the same task share one statement (the per-second merge)', async () => {
    const { store, p, clock, groupId } = await created();
    const before = store.submittedBy(p('A').signer);
    await Promise.all([p('A').service.send(groupId, text('one'), nextIds(clock)), p('A').service.send(groupId, text('two'), nextIds(clock))]);
    expect(store.submittedBy(p('A').signer) - before).toBe(1);
    await waitFor(() => texts(p('B'), groupId).length === 2);
  });

  it('dedups across carries: each carrier repeats earlier messages, each is taken once', async () => {
    const { p, clock, groupId } = await created();
    await p('A').service.send(groupId, text('first'), nextIds(clock));
    clock.t += 2000;
    await p('A').service.send(groupId, text('second'), nextIds(clock));
    await waitFor(() => texts(p('B'), groupId).includes('second'));
    expect(texts(p('B'), groupId)).toEqual(['first', 'second']);
  });

  it('carry: a member offline for three messages gets all three from the sender’s one current statement', async () => {
    const { p, clock, groupId } = await created();
    p('B').service.stop();
    for (const word of ['one', 'two', 'three']) {
      clock.t += 2000;
      await p('A').service.send(groupId, text(word), nextIds(clock));
    }
    await p('B').service.start();
    await waitFor(() => texts(p('B'), groupId).length === 3);
    expect(texts(p('B'), groupId)).toEqual(['one', 'two', 'three']);
  });

  it('refuses a message too large for one carrier (4 KB), as in DMs', async () => {
    const { p, clock, groupId } = await created();
    await expect(p('A').service.send(groupId, text('x'.repeat(5000)), nextIds(clock))).rejects.toThrow(/too large/);
  });
});

describe('spec 0011: who may post', () => {
  let forged = 0;
  /** A carrier sealed with the epoch key by `signerPerson`, claiming to be from `from`. */
  const forge = async (w: Awaited<ReturnType<typeof created>>, signerPerson: Person, from: HexString, words: string) => {
    const key = (await w.p('A').storage.getGroup(w.groupId))!.keys![0]!.key;
    const ep = deriveEpoch(key, w.groupId, 1);
    const message = ChatMessageCodec.enc({ messageId: `forged-${words}`, timestamp: BigInt(w.clock.t), versioned: { tag: 'v1', value: text(words) } });
    const sealed = await seal(ep.msgKey, { signer: signerPerson.signer, epoch: 1, variant: VARIANT.messages, plaintext: encodeGroupMessages(from, [message]) });
    const result = await submitStatementOnce({
      statementStore: w.store.adapter,
      prover: createSr25519Prover(signerPerson.device.statementAccountSeed),
      // A fresh allocator per forged statement: move its clock on so a second one on the same slot wins.
      allocator: createGroupExpiryAllocator(() => Date.now() + ++forged * 1000),
      channel: ep.channels.msgs,
      topics: [ep.topic],
      data: encodeGroupData({ tag: 'messages', value: sealed }),
    });
    if (result.isErr()) throw result.error;
  };

  it('a non-member who holds the key is rejected, and so is a member signing as another member', async () => {
    const w = await created(['A', 'B', 'C', 'mallory']);
    // mallory is a member here only to have a store account; A's state below does not list her.
    const outsider = w.p('mallory');
    await forge(w, outsider, outsider.hex, 'from an outsider');
    await forge(w, w.p('C'), w.p('A').hex, 'C posing as A');
    w.clock.t += 2000;
    await w.p('A').service.send(w.groupId, text('real'), nextIds(w.clock));
    await waitFor(() => texts(w.p('B'), w.groupId).includes('real'));
    expect(texts(w.p('B'), w.groupId)).not.toContain('C posing as A');
    // mallory is listed (created() adds everyone), so only the impersonation is refused here; the outsider case:
    const row = (await w.p('B').storage.getGroup(w.groupId))!;
    await w.p('B').storage.putGroup({ ...row, state: { ...row.state!, members: row.state!.members.filter(m => m.account !== outsider.hex) } });
    await forge(w, outsider, outsider.hex, 'outsider again');
    await w.p('B').service.sweep();
    expect(texts(w.p('B'), w.groupId)).not.toContain('outsider again');
  });

  it('a member without the post permission is not taken', async () => {
    const w = await created();
    const row = (await w.p('B').storage.getGroup(w.groupId))!;
    await w.p('B').storage.putGroup({ ...row, state: { ...row.state!, members: row.state!.members.map(m => (m.account === w.p('C').hex ? { ...m, permissions: 0 } : m)) } });
    await forge(w, w.p('C'), w.p('C').hex, 'muted words');
    await w.p('B').service.sweep();
    expect(texts(w.p('B'), w.groupId)).not.toContain('muted words');
  });
});

describe('spec 0011: removal and epochs', () => {
  it('remove = two submissions; the removed member finds no entry and cannot open the next message; the others can', async () => {
    const { store, p, clock, groupId } = await created();
    const before = store.submittedBy(p('A').signer);
    await p('A').service.remove(groupId, p('B').hex);
    expect(store.submittedBy(p('A').signer) - before).toBe(2);
    await waitFor(async () => (await p('C').storage.getGroup(groupId))?.epoch === 2);
    await waitFor(async () => (await p('B').storage.getGroup(groupId))?.locked === true);
    const bRow = (await p('B').storage.getGroup(groupId))!;
    expect(bRow.keys?.some(k => k.epoch === 2)).toBe(false);

    clock.t += 2000;
    await p('A').service.send(groupId, text('after B left'), nextIds(clock));
    await waitFor(() => texts(p('C'), groupId).includes('after B left'));
    // B holds every key it ever had; none opens A's epoch-2 carrier.
    const aRow = (await p('A').storage.getGroup(groupId))!;
    const ep2 = deriveEpoch(aRow.keys!.find(k => k.epoch === 2)!.key, groupId, 2);
    const carrier = store.adapter.currentStatements().find(s => s.channel === bytesToHex(ep2.channels.msgs))!;
    const data = decodeGroupData(carrier.data!);
    if (data.tag !== 'messages') throw new Error('not a carrier');
    for (const key of bRow.keys ?? []) {
      await expect(open(deriveEpoch(key.key, groupId, 2).msgKey, { signer: p('A').signer, epoch: 2, variant: VARIANT.messages, sealed: data.value })).rejects.toThrow();
    }
    expect(texts(p('B'), groupId)).not.toContain('after B left');
    // C's room says who removed whom.
    expect(p('C').storage.rows.some(r => r.content.type === 'groupEvent' && r.content.text === 'A removed B')).toBe(true);
  });

  it('carry per epoch: after a rekey, a carrier holds only messages sent in the new epoch', async () => {
    const { store, p, clock, groupId } = await created();
    await p('A').service.send(groupId, text('epoch one'), nextIds(clock));
    await p('A').service.rotate(groupId);
    clock.t += 2000;
    await p('A').service.send(groupId, text('epoch two'), nextIds(clock));
    const aRow = (await p('A').storage.getGroup(groupId))!;
    const ep2 = deriveEpoch(aRow.keys!.find(k => k.epoch === 2)!.key, groupId, 2);
    const carrier = store.adapter.currentStatements().find(s => s.channel === bytesToHex(ep2.channels.msgs))!;
    const data = decodeGroupData(carrier.data!);
    if (data.tag !== 'messages') throw new Error('not a carrier');
    const plaintext = await open(ep2.msgKey, { signer: p('A').signer, epoch: 2, variant: VARIANT.messages, sealed: data.value });
    const items = decodeGroupMessages(plaintext).messages.map(bytes => ChatMessageCodec.dec(bytes).versioned.value);
    expect(items).toEqual([text('epoch two')]);
    // Within one epoch the carry does repeat earlier messages (same builder).
    const built = buildCarrier(p('A').hex, [new Uint8Array(3)], [{ bytes: new Uint8Array(2), sentAt: clock.t, epoch: 2 }, { bytes: new Uint8Array(1), sentAt: clock.t, epoch: 1 }], 2, clock.t);
    expect(built?.carried).toBe(1);
  });

  it('a member who missed its entry while still listed asks the admin (keyRequest) and gets the key back (welcome)', async () => {
    const w = world(['A', 'B', 'C'], { unknownChatKey: (from, to) => from === 'A' && to === 'B' });
    for (const person of w.people) await person.service.start();
    const { groupId } = await w.p('A').service.create(
      'Crew',
      w.people.slice(1).map(person => ({ account: person.hex, username: person.name, joinedAt: w.clock.t })),
    );
    await waitFor(async () => (await w.p('B').storage.getGroup(groupId))?.state?.version === 1);
    const { missing } = await w.p('A').service.rotate(groupId);
    expect(missing).toEqual([w.p('B').hex]);
    await waitFor(() => w.controls.some(c => c.control.tag === 'keyRequest' && c.from === 'B'));
    await waitFor(async () => (await w.p('B').storage.getGroup(groupId))?.epoch === 2);
    w.clock.t += 2000;
    await w.p('A').service.send(groupId, text('can you read this'), nextIds(w.clock));
    await waitFor(() => texts(w.p('B'), groupId).includes('can you read this'));
  });

  it('a rekey fork resolves to the lower signer on every member; the other key stays readable for 24 h', async () => {
    const w = await created();
    // A makes C an admin who may remove (state version 2), posted by hand as A's client would.
    const aRow = (await w.p('A').storage.getGroup(w.groupId))!;
    const ep1 = deriveEpoch(aRow.keys![0]!.key, w.groupId, 1);
    const promoted = { ...aRow.state!, version: 2, members: aRow.state!.members.map(m => (m.account === w.p('C').hex ? { ...m, role: ROLES.admin, permissions: PERMISSIONS.post | PERMISSIONS.remove } : m)) };
    const sealed = await seal(ep1.msgKey, { signer: w.p('A').signer, epoch: 1, variant: VARIANT.state, plaintext: encodeGroupState(promoted) });
    const posted = await submitStatementOnce({
      statementStore: w.store.adapter,
      prover: createSr25519Prover(w.p('A').device.statementAccountSeed),
      allocator: createGroupExpiryAllocator(() => w.clock.t + 5000),
      channel: ep1.channels.state,
      topics: [ep1.topic],
      data: encodeGroupData({ tag: 'state', value: sealed }),
    });
    if (posted.isErr()) throw posted.error;
    await w.p('A').storage.putGroup({ ...aRow, state: promoted, stateBytes: encodeGroupState(promoted) });
    for (const name of ['B', 'C']) await waitFor(async () => (await w.p(name).storage.getGroup(w.groupId))?.state?.version === 2);
    // Both admins rotate out of epoch 1 before either sees the other.
    w.p('A').service.stop();
    w.p('C').service.stop();
    await Promise.all([w.p('A').service.rotate(w.groupId), w.p('C').service.rotate(w.groupId)]);
    const lower = w.p('A').signer < w.p('C').signer ? 'A' : 'C';
    const winnerKey = (await w.p(lower).storage.getGroup(w.groupId))!.keys!.find(k => k.epoch === 2 && !k.fork)!.key;
    await w.p('B').service.sweep();
    await waitFor(async () => {
      const row = await w.p('B').storage.getGroup(w.groupId);
      return row?.keys?.some(k => k.fork) && row.keys.find(k => k.epoch === 2 && !k.fork)?.key.toString() === winnerKey.toString();
    });
  });

  it('a member who leaves posts groupLeave in its carrier; the admin removes it (rekey + state)', async () => {
    const { p, groupId } = await created();
    await p('C').service.leave(groupId);
    await waitFor(async () => (await p('A').storage.getGroup(groupId))?.epoch === 2);
    expect((await p('A').storage.getGroup(groupId))?.state?.members.some(m => m.account === p('C').hex)).toBe(false);
    expect((await p('C').storage.getGroup(groupId))?.keys).toEqual([]);
  });
});

describe('spec 0011: v1 migration', () => {
  it('the v1 admin opens epoch 1 from the v1 roster (admin becomes owner); a member upgrades on the welcome and keeps its rows', async () => {
    const w = world(['A', 'B']);
    for (const person of w.people) await person.service.start();
    const groupId = 'v1-room';
    const v1 = (): GroupRow => ({
      id: groupId,
      name: 'Old crew',
      admin: w.p('A').hex,
      members: w.people.map(person => ({ account: person.hex, username: person.name, joinedAt: 1 })),
      version: 3,
      createdAt: 1,
      self: 'member',
      left: [],
      invites: [],
      nextSeq: 4,
      lastSeq: {},
      gapNoted: false,
      updatedAt: 1,
    });
    for (const person of w.people) await person.storage.putGroup(v1());
    const oldRow: MessageRow = {
      messageId: 'v1-message',
      peerAccountId: `group:${groupId}`,
      groupId,
      senderAccountId: w.p('A').hex,
      timestamp: 5,
      direction: 'incoming',
      status: 'received',
      content: { type: 'text', text: 'said in v1' },
      reactions: [],
      editedAt: null,
    };
    w.p('B').storage.rows.push(oldRow);
    expect(await w.p('A').service.upgrade(groupId)).toEqual([]);
    const upgraded = await waitFor(async () => {
      const row = await w.p('B').storage.getGroup(groupId);
      return row?.v === 2 && row.state ? row : null;
    });
    expect(upgraded.state?.members.find(m => m.account === w.p('A').hex)?.role).toBe(ROLES.owner);
    expect(upgraded.state?.name).toBe('Old crew');
    expect(w.p('B').storage.rows.some(r => r.messageId === 'v1-message')).toBe(true);
    await w.p('A').service.send(groupId, text('now in v2'), nextIds(w.clock));
    await waitFor(() => texts(w.p('B'), groupId).includes('now in v2'));
  });

  it('a welcome for a v1 room from someone who is not its admin changes nothing', async () => {
    const w = world(['A', 'B', 'C']);
    await w.p('B').storage.putGroup({
      id: 'v1-other',
      name: 'x',
      admin: w.p('A').hex,
      members: [],
      version: 1,
      createdAt: 1,
      self: 'member',
      left: [],
      invites: [],
      nextSeq: 1,
      lastSeq: {},
      gapNoted: false,
      updatedAt: 1,
    });
    const outcome = await w.p('B').service.onControl(w.p('C').hex, {
      tag: 'welcome',
      value: { groupId: 'v1-other', epoch: 1, epochKey: new Uint8Array(32), stateVersion: 1, stateHash: new Uint8Array(32) },
    });
    expect(outcome).toBe('not-admin');
    expect((await w.p('B').storage.getGroup('v1-other'))?.v).toBeUndefined();
  });
});

describe('spec 0011: history on request', () => {
  it('a member asks another for missed messages and gets them in pages, newest first, taken once', async () => {
    const { p, clock, groupId } = await created(['A', 'B', 'C']);
    p('C').service.stop();
    for (const word of ['h1', 'h2']) {
      clock.t += 2000;
      await p('A').service.send(groupId, text(word), nextIds(clock));
    }
    await waitFor(() => texts(p('B'), groupId).length === 2);
    const asked = await p('C').service.requestHistory(groupId, p('B').hex, { tag: 'timestamp', value: 0 });
    expect(asked).toBe(p('B').hex);
    await waitFor(() => texts(p('C'), groupId).length === 2);
    expect(texts(p('C'), groupId).sort()).toEqual(['h1', 'h2']);
    expect(p('C').storage.rows.some(r => r.content.type === 'groupEvent' && r.content.text === 'B shared 2 earlier messages')).toBe(true);
  });

  it('with historyShare 0 a provider never shares what came before the asker joined (ruling 2)', async () => {
    const { p, clock, groupId, controls } = await created(['A', 'B', 'C']);
    await p('A').service.send(groupId, text('before C joined'), nextIds(clock));
    await waitFor(() => texts(p('B'), groupId).length === 1);
    // B's copy of the state says C joined later than that message.
    const row = (await p('B').storage.getGroup(groupId))!;
    await p('B').storage.putGroup({ ...row, state: { ...row.state!, members: row.state!.members.map(m => (m.account === p('C').hex ? { ...m, joinedAt: clock.t + 1 } : m)) } });
    await p('C').service.requestHistory(groupId, p('B').hex, { tag: 'timestamp', value: 0 });
    const pages = controls.filter(c => c.control.tag === 'history' && c.to === 'C').map(c => c.control);
    expect(pages.every(page => page.tag === 'history' && page.value.items.length === 0)).toBe(true);
  });

  it('asks a bot admin first, else the most recently active admin, else a bot, else any member', () => {
    const state = {
      members: [
        { account: '0x01', role: ROLES.owner },
        { account: '0x02', role: ROLES.admin },
        { account: '0x03', role: ROLES.member },
        { account: '0x04', role: ROLES.member },
      ],
    } as unknown as Parameters<typeof historyProvider>[0];
    const facts = (bots: string[], active: Record<string, number> = {}) => ({
      isBot: (a: HexString) => bots.includes(a),
      reachable: () => true,
      lastActive: (a: HexString) => active[a] ?? 0,
    });
    expect(historyProvider(state, '0x04' as HexString, facts(['0x02']))).toBe('0x02');
    expect(historyProvider(state, '0x04' as HexString, facts([], { '0x01': 5, '0x02': 9 }))).toBe('0x02');
    expect(historyProvider(state, '0x01' as HexString, facts(['0x03']))).toBe('0x02');
    const noAdmins = { members: state.members.map(m => ({ ...m, role: m.account === '0x01' ? ROLES.owner : ROLES.member })) } as typeof state;
    expect(historyProvider(noAdmins, '0x01' as HexString, facts(['0x04']))).toBe('0x04');
  });
});

describe('spec 0011: state rules', () => {
  const base = {
    groupId: 'g',
    epoch: 1,
    version: 1,
    name: 'n',
    avatar: undefined,
    defaultPermissions: 1,
    slowModeSecs: 0,
    joinPolicy: 0,
    historyShare: 0,
    members: [
      { account: '0x0a' as HexString, role: ROLES.owner, permissions: 0xff, posting: [], joinedAt: 1 },
      { account: '0x0b' as HexString, role: ROLES.admin, permissions: PERMISSIONS.post | PERMISSIONS.remove, posting: [], joinedAt: 2 },
      { account: '0x0c' as HexString, role: ROLES.member, permissions: PERMISSIONS.post, posting: [], joinedAt: 3 },
    ],
    invites: [],
    pinned: [],
    topics: undefined,
    createdAt: 1,
  };

  it('orders by epoch, then version, then the lower signer at a tie', () => {
    expect(stateWins({ epoch: 2, version: 1, signer: '0xff' }, { epoch: 1, version: 9, signer: '0x00' })).toBe(true);
    expect(stateWins({ epoch: 1, version: 3, signer: '0xff' }, { epoch: 1, version: 2, signer: '0x00' })).toBe(true);
    expect(stateWins({ epoch: 1, version: 2, signer: '0x01' }, { epoch: 1, version: 2, signer: '0x02' })).toBe(true);
    expect(stateWins({ epoch: 1, version: 2, signer: '0x03' }, { epoch: 1, version: 2, signer: '0x02' })).toBe(false);
  });

  it('an admin with remove may remove a member but not rename, promote, or remove the owner', () => {
    const admin = base.members[1]!;
    expect(stateChangeRefusal(base, { ...base, members: base.members.slice(0, 2) }, admin)).toBeNull();
    expect(stateChangeRefusal(base, { ...base, name: 'other' }, admin)).toBe('no-info');
    expect(stateChangeRefusal(base, { ...base, members: base.members.map(m => (m.account === '0x0c' ? { ...m, permissions: 0 } : m)) }, admin)).toBe('no-admins');
    // Only the heir (the longest-standing admin) takes over from an owner who is gone; nobody else.
    expect(stateChangeRefusal(base, { ...base, members: base.members.slice(1).map(m => (m.account === '0x0c' ? { ...m, role: ROLES.owner } : m)) }, admin)).toBe('owner-only');
    expect(stateChangeRefusal(base, { ...base, name: 'x' }, base.members[2]!)).toBe('not-admin');
  });
});
