/**
 * Composer drafts, one per room, in Dexie `drafts` (M6 step 2). An empty
 * draft is deleted, so the chat list shows "Draft:" only for real text.
 */

import { type DraftRow, type PeerId, db } from '../../app/database';

export const getDraft = async (peerId: PeerId): Promise<string> => (await db.drafts.get(peerId))?.text ?? '';

export const saveDraft = (peerId: PeerId, text: string, now: number = Date.now()): Promise<unknown> =>
  text.trim() === '' ? db.drafts.delete(peerId) : db.drafts.put({ peerId, text, updatedAt: now });

export const listDrafts = (): Promise<DraftRow[]> => db.drafts.toArray();

/**
 * The draft to show in the chat list: only when no message came after it
 * (mobile shows "Draft:" until the room moves on).
 */
export const draftPreview = (draft: DraftRow | undefined, lastMessageAt: number | undefined): string | null => {
  if (!draft || draft.text.trim() === '') return null;
  if (lastMessageAt !== undefined && lastMessageAt > draft.updatedAt) return null;
  return `Draft: ${draft.text.replace(/\s+/g, ' ').trim()}`;
};
