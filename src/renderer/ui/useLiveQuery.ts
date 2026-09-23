import { liveQuery } from 'dexie';
import { type DependencyList, useEffect, useState } from 'react';

/**
 * Re-runs a Dexie query whenever the tables it read change. A hand-rolled
 * `dexie-react-hooks`: the query is re-created when `deps` change.
 */
export const useLiveQuery = <T>(query: () => Promise<T>, deps: DependencyList): T | undefined => {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: setValue,
      error: (error: unknown) => console.error('[live-query] failed', error),
    });
    return () => subscription.unsubscribe();
    // `query` is a fresh closure on every render; `deps` says when it really changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
};
