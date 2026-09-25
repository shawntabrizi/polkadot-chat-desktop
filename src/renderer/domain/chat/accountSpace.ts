/**
 * The store's `AccountFull` rejection, in one place (docs/decisions.md
 * "AccountFull").
 *
 * The store keeps a fixed number of live statements for each account. When
 * the account is full, the store removes the account's statements with the
 * lowest expiry first. It refuses a new statement when every kept statement
 * has an equal or higher expiry. The client cannot free a slot: DM statements
 * never expire (the SDK pins the expiry high word to 0xFFFFFFFF), and the
 * store has no remove call.
 *
 * This module holds the "account is full" state that the chat list banner
 * reads. The submission meter sets it and clears it (submissions.ts).
 */

/** The chat list banner. */
export const ACCOUNT_FULL_BANNER = 'Your account’s space on the network is full. New messages cannot be sent until space frees.';

/** The reason on a message that did not go out. */
export const ACCOUNT_FULL_REASON = 'Your account’s space on the network is full.';

/** The system row in the chat of the message that did not go out. */
export const ACCOUNT_FULL_NOTICE = 'Your account’s space on the network is full. This message was not sent.';

/**
 * A final `AccountFull`. It is not an SDK priority error on purpose: the SDK
 * retries a priority error without a limit (every 25 ms while the batch is
 * live). A plain error uses the SDK's small retry budget and then fails the
 * batch, so the message can show "Not sent".
 */
export class AccountFullStop extends Error {
  constructor(where: string) {
    super(`${ACCOUNT_FULL_REASON} (${where})`);
    this.name = 'AccountFullStop';
  }
}

export const isAccountFullStop = (error: unknown): error is AccountFullStop => error instanceof AccountFullStop;

export type AccountSpaceState = { full: boolean; since: number | null };

export type AccountSpace = {
  /** A stable object, replaced on each change (for `useSyncExternalStore`). */
  snapshot: () => AccountSpaceState;
  subscribe: (listener: VoidFunction) => VoidFunction;
  /** A statement was refused for good. */
  markFull: (where: string) => void;
  /** A statement that the store refused before went in: space is free again. */
  markFreed: () => void;
};

const EMPTY: AccountSpaceState = { full: false, since: null };

/** `log` gets one line in each session (app run), at the first refusal only. */
export const createAccountSpace = (
  now: () => number = Date.now,
  log: (line: string) => void = line => console.warn(line),
): AccountSpace => {
  let state = EMPTY;
  let logged = false;
  const listeners = new Set<VoidFunction>();
  const set = (next: AccountSpaceState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    snapshot: () => state,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markFull: where => {
      if (!logged) {
        logged = true;
        log(`[chat] ACCOUNT_FULL the store refused a statement (${where}); no automatic retry until space frees`);
      }
      if (!state.full) set({ full: true, since: now() });
    },
    markFreed: () => {
      if (state.full) set(EMPTY);
    },
  };
};
