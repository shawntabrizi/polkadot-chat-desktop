/**
 * M22b: what a `SyncUpdate` means for this device's Dexie, both ways.
 *
 * In (`applyUpdate`), as the phone's `SyncEntityApplier.kt` applies ours:
 * - `Devices`: the phone's list of linked devices, kept for display only
 *   (the phone ignores ours: its own list is the authority);
 * - `ChatsAdded`: contacts by identity account only; the chat key and the
 *   username come from the People chain (`ensureContact`), the devices from
 *   the `DeviceAdded` messages the phone syncs next (it stores each contact
 *   device as a synthetic incoming `DeviceAdded`, `IncomingChatRequestProcessor.kt:437`);
 * - `ChatsRemoved`: the chat is deleted here, at the update's time;
 * - `Messages`: history. Incoming rows as received (read when the phone saw
 *   them), own rows as sent or delivered; reactions, edits and deletions
 *   applied to their targets; `DeviceAdded`/`DeviceRemoved` from a contact
 *   change that contact's devices; our phone's `DeviceRemoved` of THIS
 *   device signs this device out. Other kinds (calls, tokens, coinage) are
 *   not history here and are skipped: the phone keeps them.
 *
 * Out (`collectEntities`), as `SyncEntityCollector.kt` collects: chats added
 * and deleted here, and the messages this device sent, since the last
 * acknowledged time. Incoming messages are not sent: the contact wrapped
 * them for the phone too. Only text and replies go: the SDK codec the phone
 * decodes has no kind for our extensions (spec 0012 attachments, buttons…).
 */

import { type HexString, bytesEqual, bytesToHex, hexToBytes } from '../../app/bytes';
import { type MessageRow, db, isGroupPeer, isLocalPeer } from '../../app/database';
import { writeSetting } from '../../app/settings';
import { type IncomingEffect, fromWire } from '../chat/content';
import type { ChatContent } from '../chat/identityEvents';
import { addMessage, applyEdit, applyReaction, tombstoneMessage } from '../chat/messages';
import type { IncomingChatMessage } from '../chat/peerSession';

import type { LocalMessage, SyncEntity, SyncUpdate, WireChatMessage } from './codec';

export type ApplyDeps = {
  /** This device's statement account: a `DeviceRemoved` of it from our phone signs out. */
  ownStatementAccountId: Uint8Array;
  /** The contact exists afterwards (made from the People chain if new, its session running); false if it cannot be. */
  ensureContact: (peer: HexString) => Promise<boolean>;
  /** Delete the chat here (the phone deleted it at `at`). */
  removeChat: (peer: HexString, at: number) => Promise<void>;
  /** The manager's own path for a contact's content (devices, reactions, edits, deletions). */
  deliverIncoming: (peer: HexString, message: IncomingChatMessage) => Promise<void>;
  /** Our phone removed this device. */
  onOwnDeviceRemoved: VoidFunction;
};

/** Kinds of a contact's content that are state, not bubbles: the manager applies them as if they came live. */
const DELIVERED_KINDS = new Set<IncomingEffect['kind']>(['deviceAdded', 'deviceRemoved', 'reaction', 'edit', 'deleted']);

const outgoingStatus = (status: LocalMessage['status']): MessageRow['status'] =>
  // The phone's NEW is "not yet on a statement"; this device will not send it, so it shows as sent.
  status.tag === 'Outgoing' && status.value.tag === 'DELIVERED' ? 'delivered' : 'sent';

const applyMessage = async (message: LocalMessage, deps: ApplyDeps): Promise<void> => {
  const peer = bytesToHex(message.peerId) as HexString;
  const { messageId } = message.remote;
  const timestamp = Number(message.remote.timestamp);
  const content = message.remote.versioned.value as ChatContent;
  const effect = fromWire(content);
  if (message.status.tag === 'Incoming') {
    if (effect.kind === 'message') {
      const row: MessageRow = { messageId, peerAccountId: peer, timestamp, direction: 'incoming', status: 'received', content: effect.content, reactions: [], editedAt: null, synced: true };
      await addMessage(row, { read: message.status.value.tag === 'SEEN' });
    } else if (DELIVERED_KINDS.has(effect.kind)) {
      await deps.deliverIncoming(peer, { messageId, timestamp, content });
    }
    return;
  }
  switch (effect.kind) {
    case 'message':
      await addMessage(
        { messageId, peerAccountId: peer, timestamp, direction: 'outgoing', status: outgoingStatus(message.status), content: effect.content, reactions: [], editedAt: null, synced: true },
        { read: true },
      );
      return;
    case 'reaction':
      await applyReaction(effect.messageId, effect.emoji, 'me', effect.add);
      return;
    case 'edit':
      await applyEdit(effect.messageId, effect.text, timestamp);
      return;
    case 'deleted': {
      const target = await db.messages.get(effect.targetMessageId);
      if (target?.peerAccountId === peer && target.direction === 'outgoing') await tombstoneMessage(effect.targetMessageId);
      return;
    }
    case 'deviceRemoved':
      // The phone told a contact this device is gone: it is (mds.md "Removing old device").
      if (bytesEqual(effect.statementAccountId, deps.ownStatementAccountId)) deps.onOwnDeviceRemoved();
      return;
    default:
      // Our phone's own DeviceAdded fan-out, calls, tokens: nothing for this device's history.
      return;
  }
};

