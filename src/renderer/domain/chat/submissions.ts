/**
 * M12c: what this device costs the shared Statement Store, and one way to
 * cost less (docs/spec/efficiency.md).
 *
 * The chat manager hands this wrapper, not the raw adapter, to everything
 * that submits (sessions, identity channels, chat requests). It:
 *
 * - counts every statement that goes to the network: `submissions` (what a
 *   message and its signals cost) apart from `acknowledgements` (the base
 *   spec's session responses, one per peer batch we read; not something a
 *   content kind can change);
 * - coalesces session requests on the same channel within one task. The SDK
 *   submits the whole un-ACKed batch on every `submitRequestMessage`, and the
 *   store keeps one statement per channel, so when a `seen` and a message go
 *   out back to back, the first statement is replaced before anyone can read
 *   it. Only the newest (the full batch, highest expiry) is sent; both
 *   callers get its result. That makes "the seen rides the message" one
 *   submission on the wire, not only in the batch;
 * - stops blind retries after the store's `AccountFull` (docs/decisions.md
 *   "AccountFull"). The first refusal on a channel goes back unchanged, so
 *   the SDK raises its expiry floor and tries once more (a higher expiry can
 *   push out the account's lowest statement). A second refusal on the same
 *   channel is final: it becomes `AccountFullStop`, the account is marked
 *   full, and for 500 ms more submissions on that channel do not reach the
 *   store (the SDK's own three quick retries end there).
 */

import { AccountFullError, type StatementStoreAdapter, createRequestChannel, createResponseChannel } from '@novasamatech/statement-store';
import { ResultAsync, err, errAsync } from 'neverthrow';

import { bytesToHex, hexToBytes } from '../../app/bytes';

import { type AccountSpace, AccountFullStop, createAccountSpace } from './accountSpace';

/** After a final `AccountFull`, the SDK's own retries on that channel in this time do not reach the store. */
export const ACCOUNT_FULL_HOLD_MS = 500;

export type SubmissionCounts = {
  /** Statements submitted, session acknowledgements not included. */
  submissions: number;
  /** Session acknowledgements (responses) submitted. */
  acknowledgements: number;
  /** Messages the user sent (a text, a reply, a command press): the denominator. */
  messages: number;
};

export type SubmissionMeter = {
  /** The adapter to submit through; reads and subscriptions pass through unchanged. */
  store: StatementStoreAdapter;
  snapshot: () => SubmissionCounts;
  subscribe: (listener: VoidFunction) => VoidFunction;
  /** The user sent one message (however many statements it took). */
  messageSent: () => void;
  /** `AccountFull`: the chat list banner reads it. */
  space: AccountSpace;
};

/** Settings › Diagnostics: "1.00 (12 / 12)", statements per message; a dash before the first message. */
export const submissionsLine = ({ submissions, messages }: SubmissionCounts): string =>
  `${messages === 0 ? '—' : (submissions / messages).toFixed(2)} (${submissions} / ${messages})`;

/**
 * M12e: reports what `meter` counts to `sink` (the main process keeps the
 * totals, so a reload does not zero them), as the difference since the last
 * report. Returns the unsubscribe function.
 */
export const forwardCounts = (meter: Pick<SubmissionMeter, 'snapshot' | 'subscribe'>, sink: (delta: SubmissionCounts) => void): VoidFunction => {
  let sent = meter.snapshot();
  if (sent.submissions + sent.acknowledgements + sent.messages > 0) sink(sent);
  return meter.subscribe(() => {
    const now = meter.snapshot();
    const delta = { submissions: now.submissions - sent.submissions, acknowledgements: now.acknowledgements - sent.acknowledgements, messages: now.messages - sent.messages };
    sent = now;
    sink(delta);
  });
};

type Signed = Parameters<StatementStoreAdapter['submitStatement']>[0];
type Submitted = Awaited<ReturnType<StatementStoreAdapter['submitStatement']>>;

type Role = 'request' | 'response' | 'other';

/** Session statements carry one topic, and their channel is `khash(topic, "request" | "response")`. */
const roleOf = (statement: Signed): Role => {
  const topic = statement.topics?.length === 1 ? statement.topics[0] : undefined;
  if (!statement.channel || !topic) return 'other';
  const channel = statement.channel.toLowerCase();
  const key = hexToBytes(topic);
  if (bytesToHex(createRequestChannel(key)).toLowerCase() === channel) return 'request';
  if (bytesToHex(createResponseChannel(key)).toLowerCase() === channel) return 'response';
  return 'other';
};

export const createSubmissionMeter = (inner: StatementStoreAdapter, space: AccountSpace = createAccountSpace(), now: () => number = Date.now): SubmissionMeter => {
  let counts: SubmissionCounts = { submissions: 0, acknowledgements: 0, messages: 0 };
  const listeners = new Set<VoidFunction>();
  const bump = (key: keyof SubmissionCounts) => {
    counts = { ...counts, [key]: counts[key] + 1 };
    for (const listener of listeners) listener();
  };

  // Request statements waiting for the end of this task, by channel.
  const waiting = new Map<string, { statement: Signed; settle: ((result: Submitted) => void)[] }>();

  // AccountFull refusals in a row, and the time of the final one, by channel.
  const refused = new Map<string, { count: number; stoppedAt: number | null }>();

  const send = async (statement: Signed, role: Role): Promise<Submitted> => {
    bump(role === 'response' ? 'acknowledgements' : 'submissions');
    const key = statement.channel?.toLowerCase() ?? '';
    const result = await Promise.resolve(inner.submitStatement(statement));
    if (result.isOk()) {
      if (refused.delete(key)) space.markFreed();
      return result;
    }
    if (!(result.error instanceof AccountFullError)) return result;
    const entry = refused.get(key) ?? { count: 0, stoppedAt: null };
    entry.count += 1;
    refused.set(key, entry);
    if (entry.count < 2) return result;
    entry.stoppedAt = now();
    space.markFull(role);
    return err(new AccountFullStop(role));
  };

  const submitStatement: StatementStoreAdapter['submitStatement'] = statement => {
    const held = refused.get(statement.channel?.toLowerCase() ?? '');
    if (held?.stoppedAt != null && now() - held.stoppedAt < ACCOUNT_FULL_HOLD_MS) return errAsync(new AccountFullStop('held'));
    const role = roleOf(statement);
    if (role !== 'request' || !statement.channel) return new ResultAsync(send(statement, role));
    const channel = statement.channel.toLowerCase();
    return new ResultAsync(
      new Promise<Submitted>(resolve => {
        const entry = waiting.get(channel);
        if (entry) {
          // The newer statement carries the whole batch at a higher expiry.
          entry.statement = statement;
          entry.settle.push(resolve);
          return;
        }
        waiting.set(channel, { statement, settle: [resolve] });
        setTimeout(() => {
          const due = waiting.get(channel);
          waiting.delete(channel);
          if (!due) return;
          void send(due.statement, 'request').then(result => {
            for (const settle of due.settle) settle(result);
          });
        }, 0);
      }),
    );
  };

  return {
    store: { ...inner, submitStatement },
    snapshot: () => counts,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    messageSent: () => bump('messages'),
    space,
  };
};
