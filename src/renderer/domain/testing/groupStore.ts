// Test helper: a statement store that keeps one statement per (signer,
// channel), as `sc-statement-store` does. The SDK's in-memory store keys by
// channel alone, which is right for pairwise sessions (each channel has one
// writer) but not for a spec 0011 group topic, where every member writes a
// statement on the same `ChMsgs_e`. So each signer gets its own SDK store and
// this one merges reads and subscriptions.

import { type InMemoryStatementStore, createInMemoryStatementStore } from '@novasamatech/statement-store';
import { okAsync } from 'neverthrow';
import { toHex } from 'polkadot-api/utils';

type Adapter = InMemoryStatementStore;
type Filter = Parameters<Adapter['queryStatements']>[0];
type Statement = Awaited<ReturnType<Adapter['currentStatements']>>[number];

/** One slot per (signer, channel), as `sc-statement-store` keeps them. */
export const makeGroupStore = () => {
  const bySigner = new Map<string, Adapter>();
  const subscribers = new Set<{ filter: Filter; callback: (page: { statements: Statement[]; isComplete: boolean }) => unknown }>();
  const signerOf = (s: Statement): string => ((s.proof as { value?: { signer?: string } } | undefined)?.value?.signer ?? '').toLowerCase();
  const matches = (filter: Filter, s: Statement) => {
    const topics = s.topics ?? [];
    return 'matchAll' in filter ? filter.matchAll.every(t => topics.includes(toHex(t))) : filter.matchAny.some(t => topics.includes(toHex(t)));
  };
  const all = () => [...bySigner.values()].flatMap(inner => inner.currentStatements());
  const adapter: Adapter = {
    queryStatements: filter => okAsync(all().filter(s => matches(filter, s))),
    subscribeStatements: (filter, callback) => {
      const sub = { filter, callback };
      subscribers.add(sub);
      return () => subscribers.delete(sub);
    },
    submitStatement: statement => {
      const signer = signerOf(statement);
      let inner = bySigner.get(signer);
      if (!inner) {
        inner = createInMemoryStatementStore();
        bySigner.set(signer, inner);
      }
      return inner.submitStatement(statement).map(() => {
        for (const sub of subscribers) if (matches(sub.filter, statement)) sub.callback({ statements: [statement], isComplete: true });
      });
    },
    currentStatements: all,
    acceptedStatements: () => [...bySigner.values()].flatMap(inner => inner.acceptedStatements()),
    activeSubscriptions: () => subscribers.size,
  };
  /** Statements `signer` submitted so far (the submission count). */
  const submittedBy = (signer: string) => (bySigner.get(signer.toLowerCase())?.acceptedStatements() ?? []).length;
  return { adapter, submittedBy };
};