const devicesJson = (entity: Extract<SyncEntity, { tag: 'Devices' }>): string =>
  JSON.stringify(
    entity.value.map(device => ({
      statementAccountId: bytesToHex(device.statementAccountId),
      encryptionPublicKey: bytesToHex(device.encryptionPublicKey),
      status: device.status.tag,
      lastUpdate: Number(device.lastUpdate),
    })),
  );

/** Each entity on its own: one that fails is logged and the rest still apply (as `SyncEntityApplier.kt`). */
export const applyUpdate = async (update: SyncUpdate, deps: ApplyDeps): Promise<void> => {
  const at = Number(update.timePoint);
  for (const entity of update.entities) {
    try {
      switch (entity.tag) {
        case 'Devices':
          await writeSetting('deviceSync.devices', devicesJson(entity));
          break;
        case 'ChatsAdded':
          for (const chat of entity.value) await deps.ensureContact(bytesToHex(chat.value) as HexString);
          break;
        case 'ChatsRemoved':
          for (const chat of entity.value) await deps.removeChat(bytesToHex(chat.value) as HexString, at);
          break;
        case 'Messages': {
          const known = new Map<string, boolean>();
          for (const message of entity.value) {
            const peer = bytesToHex(message.peerId) as HexString;
            if (!known.has(peer)) known.set(peer, await deps.ensureContact(peer));
            // A message of a chat this device cannot hold (no identity on the People chain) is left to the phone.
            if (!known.get(peer)) continue;
            try {
              await applyMessage(message, deps);
            } catch (error) {
              console.warn('[device-sync] message %s not applied', message.remote.messageId, error);
            }
          }
          break;
        }
      }
    } catch (error) {
      console.warn('[device-sync] %s of update %d not applied', entity.tag, update.id, error);
    }
  }
};

// ── Out ────────────────────────────────────────────────────────────────

const wireOf = (row: MessageRow): WireChatMessage['versioned']['value'] | null => {
  switch (row.content.type) {
    case 'text':
      return { tag: 'text', value: row.content.text };
    case 'reply':
      return { tag: 'reply', value: { messageId: row.content.messageId, ownContent: { text: row.content.text, attachments: undefined } } };
    default:
      return null;
  }
};

const localStatus = (row: MessageRow): LocalMessage['status'] => ({
  tag: 'Outgoing',
  // As SyncEntityCollector.kt: a message that never went out is NEW (the wire has no failed state).
  value: { tag: row.status === 'delivered' ? 'DELIVERED' : row.status === 'sent' ? 'SENT' : 'NEW', value: undefined },
});

const isContactPeer = (peer: string): peer is HexString => !isGroupPeer(peer) && !isLocalPeer(peer) && /^0x[0-9a-f]{64}$/i.test(peer);

export const collectEntities = async (since: number): Promise<SyncEntity[]> => {
  const entities: SyncEntity[] = [];
  const added = (await db.contacts.toArray()).filter(contact => contact.createdAt > since);
  if (added.length > 0) entities.push({ tag: 'ChatsAdded', value: added.map(contact => ({ tag: 'Contact', value: hexToBytes(contact.accountId) })) });
  const removed = (await db.deletedChats.toArray()).filter(mark => mark.deletedAt > since && isContactPeer(mark.peerId));
  if (removed.length > 0) entities.push({ tag: 'ChatsRemoved', value: removed.map(mark => ({ tag: 'Contact', value: hexToBytes(mark.peerId as HexString) })) });
  const rows = await db.messages.filter(row => row.direction === 'outgoing' && !row.synced && row.timestamp > since && isContactPeer(row.peerAccountId)).toArray();
  const messages: LocalMessage[] = [];
  for (const row of rows.sort((a, b) => a.timestamp - b.timestamp)) {
    const content = wireOf(row);
    if (!content) continue;
    messages.push({
      remote: { messageId: row.messageId, timestamp: BigInt(row.timestamp), versioned: { tag: 'v1', value: content } },
      peerId: hexToBytes(row.peerAccountId as HexString),
      status: localStatus(row),
      order: BigInt(row.timestamp),
    });
  }
  if (messages.length > 0) entities.push({ tag: 'Messages', value: messages });
  return entities;
};
