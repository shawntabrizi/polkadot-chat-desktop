import { ss58Address } from '@polkadot-labs/hdkd-helpers';
import { ReplaySubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ConsumerValue, type DirectoryChain, createPeopleDirectory } from './directory';
import { waitForAttestation } from './register';

const ACCOUNT = `0x${'11'.repeat(32)}`;
const SS58 = ss58Address(new Uint8Array(32).fill(0x11), 42);
const KEY = `0x00${'ab'.repeat(32)}${'00'.repeat(32)}`;
const BEST = { hash: `0x${'bb'.repeat(32)}`, number: 101 };

type Reads = { account: string; at: string }[];

/**
 * A chain whose best block already holds the account and whose finalized head
 * does not yet: the state right after a sign-up lands in a block. It has no
 * finalized-block API at all, so a directory that waited on finality could not
 * become ready.
 */
const fakeChain = (options: { bestValue?: ConsumerValue; finalizedValue?: ConsumerValue; hangFirstRead?: boolean } = {}) => {
  const blocks = new ReplaySubject<{ hash: string; number: number }[]>(1);
  const reads: Reads = [];
  const metadataAt: string[] = [];
  let hang = options.hangFirstRead ?? false;
  const chain: DirectoryChain & { switches: number; destroyed: boolean } = {
    switches: 0,
    destroyed: false,
    bestBlocks$: blocks,
    getMetadata: async hash => {
      metadataAt.push(hash);
      return new Uint8Array([1]);
    },
    readConsumer: (account, at) => {
      reads.push({ account, at });
      if (hang) {
        hang = false;
        return new Promise(() => undefined);
      }
      return Promise.resolve(at === 'best' ? options.bestValue : options.finalizedValue);
    },
    switchEndpoint: () => {
      chain.switches += 1;
    },
    destroy: () => {
      chain.destroyed = true;
    },
  };
  return { chain, blocks, reads, metadataAt };
};

const onChain: ConsumerValue = {
  identifier_key: KEY,
  full_username: new TextEncoder().encode('alicebob.07'),
  lite_username: new TextEncoder().encode('alicebob'),
  credibility: { type: 'Lite' },
};

afterEach(() => {
  vi.useRealTimers();
});

describe('people directory (best block first)', () => {
  // A sign-up is visible in the best block several blocks before finality;
  // waiting on the finalized block cost every sign-up that gap.
  it('is ready at the first best block and loads the runtime of that block', async () => {
    const { chain, blocks, metadataAt } = fakeChain({ bestValue: onChain });
    let ready = false;
    const opening = createPeopleDirectory(chain).then(directory => {
      ready = true;
      return directory;
    });
    await Promise.resolve();
    expect(ready).toBe(false);
    blocks.next([BEST, { hash: `0x${'aa'.repeat(32)}`, number: 98 }]);
    await opening;
    expect(metadataAt).toEqual([BEST.hash]);
  });

  it('reads the account at the best block', async () => {
    const { chain, blocks, reads } = fakeChain({ bestValue: onChain });
    blocks.next([BEST]);
    const directory = await createPeopleDirectory(chain);
    const consumer = await directory.consumerOf(ACCOUNT);
    expect(reads).toEqual([{ account: SS58, at: 'best' }]);
    expect(consumer).toEqual({ account: ACCOUNT, username: 'alicebob.07', identifierKey: KEY, credibility: 'Lite' });
  });

  // Finality is a signal: one read at the finalized head reports it.
  it('reports finality with one read at the finalized head', async () => {
    const { chain, blocks, reads } = fakeChain({ bestValue: onChain, finalizedValue: undefined });
    blocks.next([BEST]);
    const directory = await createPeopleDirectory(chain);
    expect(await directory.identifierKeyFor(ACCOUNT)).toBe(KEY);
    expect(await directory.isFinalized(ACCOUNT)).toBe(false);
    expect(reads.map(read => read.at)).toEqual(['best', 'finalized']);
  });

  // A slow public node must not fail the read: move to the next endpoint once.
  it('retries a timed-out read once on the next endpoint', async () => {
    vi.useFakeTimers();
    const { chain, blocks, reads } = fakeChain({ bestValue: onChain, hangFirstRead: true });
    blocks.next([BEST]);
    const directory = await createPeopleDirectory(chain);
    const reading = directory.identifierKeyFor(ACCOUNT);
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await reading).toBe(KEY);
    expect(chain.switches).toBe(1);
    expect(reads).toHaveLength(2);
  });

  it('closes the connection when the node never reports a best block', async () => {
    vi.useFakeTimers();
    const { chain } = fakeChain();
    const opening = createPeopleDirectory(chain);
    const failed = expect(opening).rejects.toThrow(/chain connect timed out/);
    await vi.advanceTimersByTimeAsync(2 * 12_001);
    await failed;
    expect(chain.switches).toBe(1);
    expect(chain.destroyed).toBe(true);
  });
});

describe('waitForAttestation', () => {
  it('ends as soon as the best block shows the key', async () => {
    const { chain, blocks } = fakeChain({ bestValue: onChain });
    blocks.next([BEST]);
    const directory = await createPeopleDirectory(chain);
    const ticks = vi.fn();
    expect(await waitForAttestation(directory, ACCOUNT, { timeoutMs: 1_000, pollMs: 10, onTick: ticks })).toBe(true);
    expect(ticks).not.toHaveBeenCalled();
  });
});
