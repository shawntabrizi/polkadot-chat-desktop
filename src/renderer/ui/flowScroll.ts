// Where the message flow scrolls when its height changes (signing strip
// placement, 2026-09-24). The strip docks above the composer, so opening it
// makes the flow shorter; without this the pressed message slid below the
// fold, as the strip itself did when it was inside the flow.

/** The scroll container's numbers, as the DOM gives them after the resize. */
export type FlowBox = { scrollTop: number; scrollHeight: number; clientHeight: number };

/** A message's top and bottom in the flow's content (0 is the content's top). */
export type Span = { top: number; bottom: number };

/**
 * The flow's new `scrollTop` after its height changed, or null to leave it.
 * - At the bottom before (`followBottom`): stay at the bottom, so the last
 *   message stays fully in view above what grew under it. Else keep the top.
 * - Then the message to keep (`keep`, the pressed one) wins: scroll just
 *   enough to show its end, and never past its top.
 */
export const scrollAfterResize = (box: FlowBox, followBottom: boolean, keep: Span | null): number | null => {
  const max = Math.max(0, box.scrollHeight - box.clientHeight);
  let next = followBottom ? max : box.scrollTop;
  if (keep) {
    if (keep.bottom > next + box.clientHeight) next = keep.bottom - box.clientHeight;
    if (keep.top < next) next = keep.top;
  }
  next = Math.min(max, Math.max(0, next));
  return next === box.scrollTop ? null : next;
};
