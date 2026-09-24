/**
 * M13 (allowance wait): bot-core starts only after the People chain shows the
 * agent's `Resources.Consumers` entry at the best block. The identity
 * backend's attestation writes that entry and the statement allowance
 * together, 20–65 s after registration (docs/spec/efficiency.md "Allowance
 * facts"); a submission before it is rejected with `noAllowance`, and
 * bot-core's own retry is too short. No `electron` import: the chain read is
 * passed in.
 */

import type { AgentLogEntry } from '../../shared/desktop-api';

/** `waiting`: polling. `late`: the wait timed out; one check a minute until it shows. */
export type AttestationWait = 'waiting' | 'late' | null;

export const ATTESTATION_POLL_MS = 2_000;
export const ATTESTATION_TIMEOUT_MS = 120_000;
export const ATTESTATION_RETRY_MS = 60_000;
export const ATTESTATION_LATE_TEXT = 'The network has not attested the agent yet. Try again in a minute.';

export type AttestationGateDeps = {
  /** One read of `Resources.Consumers` for the agent account at the best block. A throw counts as "not yet". */
  isAttested: () => Promise<boolean>;
  /** Called once per `open()`, when the entry is visible. */
  onAttested: (waitedMs: number) => void;
  /** The wait ended (attested, timed out or cancelled): the chain connection can close. */
  onIdle?: () => void;
  onChange: () => void;
  note: (kind: AgentLogEntry['kind'], text: string) => void;
  pollMs?: number;
  timeoutMs?: number;
  retryMs?: number;
  now?: () => number;
};

export type AttestationGate = {
  /** Starts a wait; a wait already running is dropped. */
  open: () => void;
  cancel: () => void;
  state: () => AttestationWait;
};

export const createAttestationGate = (deps: AttestationGateDeps): AttestationGate => {
  const pollMs = deps.pollMs ?? ATTESTATION_POLL_MS;
  const timeoutMs = deps.timeoutMs ?? ATTESTATION_TIMEOUT_MS;
  const retryMs = deps.retryMs ?? ATTESTATION_RETRY_MS;
  const now = deps.now ?? Date.now;
  let state: AttestationWait = null;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const set = (next: AttestationWait) => {
    state = next;
    deps.onChange();
  };
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const check = async (): Promise<boolean> => {
    try {
      return await deps.isAttested();
    } catch {
      return false;
    }
  };

  const step = async (run: number, startedAt: number): Promise<void> => {
    const attested = await check();
    if (run !== generation) return;
    if (attested) {
      const waited = now() - startedAt;
      set(null);
      deps.onIdle?.();
      deps.note('info', `The network attested the agent after ${waited} ms`);
      deps.onAttested(waited);
      return;
    }
    if (state === 'waiting' && now() - startedAt >= timeoutMs) {
      set('late');
      deps.onIdle?.();
      deps.note('error', ATTESTATION_LATE_TEXT);
    }
    timer = setTimeout(() => void step(run, startedAt), state === 'late' ? retryMs : pollMs);
  };

  return {
    open: () => {
      clear();
      const run = ++generation;
      set('waiting');
      void step(run, now());
    },
    cancel: () => {
      clear();
      generation += 1;
      if (state !== null) {
        set(null);
        deps.onIdle?.();
      }
    },
    state: () => state,
  };
};
