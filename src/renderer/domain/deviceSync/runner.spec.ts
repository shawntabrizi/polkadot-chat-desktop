/**
 * M22b: the sync protocol on an open channel (DeviceSyncRunner.kt rules):
 * an update is acknowledged after it applied, and the sender's checkpoint
 * moves only on the ack, so nothing is lost when a channel drops mid-way.
 */

import { describe, expect, it } from 'vitest';

import { DEVICE_SYNC_USE_CASE, DataChannelMessageCodec, type SyncEntity, SyncMessageCodec, type SyncUpdate } from './codec';
import type { DataPort } from './link';
import { type SyncBookkeeping, chunkEntities, runSync } from './runner';
import { createLoopbackLink } from './testing/loopback';

const openPorts = async (): Promise<[DataPort, DataPort]> => {
  const a = createLoopbackLink('initiator');
  const b = createLoopbackLink('acceptor');
  const offer = await a.createOffer();
  await b.applyRemote('offer', offer);
  const answer = await b.createAnswer();
  await a.applyRemote('answer', answer);
  return Promise.all([a.opened, b.opened]);
};

const memoryBook = (): SyncBookkeeping & { checkpoint: number } => {
  let id = 0;
  const book = {
    checkpoint: 0,
    readCheckpoint: async () => book.checkpoint,
    writeCheckpoint: async (timePoint: number) => {
      book.checkpoint = timePoint;
    },
    nextUpdateId: async () => ++id,
  };
  return book;
};

const until = async (probe: () => boolean) => {
  for (let i = 0; i < 500 && !probe(); i++) await new Promise(resolve => setTimeout(resolve, 2));
  if (!probe()) throw new Error('condition not met');
};

const chats: SyncEntity[] = [{ tag: 'ChatsAdded', value: [{ tag: 'Contact', value: new Uint8Array(32).fill(1) }] }];

describe('runSync', () => {
  it('pushes what changed, the other side applies and acks, the checkpoint moves to the update’s time', async () => {
    const [mine, theirs] = await openPorts();
    const applied: SyncUpdate[] = [];
    const book = memoryBook();
    const phone = runSync({ port: theirs, collect: async () => [], apply: async update => void applied.push(update), bookkeeping: memoryBook() });
    const device = runSync({ port: mine, collect: async since => (since === 0 ? chats : []), apply: async () => undefined, bookkeeping: book, now: () => 1_234 });
    await until(() => book.checkpoint === 1_234);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.entities).toEqual(chats);
    expect(applied[0]?.timePoint).toBe(1_234n);
    device.stop();
    phone.stop();
  });

  it('no ack: the checkpoint stays, so the next round sends the same again', async () => {
    const [mine, theirs] = await openPorts();
    const book = memoryBook();
    const seen: number[] = [];
    // A peer that reads but never acks.
    theirs.onFrame(frame => {
      const message = SyncMessageCodec.dec(DataChannelMessageCodec.dec(frame).data);
      if (message.tag === 'Update') seen.push(message.value.id);
    });
    const device = runSync({ port: mine, collect: async () => chats, apply: async () => undefined, bookkeeping: book, ackTimeoutMs: 20 });
    await until(() => seen.length >= 2);
    expect(book.checkpoint).toBe(0);
    // Ids only grow: the phone drops a repeated id.
    expect(seen[1]).toBeGreaterThan(seen[0] ?? 0);
    device.stop();
  });

  it('an incoming update is acked only after it applied', async () => {
    const [mine, theirs] = await openPorts();
    const order: string[] = [];
    let release: VoidFunction = () => undefined;
    const device = runSync({
      port: mine,
      collect: async () => [],
      apply: () =>
        new Promise<void>(resolve => {
          order.push('apply-start');
          release = () => {
            order.push('apply-end');
            resolve();
          };
        }),
      bookkeeping: memoryBook(),
    });
    theirs.onFrame(frame => {
      const message = SyncMessageCodec.dec(DataChannelMessageCodec.dec(frame).data);
      if (message.tag === 'Ack') order.push(`ack-${message.value.id}`);
    });
    theirs.send(DataChannelMessageCodec.enc({ id: DEVICE_SYNC_USE_CASE, data: SyncMessageCodec.enc({ tag: 'Update', value: { id: 9, entities: chats, timePoint: 1n } }) }));
    await until(() => order.length === 1);
    release();
    await until(() => order.length === 3);
    expect(order).toEqual(['apply-start', 'apply-end', 'ack-9']);
    device.stop();
  });

  it('splits a large snapshot so each update stays under the limit', () => {
    const many: SyncEntity[] = [{ tag: 'ChatsAdded', value: Array.from({ length: 10 }, (_, i) => ({ tag: 'Contact' as const, value: new Uint8Array(32).fill(i) })) }];
    const chunks = chunkEntities(many, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flatMap(chunk => chunk.flatMap(entity => entity.value as unknown[]))).toHaveLength(10);
    for (const chunk of chunks) expect(chunk.reduce((size, entity) => size + (entity.value as unknown[]).length * 34, 0)).toBeLessThanOrEqual(100);
    expect(chunkEntities([])).toEqual([]);
  });
});
