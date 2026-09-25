/**
 * M12c step 5, the counter. Why: "submissions per message" is the number the
 * owner uses to judge whether the protocol stays cheap on shared
 * infrastructure (docs/spec/efficiency.md). It must count what reaches the
 * store, keep acknowledgements apart (no content kind can remove them), and
 * the merge of back-to-back session requests must really save a submission.
 */

import { AccountFullError, createInMemoryStatementStore, createRequestChannel, createResponseChannel } from '@novasamatech/statement-store';
import { errAsync } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { bytesToHex } from '../../app/bytes';

import { AccountFullStop, createAccountSpace } from './accountSpace';
import { ACCOUNT_FULL_HOLD_MS, type SubmissionCounts, createSubmissionMeter, forwardCounts, submissionsLine } from './submissions';

type Store = ReturnType<typeof createInMemoryStatementStore>;
type Signed = Parameters<Store['submitStatement']>[0];

const TOPIC = new Uint8Array(32).fill(7);
const statement = (channel: Uint8Array | null, expiry: bigint): Signed =>
  ({
    expiry,
    ...(channel ? { channel: bytesToHex(channel) } : {}),
    topics: [bytesToHex(TOPIC)],
    data: new Uint8Array([Number(expiry)]),
    proof: { type: 'sr25519', value: { signature: `0x${'00'.repeat(64)}`, signer: `0x${'11'.repeat(32)}` } },
  }) as unknown as Signed;

/** A store that records what it received and accepts everything. */
const recordingStore = () => {
  const received: Signed[] = [];
  const store = createInMemoryStatementStore();
  return { received, store: { ...store, submitStatement: (s: Signed) => (received.push(s), store.submitStatement(s)) } as Store };
};

describe('submission meter', () => {
  it('sends one statement for two session requests on one channel in the same task: the newer one, and both callers get its result', async () => {
    const { received, store } = recordingStore();
    const meter = createSubmissionMeter(store);
    const request = createRequestChannel(TOPIC);
    const [first, second] = await Promise.all([meter.store.submitStatement(statement(request, 1n)), meter.store.submitStatement(statement(request, 2n))]);
    expect(received.map(s => s.expiry)).toEqual([2n]);
    expect(first.isOk() && second.isOk()).toBe(true);
    expect(meter.snapshot()).toEqual({ submissions: 1, acknowledgements: 0, messages: 0 });
  });

  it('counts acknowledgements apart, and requests in separate tasks separately', async () => {
    const { received, store } = recordingStore();
    const meter = createSubmissionMeter(store);
    await meter.store.submitStatement(statement(createRequestChannel(TOPIC), 1n));
    await meter.store.submitStatement(statement(createRequestChannel(TOPIC), 2n));
    await meter.store.submitStatement(statement(createResponseChannel(TOPIC), 3n));
    await meter.store.submitStatement(statement(null, 4n));
    expect(received).toHaveLength(4);
    expect(meter.snapshot()).toEqual({ submissions: 3, acknowledgements: 1, messages: 0 });
  });

  it('shows the ratio as Settings › Diagnostics reads it', () => {
    expect(submissionsLine({ submissions: 12, acknowledgements: 9, messages: 12 })).toBe('1.00 (12 / 12)');
    expect(submissionsLine({ submissions: 13, acknowledgements: 0, messages: 4 })).toBe('3.25 (13 / 4)');
    expect(submissionsLine({ submissions: 2, acknowledgements: 0, messages: 0 })).toBe('— (2 / 0)');
  });
});

// M12e step 12: the main process adds up the reports, so each count must
// reach it exactly once, also the ones made before the forwarder started.
describe('forwardCounts', () => {
  it('reports each change as the difference since the last report, and nothing after stop', () => {
    const meter = createSubmissionMeter(createInMemoryStatementStore());
    meter.messageSent();
    const reports: SubmissionCounts[] = [];
    const stop = forwardCounts(meter, delta => reports.push(delta));
    meter.messageSent();
    stop();
    meter.messageSent();
    expect(reports).toEqual([
      { submissions: 0, acknowledgements: 0, messages: 1 },
      { submissions: 0, acknowledgements: 0, messages: 1 },
    ]);
  });
});

// docs/decisions.md "AccountFull". Why: the SDK retries an `AccountFull`
// without a limit. One try above the raised floor is fair (a higher expiry
// can push out the account's lowest statement); after that the meter must
// stop the loop, and only a statement that really goes in may clear the banner.
describe('AccountFull in the meter', () => {
  const fullStore = () => {
    const inner = createInMemoryStatementStore();
    const state = { full: true, calls: 0 };
    const store = {
      ...inner,
      submitStatement: (s: Signed) => {
        state.calls += 1;
        return state.full ? errAsync(new AccountFullError(s.expiry ?? 0n, (s.expiry ?? 0n) + 1n)) : inner.submitStatement(s);
      },
    } as Store;
    return { store, state };
  };

  it('passes the first refusal on, stops at the second, holds the SDK retries, and clears only on a good submission to a refused channel', async () => {
    const { store, state } = fullStore();
    let clock = 1_000;
    const lines: string[] = [];
    const space = createAccountSpace(() => clock, line => lines.push(line));
    const meter = createSubmissionMeter(store, space, () => clock);
    const group = new Uint8Array(32).fill(9);

    const first = await meter.store.submitStatement(statement(group, 1n));
    expect(first.isErr() && first.error instanceof AccountFullError).toBe(true);
    expect(space.snapshot().full).toBe(false);

    const second = await meter.store.submitStatement(statement(group, 2n));
    expect(second.isErr() && second.error instanceof AccountFullStop).toBe(true);
    expect(space.snapshot()).toEqual({ full: true, since: 1_000 });

    const held = await meter.store.submitStatement(statement(group, 3n));
    expect(held.isErr() && held.error instanceof AccountFullStop).toBe(true);
    expect(state.calls).toBe(2);

    // A statement on another channel that goes in (a replacement frees its own slot) does not clear the banner.
    state.full = false;
    await meter.store.submitStatement(statement(null, 4n));
    expect(space.snapshot().full).toBe(true);

    clock += ACCOUNT_FULL_HOLD_MS;
    const later = await meter.store.submitStatement(statement(group, 5n));
    expect(later.isOk()).toBe(true);
    expect(space.snapshot()).toEqual({ full: false, since: null });

    // A second episode in the same session is not logged again.
    state.full = true;
    await meter.store.submitStatement(statement(group, 6n));
    await meter.store.submitStatement(statement(group, 7n));
    expect(space.snapshot().full).toBe(true);
    expect(lines).toHaveLength(1);
  });
});
