/**
 * M15c (review M16b ruling 2): attachment keys at rest in the `keys` table,
 * sealed with the app's at-rest key, as the epoch keys are (groupKeyStore.ts).
 * A message row keeps each item with an empty key and nonce; the few places
 * that need them (a download, a re-store, a resend of the message) join them
 * here. A copy of the IndexedDB folder alone then opens no attachment.
 *
 * A row written before M15c holds its keys inline. `migrateAttachmentKeys`
 * moves them once at start (Dexie's upgrade hook cannot await Web Crypto);
 * until it ran, the join takes the inline keys as they are.
 */

import { openAtRest, sealAtRest } from '../../app/atRest';
import { type AttachmentKeyRow, type MessageRow, appDatabase, db } from '../../app/database';

import type { Attachment, AttachmentItem, MessageContent } from './content';

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TICKET_BYTES = 32;
const PREFIX = 'att:';

export const attachmentKeyId = (messageId: string, index: number): string => `${PREFIX}${messageId}:${index}`;

type AttachmentContent = Extract<MessageContent, { type: 'attachment' }>;

/** Whether an item still carries its key and nonce (a row from before M15c, or one not yet stored). */
export const hasInlineKey = (item: Pick<AttachmentItem, 'key' | 'nonce'>): boolean => item.key.length === KEY_BYTES && item.nonce.length === NONCE_BYTES;

/** The content as the message row keeps it: every item without its key and nonce. */
export const stripAttachmentKeys = (content: AttachmentContent): AttachmentContent => ({
  ...content,
  items: content.items.map(item => ({ ...item, key: new Uint8Array(0), nonce: new Uint8Array(0) })),
});

/** The sealed `keys` rows for a message's items (sealed outside any IndexedDB transaction: Web Crypto would end it). */
export const sealAttachmentKeys = (messageId: string, items: readonly AttachmentItem[]): Promise<AttachmentKeyRow[]> =>
  Promise.all(
    items.map(async (item, index) => {
      const id = attachmentKeyId(messageId, index);
      const plain = new Uint8Array(KEY_BYTES + NONCE_BYTES);
      plain.set(item.key, 0);
      plain.set(item.nonce, KEY_BYTES);
      const { nonce, sealed } = await sealAtRest(plain, id);
      return { id, messageId, index, nonce, sealed };
    }),
  );

type RichTextContent = Extract<MessageContent, { type: 'richText' }>;

/** HOP receive: whether a `richText` attachment still carries its claim ticket. */
const hasInlineTicket = (attachment: Attachment): boolean => attachment.hop?.ticket.length === TICKET_BYTES;

/** HOP receive: each claim ticket sealed in a `keys` row with the same id scheme, and the content without them. */
const splitTickets = async (messageId: string, content: RichTextContent): Promise<{ content: RichTextContent; keys: AttachmentKeyRow[] }> => {
  const keys: AttachmentKeyRow[] = [];
  for (const [index, attachment] of content.attachments.entries()) {
    if (!attachment.hop || !hasInlineTicket(attachment)) continue;
    const id = attachmentKeyId(messageId, index);
    const { nonce, sealed } = await sealAtRest(attachment.hop.ticket, id);
    keys.push({ id, messageId, index, nonce, sealed });
  }
  const attachments = content.attachments.map(attachment => (attachment.hop ? { ...attachment, hop: { ...attachment.hop, ticket: new Uint8Array(0) } } : attachment));
  return { content: { ...content, attachments }, keys };
};

/**
 * What `addMessage` stores for a row: an attachment row loses its keys, and
 * a `richText` row its HOP claim tickets, to sealed `keys` rows; any other
 * row is unchanged.
 */
export const splitAttachmentKeys = async (row: MessageRow): Promise<{ row: MessageRow; keys: AttachmentKeyRow[] }> => {
  if (row.content.type === 'richText' && row.content.attachments.some(hasInlineTicket)) {
    const split = await splitTickets(row.messageId, row.content);
    return { row: { ...row, content: split.content }, keys: split.keys };
  }
  if (row.content.type !== 'attachment' || !row.content.items.some(hasInlineKey)) return { row, keys: [] };
  const keys = await sealAttachmentKeys(row.messageId, row.content.items);
  return { row: { ...row, content: stripAttachmentKeys(row.content) }, keys };
};

