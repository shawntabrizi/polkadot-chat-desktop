// M11b: the chain facts the UI shows live. Asset Hub best blocks drive every
// balance read (PLAN.md "Best block first": a read per new best block, never
// a wait for finality); a signed transaction's state change reads again at
// once.

import { useEffect, useState } from 'react';

/** The latest Asset Hub best block number the main process reported; null before the first. */
export const useBestBlock = (): number | null => {
  const [block, setBlock] = useState<number | null>(null);
  useEffect(() => {
    const chain = window.desktop?.chain;
    if (!chain) return;
    return chain.onBestBlock(event => setBlock(event.number));
  }, []);
  return block;
};

/** A counter that moves on every state of a transaction this app signed. */
export const useTxTick = (): number => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const chain = window.desktop?.chain;
    if (!chain) return;
    return chain.onTxStatus(() => setTick(count => count + 1));
  }, []);
  return tick;
};

/**
 * The identity's free balance on Asset Hub in planck, read at the best block
 * when mounted, on each new best block and after each transaction state.
 * `null` until the first read answers.
 */
export const useAssetHubBalance = (): { free: bigint | null; error: boolean } => {
  const block = useBestBlock();
  const tx = useTxTick();
  const [state, setState] = useState<{ free: bigint | null; error: boolean }>({ free: null, error: false });
  useEffect(() => {
    const chain = window.desktop?.chain;
    if (!chain) return;
    let active = true;
    chain.balance().then(
      balance => {
        if (active) setState({ free: BigInt(balance.free), error: false });
      },
      (cause: unknown) => {
        console.warn('[balance] read failed', cause);
        // Keep the last value: one failed read is not "no balance".
        if (active) setState(current => ({ ...current, error: current.free === null }));
      },
    );
    return () => {
      active = false;
    };
  }, [block, tx]);
  return state;
};
