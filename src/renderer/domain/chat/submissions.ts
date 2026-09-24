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
 *   submission on the wire, not only in the batch.
 */

import { type StatementStoreAdapter, createRequestChannel, createResponseChannel } from '@novasamatech/statement-store';
import { ResultAsync } from 'neverthrow';

import { bytesToHex, hexToBytes } from '../../app/bytes';

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
};

/** Settings › Diagnostics: "1.00 (12 / 12)", statements per message; a dash before the first message. */
export const submissionsLine = ({ submissions, messages }: SubmissionCounts): string =>
  `${messages === 0 ? '—' : (submissions / messages).toFixed(2)} (${submissions} / ${messages})`;

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

export const createSubmissionMeter = (inner: StatementStoreAdapter): SubmissionMeter => {
  let counts: SubmissionCounts = { submissions: 0, acknowledgements: 0, messages: 0 };
  const listeners = new Set<VoidFunction>();
  const bump = (key: keyof SubmissionCounts) => {
    counts = { ...counts, [key]: counts[key] + 1 };
    for (const listener of listeners) listener();
  };

  // Request statements waiting for the end of this task, by channel.
  const waiting = new Map<string, { statement: Signed; settle: ((result: Submitted) => void)[] }>();

  const send = (statement: Signed, role: Role): Promise<Submitted> => {
    bump(role === 'response' ? 'acknowledgements' : 'submissions');
    return Promise.resolve(inner.submitStatement(statement));
  };

  const submitStatement: StatementStoreAdapter['submitStatement'] = statement => {
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
  };
};
