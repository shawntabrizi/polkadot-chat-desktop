/**
 * Spec 0007 revision 2026-09-23 (M12c step 4): every reference bubble, ours
 * or a peer's, follows its transaction on the chain and moves without any
 * message: "in block" when a best block holds it (a peer's status 0 stays
 * pending until then), "finalized" when the finalized head passes that block
 * and the block is in the finalized chain. The main process reads the chain
 * (`main/chain/txTracker.ts`); this ties its events to the rows.
 *
 * Only references on the chain this app reads (its Asset Hub) can be
 * followed; others keep the state their message named.
 */

import type { DesktopChainApi } from '../../../shared/desktop-api';
import type { TxReference } from '../chat/content';
import { listOpenReferences, setReferenceState } from '../chat/messages';

export type ReferenceFollowerDeps = {
  chain: Pick<DesktopChainApi, 'track' | 'onTxStatus'>;
  /** New references from peers (the chat manager's `onReference`). */
  onReference: (listener: (reference: TxReference) => void) => VoidFunction;
  /** The genesis hash of the chain `chain` reads. */
  chainId: string;
};

export type ReferenceFollower = { dispose: VoidFunction };

const ended = (reference: TxReference): boolean => reference.status === 'finalized' || reference.status === 'failed';

export const createReferenceFollower = ({ chain, onReference, chainId }: ReferenceFollowerDeps): ReferenceFollower => {
  const ours = (reference: TxReference) => reference.chainId.toLowerCase() === chainId.toLowerCase();
  const follow = (reference: TxReference) => {
    if (!ours(reference) || ended(reference)) return;
    chain.track(reference.hash, reference.block).catch((cause: unknown) => console.warn('[tx] cannot follow %s', reference.hash, cause));
  };

  const stopStatus = chain.onTxStatus(event => {
    void setReferenceState(event.hash, event).catch((cause: unknown) => console.warn('[tx] row not updated', cause));
  });
  const stopReferences = onReference(follow);
  // Rows from earlier runs (and our own, signed before a restart).
  void listOpenReferences().then(references => references.forEach(follow), (cause: unknown) => console.warn('[tx] open references not read', cause));

  return {
    dispose: () => {
      stopStatus();
      stopReferences();
    },
  };
};
