/**
 * M10a "Sign in with Polkadot app": one sign-in attempt on the first-run
 * screen. It runs the V2 pairing (v2/service.ts) for one set of device keys
 * and adds what the screen needs around it:
 *
 * - phases in the person's words, with the phone's reason on a failure;
 * - two time limits, so the screen never waits for ever: one for the scan,
 *   one for the phone's allocation of the device's Statement Store slot;
 * - the save of the `Success` (the caller's `onSuccess`), whose failure is
 *   shown instead of being logged and lost (the vendored service only logs
 *   a failed `persistOnSuccess`).
 *
 * A retry is a new attempt with NEW device keys: a new QR, a new topic, so
 * an old answer on the old topic can never be read as the new one.
 */

import type { StatementStoreAdapter } from '@novasamatech/statement-store';

import type { DeviceKeys } from '../device/keys';

import type { HandshakeMetadata } from './v2/proposal';
import { startPairingV2 } from './v2/service';
import type { HandshakeState, HandshakeSuccessState } from './v2/state';

export type SignInPhase =
  | { tag: 'waiting' }
  | { tag: 'allocating' }
  | { tag: 'saving' }
  | { tag: 'done' }
  /** The phone answered `Failed` with this reason. */
  | { tag: 'failed'; reason: string }
  /** The answer came, but this app could not keep it. */
  | { tag: 'error'; reason: string }
  | { tag: 'timedOut'; stage: 'scan' | 'allocation' };

/** How long a code waits to be scanned and approved. */
export const SCAN_TIMEOUT_MS = 5 * 60_000;
/** How long the phone may take to allocate the slot after it approved (an on-chain transaction). */
export const ALLOCATION_TIMEOUT_MS = 3 * 60_000;

export type SignInStatus = { text: string; tone: 'neutral' | 'progress' | 'success' | 'error'; canRetry: boolean };

export const signInStatus = (phase: SignInPhase): SignInStatus => {
  switch (phase.tag) {
    case 'waiting':
      return { text: 'Waiting for your phone.', tone: 'neutral', canRetry: false };
    case 'allocating':
      return { text: 'Your phone approved this device. It is getting space on the network for it…', tone: 'progress', canRetry: false };
    case 'saving':
      return { text: 'Signing in…', tone: 'progress', canRetry: false };
    case 'done':
      return { text: 'Signed in.', tone: 'success', canRetry: false };
    case 'failed':
      return { text: `Your phone did not add this device: ${phase.reason || 'no reason given'}.`, tone: 'error', canRetry: true };
    case 'error':
      return { text: `The sign-in could not be saved: ${phase.reason}`, tone: 'error', canRetry: true };
    case 'timedOut':
      return phase.stage === 'scan'
        ? { text: 'The code timed out. Show a new code to try again.', tone: 'error', canRetry: true }
        : { text: 'Your phone did not finish adding this device. Try again.', tone: 'error', canRetry: true };
  }
};

export type SignInDeps = {
  statementStore: StatementStoreAdapter;
  device: DeviceKeys;
  metadata: HandshakeMetadata;
  /** Keeps the identity; a throw shows as `error`. */
  onSuccess: (success: HandshakeSuccessState) => Promise<void>;
  onPhase: (phase: SignInPhase) => void;
  scanTimeoutMs?: number;
  allocationTimeoutMs?: number;
};

export type SignIn = { qrPayload: string; abort: () => void };

const readable = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const startSignIn = (deps: SignInDeps): SignIn => {
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pairing = startPairingV2({
    statementStore: deps.statementStore,
    deviceIdentity: {
      statementAccountPublicKey: deps.device.statementAccountPublicKey,
      statementAccountSecret: deps.device.statementAccountSeed,
      encryptionPublicKey: deps.device.encryptionPublicKey,
      encryptionPrivateKey: deps.device.encryptionPrivateKey,
    },
    metadata: deps.metadata,
  });

  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    subscription.unsubscribe();
    pairing.abort();
  };
  const end = (phase: SignInPhase) => {
    if (finished) return;
    finished = true;
    stop();
    deps.onPhase(phase);
  };
  const limit = (ms: number, stage: 'scan' | 'allocation') => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => end({ tag: 'timedOut', stage }), ms);
  };

  const onState = (state: HandshakeState) => {
    if (finished) return;
    switch (state.tag) {
      case 'Idle':
      case 'Submitted':
        return;
      case 'Pending':
        limit(deps.allocationTimeoutMs ?? ALLOCATION_TIMEOUT_MS, 'allocation');
        deps.onPhase({ tag: 'allocating' });
        return;
      case 'Failed':
        end({ tag: 'failed', reason: state.reason });
        return;
      case 'Success':
        // The answer is final: no more time limit, no more statements to read.
        finished = true;
        stop();
        deps.onPhase({ tag: 'saving' });
        deps.onSuccess(state).then(
          () => deps.onPhase({ tag: 'done' }),
          (error: unknown) => deps.onPhase({ tag: 'error', reason: readable(error) }),
        );
    }
  };

  const subscription = pairing.state$.subscribe(onState);
  if (!finished) {
    limit(deps.scanTimeoutMs ?? SCAN_TIMEOUT_MS, 'scan');
    deps.onPhase({ tag: 'waiting' });
  }

  return {
    qrPayload: pairing.qrPayload,
    abort: () => {
      if (finished) return;
      finished = true;
      stop();
    },
  };
};