/** HOP receive: the claim ticket of attachment `index` of `messageId`. Rejects when it is gone. */
export const hopTicket = async (messageId: string, index: number, attachment: Attachment): Promise<Uint8Array> => {
  if (hasInlineTicket(attachment) && attachment.hop) return attachment.hop.ticket;
  const id = attachmentKeyId(messageId, index);
  const row = await db.attachmentKeys.get(id);
  if (!row) throw new Error('The key of this attachment is not on this computer.');
  return openAtRest({ nonce: row.nonce, sealed: row.sealed }, id);
};

/**
 * M20b, HOP send: our upload of attachment `index` of our own `messageId` is
 * done. The row learns its node and root id; the claim ticket goes sealed to
 * `keys`, as a received one does.
 */
export const setHopLocation = async (messageId: string, index: number, attachment: Attachment): Promise<void> => {
  const hop = attachment.hop;
  if (!hop) return;
  const id = attachmentKeyId(messageId, index);
  const { nonce, sealed } = await sealAtRest(hop.ticket, id);
  await appDatabase.transaction('rw', db.messages, db.keys, async () => {
    const row = await db.messages.get(messageId);
    if (row?.content.type !== 'richText') return;
    const attachments = row.content.attachments.map((existing, i) => (i === index ? { ...attachment, hop: { ...hop, ticket: new Uint8Array(0) } } : existing));
    await db.attachmentKeys.put({ id, messageId, index, nonce, sealed });
    await db.messages.update(messageId, { content: { ...row.content, attachments } });
  });
};

/** Item `index` of `messageId` with its key and nonce; the inline ones when the row still has them. Rejects when the key is gone. */
export const itemWithKey = async (messageId: string, index: number, item: AttachmentItem): Promise<AttachmentItem> => {
  if (hasInlineKey(item)) return item;
  const id = attachmentKeyId(messageId, index);
  const row = await db.attachmentKeys.get(id);
  if (!row) throw new Error('The key of this attachment is not on this computer.');
  const plain = await openAtRest({ nonce: row.nonce, sealed: row.sealed }, id);
  return { ...item, key: plain.slice(0, KEY_BYTES), nonce: plain.slice(KEY_BYTES, KEY_BYTES + NONCE_BYTES) };
};

/** A message row with its attachment keys joined (for a resend of the same message). */
export const withAttachmentKeys = async (row: MessageRow): Promise<MessageRow> => {
  if (row.content.type !== 'attachment') return row;
  const items = await Promise.all(row.content.items.map((item, index) => itemWithKey(row.messageId, index, item)));
  return { ...row, content: { ...row.content, items } };
};

/** The key rows of these messages (a tombstone, Clear history, Delete chat): run inside a transaction that holds `keys`. */
export const deleteAttachmentKeys = async (messageIds: readonly string[]): Promise<void> => {
  for (const messageId of messageIds) await db.attachmentKeys.where('id').startsWith(`${PREFIX}${messageId}:`).delete();
};

/**
 * Moves the keys of every attachment row that still holds them inline to the
 * `keys` table; returns how many rows moved. Idempotent. A row changed
 * between the read and the write (a tombstone) is left as it now is.
 */
export const migrateAttachmentKeys = async (): Promise<number> => {
  const rows = await db.messages.filter(row => row.content.type === 'attachment' && row.content.items.some(hasInlineKey)).toArray();
  let moved = 0;
  for (const row of rows) {
    const { row: stripped, keys } = await splitAttachmentKeys(row);
    await appDatabase.transaction('rw', db.messages, db.keys, async () => {
      const current = await db.messages.get(row.messageId);
      if (current?.content.type !== 'attachment' || !current.content.items.some(hasInlineKey)) return;
      await db.attachmentKeys.bulkPut(keys);
      await db.messages.update(row.messageId, { content: stripped.content });
      moved += 1;
    });
  }
  return moved;
};
