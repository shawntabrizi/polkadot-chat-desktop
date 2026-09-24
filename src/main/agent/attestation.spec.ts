import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ATTESTATION_LATE_TEXT, createAttestationGate } from './attestation';

// A fresh identity gets its statement allowance only with the backend's
// attestation (20–65 s after registration). bot-core submits as soon as it
// starts, so a start before the attestation loses those statements (`noAllowance`).
const setup = (attestedAfterChecks: number) => {
  let checks = 0;
  const started: number[] = [];
  const log: string[] = [];
  let idle = 0;
  const gate = createAttestationGate({
    isAttested: async () => ++checks > attestedAfterChecks,
    onAttested: waited => started.push(waited),
    onIdle: () => (idle += 1),
    onChange: () => undefined,
    note: (kind, text) => log.push(`${kind} ${text}`),
    now: () => Date.now(),
  });
  return { gate, started, log, checks: () => checks, idle: () => idle };
};

describe('the attestation gate (M13 allowance wait)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not start bot-core before the Consumers entry is visible, and starts it once when it is', async () => {
    const { gate, started, log, checks } = setup(10);
    gate.open();
    await vi.advanceTimersByTimeAsync(9 * 2_000);
    expect(checks()).toBe(10);
    expect(started).toEqual([]);
    expect(gate.state()).toBe('waiting');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(started).toEqual([20_000]);
    expect(gate.state()).toBeNull();
    expect(log).toEqual(['info The network attested the agent after 20000 ms']);
    // No more polling after the start.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(checks()).toBe(11);
    expect(started).toHaveLength(1);
  });

  it('a failed read counts as not attested, not as a start', async () => {
    let calls = 0;
    const started: number[] = [];
    const gate = createAttestationGate({
      isAttested: async () => {
        calls += 1;
        if (calls === 1) throw new Error('no endpoint');
        return true;
      },
      onAttested: waited => started.push(waited),
      onChange: () => undefined,
      note: () => undefined,
    });
    gate.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(started).toHaveLength(1);
  });

  it('after 120 s it says so, keeps bot-core stopped, and checks again every 60 s', async () => {
    const polls = 120_000 / 2_000 + 1; // the checks up to and including the one at 120 s
    const { gate, started, log, checks, idle } = setup(polls + 1);
    gate.open();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(checks()).toBe(polls);
    expect(gate.state()).toBe('late');
    expect(started).toEqual([]);
    expect(log).toEqual([`error ${ATTESTATION_LATE_TEXT}`]);
    expect(idle()).toBe(1);
    // One check a minute now, not every 2 s, and no new log line each minute.
    await vi.advanceTimersByTimeAsync(59_000);
    expect(checks()).toBe(polls);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(checks()).toBe(polls + 1);
    expect(log).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(started).toEqual([240_000]);
    expect(gate.state()).toBeNull();
  });

  it('turning the agent off cancels the wait: no late start', async () => {
    const { gate, started, checks } = setup(3);
    gate.open();
    await vi.advanceTimersByTimeAsync(2_000);
    gate.cancel();
    expect(gate.state()).toBeNull();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(checks()).toBe(2);
    expect(started).toEqual([]);
  });
});
