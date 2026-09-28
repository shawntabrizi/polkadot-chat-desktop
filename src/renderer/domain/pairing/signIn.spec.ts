import { createInMemoryStatementStore } from '@novasamatech/statement-store';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateEncryptionPrivateKey, generateStatementAccountSeed, toDeviceKeys } from '../device/keys';

import { type SignInPhase, signInStatus, startSignIn } from './signIn';
import { failedAnswer, pendingAnswer, phoneAnswer, successAnswer } from './testing/phoneAnswer';
import { publishPairingResponse } from './testing/publishPairingResponse';
import type { HandshakeSuccessState } from './v2/state';

// M10a: the first-run screen is the only thing the person sees while the
// phone works, so every outcome must reach it in words, including the
// phone's own reason and a phone that never answers. A Success that could
// not be saved must not look like a sign-in.

const random32 = () => crypto.getRandomValues(new Uint8Array(32));
const success = () =>
  successAnswer({
    identityAccountId: random32(),
    rootAccountId: random32(),
    identityChatPrivateKey: generateEncryptionPrivateKey(),
    ssoEncPubKey: random32(),
    deviceEncPubKey: random32(),
    rootEntropySource: random32(),
  });

const setup = (onSuccess: (success: HandshakeSuccessState) => Promise<void> = async () => undefined, timeouts: { scanTimeoutMs?: number; allocationTimeoutMs?: number } = {}) => {
  const store = createInMemoryStatementStore();
  const device = toDeviceKeys(generateStatementAccountSeed(), generateEncryptionPrivateKey());
  const phases: SignInPhase[] = [];
  const signIn = startSignIn({ statementStore: store, device, metadata: { hostName: 'test' }, onSuccess, onPhase: phase => phases.push(phase), ...timeouts });
  const phone = (inner: Parameters<typeof phoneAnswer>[1]) => publishPairingResponse(store, device, phoneAnswer(device.encryptionPublicKey, inner), { signer: `0x${'77'.repeat(32)}` });
  return { store, device, phases, signIn, phone };
};

afterEach(() => vi.useRealTimers());

describe('startSignIn', () => {
  it('shows the QR of this device and waits', () => {
    const { signIn, phases } = setup();
    expect(signIn.qrPayload).toMatch(/^polkadotapp:\/\/pair\?handshake=[0-9a-f]+$/);
    expect(phases).toEqual([{ tag: 'waiting' }]);
    signIn.abort();
  });

  it('goes waiting → allocating → saving → done, and saves what the phone sent with its signer', async () => {
    const saved: HandshakeSuccessState[] = [];
    const { phases, phone } = setup(async state => {
      saved.push(state);
    });
    await phone(pendingAnswer());
    await vi.waitFor(() => expect(phases.at(-1)).toEqual({ tag: 'allocating' }));
    const answer = success();
    await phone(answer);
    await vi.waitFor(() => expect(phases.at(-1)).toEqual({ tag: 'done' }));
    expect(phases.map(phase => phase.tag)).toEqual(['waiting', 'allocating', 'saving', 'done']);
    expect(saved[0]?.identityAccountId).toEqual(answer.tag === 'Success' ? answer.value.identityAccountId : null);
    expect(saved[0]?.peerStatementAccountId).toEqual(new Uint8Array(32).fill(0x77));
  });

  it("shows the phone's reason when it refuses", async () => {
    const { phases, phone } = setup();
    await phone(failedAnswer('no free slot'));
    await vi.waitFor(() => expect(phases.at(-1)).toEqual({ tag: 'failed', reason: 'no free slot' }));
    expect(signInStatus(phases.at(-1)!)).toEqual({ text: 'Your phone did not add this device: no free slot.', tone: 'error', canRetry: true });
  });

  it('shows a save failure instead of a sign-in', async () => {
    const { phases, phone } = setup(async () => {
      throw new Error('The system keychain is not available.');
    });
    await phone(success());
    await vi.waitFor(() => expect(phases.at(-1)?.tag).toBe('error'));
    expect(signInStatus(phases.at(-1)!).text).toBe('The sign-in could not be saved: The system keychain is not available.');
  });

  it('times out an unscanned code, and a phone that approved but never finished', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const unscanned = setup(undefined, { scanTimeoutMs: 1_000 });
    vi.advanceTimersByTime(1_001);
    expect(unscanned.phases.at(-1)).toEqual({ tag: 'timedOut', stage: 'scan' });

    const stuck = setup(undefined, { scanTimeoutMs: 60_000, allocationTimeoutMs: 1_000 });
    await stuck.phone(pendingAnswer());
    await vi.waitFor(() => expect(stuck.phases.at(-1)).toEqual({ tag: 'allocating' }));
    vi.advanceTimersByTime(1_001);
    expect(stuck.phases.at(-1)).toEqual({ tag: 'timedOut', stage: 'allocation' });
    expect(signInStatus(stuck.phases.at(-1)!).canRetry).toBe(true);
  });

  it('reads nothing after an abort (the screen was left)', async () => {
    const { phases, phone, signIn, store } = setup();
    signIn.abort();
    await phone(failedAnswer('late'));
    expect(phases).toEqual([{ tag: 'waiting' }]);
    expect(store.activeSubscriptions()).toBe(0);
  });
});

describe('signInStatus', () => {
  it('says what happens in each phase, and offers a retry only after an end that is not a sign-in', () => {
    expect(signInStatus({ tag: 'waiting' })).toMatchObject({ text: 'Waiting for your phone.', canRetry: false });
    expect(signInStatus({ tag: 'allocating' }).text).toMatch(/approved this device/);
    expect(signInStatus({ tag: 'done' })).toMatchObject({ tone: 'success', canRetry: false });
    expect(signInStatus({ tag: 'timedOut', stage: 'scan' }).text).toBe('The code timed out. Show a new code to try again.');
    expect(signInStatus({ tag: 'failed', reason: '' }).text).toBe('Your phone did not add this device: no reason given.');
  });
});
