/**
 * The chat manager: wires chat requests, identity channels, per-peer sessions
 * and the repositories for one paired identity. A far smaller cousin of the
 * desktop's `managerV2Factory.ts`; transport lives in `identityChannel.ts`,
 * `peerSession.ts` and `sessions.ts`.
 *
 * One `ExpiryAllocator` is shared by everything this device signs (request
 * sends and every session): the store compares expiries per signing account,
 * and independent counters can tie within a second.
 *
 * Raw store subscriptions do not survive a WS reconnect, so on `connected`
 * after a drop every channel and session is rebuilt from Dexie.
 */

import { type StatementStoreAdapter, createExpiryAllocator, createSr25519Prover } from '@novasamatech/statement-store';

import { type HexString, bytesToHex, hexToBytes, randomId } from '../../app/bytes';
import type { ContactRow, MessageRow, PeerDevice, RequestRow } from '../../app/database';
import type { ConnectionStatus } from '../../app/statementStore';
import { getContact, listContacts, removeContactDevice, upsertContactDevice } from '../contacts/repository';
import { type DeviceKeys, isUsablePeerDevice } from '../device/keys';
import type { IdentityLookup, PeerIdentity } from '../identity/lookup';
import type { UserIdentity } from '../identity/userIdentity';
import { sendChatRequest, subscribeToIncomingRequests } from '../requests/gateway';
import { intakeRequestStatement } from '../requests/intake';
import { addRequest, getRequest, listRequests, setRequestStatus } from '../requests/repository';

import { type MessageContent, type OutgoingContent, fromWire, toWire } from './content';
import { type IdentityChannel, createIdentityChannel } from './identityChannel';
import type { IdentityChannelEvent } from './identityEvents';
import { addMessage, applyEdit, applyReaction, ensureRoom, markRoomRead, setMessageStatus } from './messages';
import type { IncomingChatMessage } from './peerSession';
import { createSessionRegistry } from './sessions';

export type ChatManagerDeps = {
  identity: UserIdentity;
  deviceKeys: DeviceKeys;
  statementStore: StatementStoreAdapter;
  lookup: IdentityLookup;
  /** WS status of the People connection; transport is rebuilt after a drop. */
  onConnectionStatus?: (listener: (status: ConnectionStatus) => void) => VoidFunction;
};

export type ChatManager = {
  sendRequest: (peer: PeerIdentity, welcomeMessage: string | null) => Promise<void>;
  acceptRequest: (requestId: string) => Promise<void>;
  declineRequest: (requestId: string) => Promise<void>;
  /** A new row: text, or a reply. Resolves once the row exists; delivery is tracked on the row. */
  sendMessage: (peer: HexString, content: { type: 'text'; text: string } | { type: 'reply'; messageId: string; text: string }) => Promise<void>;
  react: (peer: HexString, messageId: string, emoji: string, add: boolean) => Promise<void>;
  edit: (peer: HexString, messageId: string, text: string) => Promise<void>;
  markRead: (peer: HexString) => Promise<void>;
  dispose: VoidFunction;
};

const systemRow = (peer: HexString, messageId: string, timestamp: number, content: MessageContent): MessageRow => ({
  messageId,
  peerAccountId: peer,
  timestamp,
  direction: 'system',
  status: 'received',
  content,
  reactions: [],
  editedAt: null,
});

export const createChatManager = async (deps: ChatManagerDeps): Promise<ChatManager> => {
  const { identity, deviceKeys, statementStore, lookup } = deps;
  const prover = createSr25519Prover(deviceKeys.statementAccountSeed);
  const allocator = createExpiryAllocator();
  const ownDevice: PeerDevice = {
    statementAccountId: deviceKeys.statementAccountPublicKey,
    encryptionPublicKey: deviceKeys.encryptionPublicKey,
  };

  // One identity channel per peer: contacts, and pending outgoing requests
  // (the accept arrives there). Keyed by the peer's identity account.
  const channels = new Map<HexString, IdentityChannel>();
  let stopRequests: VoidFunction = () => undefined;
  let disposed = false;

  const guard = (work: Promise<void>, what: string) => {
    if (!disposed) void work.catch(error => console.warn('[chat] %s failed', what, error));
  };

  // ── Inbound content (session and identity channel alike) ──────────────

  const handleIncoming = async (peer: HexString, message: IncomingChatMessage): Promise<void> => {
    const effect = fromWire(message.content);
    switch (effect.kind) {
      case 'message':
        await addMessage({
          messageId: message.messageId,
          peerAccountId: peer,
          timestamp: message.timestamp,
          direction: 'incoming',
          status: 'received',
          content: effect.content,
          reactions: [],
          editedAt: null,
        });
        return;
      case 'reaction':
        await applyReaction(effect.messageId, effect.emoji, 'peer', effect.add);
        return;
      case 'edit':
        await applyEdit(effect.messageId, effect.text, message.timestamp);
        return;
      case 'callOffer':
        // No call support: answer with `dataChannelClosed` so the caller's UI
        // stops ringing, and keep a system row so the user knows.
        await addMessage(systemRow(peer, `call-declined:${message.messageId}`, message.timestamp, { type: 'callDeclined' }));
        if (sessions.has(peer)) {
          await sessions.send(peer, toWire({ type: 'callDecline', offerMessageId: message.messageId }), {
            messageId: randomId(),
            timestamp: Date.now(),
          });
        }
        return;
      case 'deviceAdded':
        await addPeerDevice(peer, { statementAccountId: effect.statementAccountId, encryptionPublicKey: effect.encryptionPublicKey });
        return;
      case 'deviceRemoved':
        await removePeerDevice(peer, effect.statementAccountId);
        return;
      case 'ignore':
        return;
    }
  };

  const sessions = createSessionRegistry({
    identity,
    deviceKeys,
    prover,
    allocator,
    statementStore,
    onMessage: (peer, message) => guard(handleIncoming(peer, message), 'incoming message'),
  });

  // ── Roster ─────────────────────────────────────────────────────────────

  const addPeerDevice = async (peer: HexString, device: PeerDevice): Promise<void> => {
    if (!isUsablePeerDevice(device)) return;
    const contact = await getContact(peer);
    if (!contact) return;
    const updated = await upsertContactDevice(contact, device);
    sessions.publishRoster(peer, updated.devices);
  };

  const removePeerDevice = async (peer: HexString, statementAccountId: Uint8Array): Promise<void> => {
    const updated = await removeContactDevice(peer, statementAccountId);
    if (updated) sessions.publishRoster(peer, updated.devices);
  };

  // ── Contact establishment (both directions) ────────────────────────────

  /** Contact row, room, "chat accepted" system row, session. Idempotent. */
  const establishContact = async (
    seed: { accountId: HexString; username: string; chatPublicKey: Uint8Array },
    device: PeerDevice | null,
    requestId: string,
    acceptedAt: number,
  ): Promise<ContactRow> => {
    const contact = await upsertContactDevice(seed, device);
    await ensureRoom(contact.accountId);
    await addMessage(systemRow(contact.accountId, `accepted:${requestId}`, acceptedAt, { type: 'contactAdded' }), { read: true });
    ensureChannel(hexToBytes(contact.accountId), contact.chatPublicKey);
    sessions.start(contact);
    return contact;
  };

  // ── Identity channel ───────────────────────────────────────────────────

  const ensureChannel = (peerAccountId: Uint8Array, peerChatPublicKey: Uint8Array): IdentityChannel => {
    const key = bytesToHex(peerAccountId);
    const existing = channels.get(key);
    if (existing) return existing;
    const channel = createIdentityChannel({
      ownIdentityAccountId: identity.identityAccountId,
      ownIdentityChatPrivateKey: identity.identityChatPrivateKey,
      peerIdentityAccountId: peerAccountId,
      peerIdentityChatPublicKey: peerChatPublicKey,
      prover,
      allocator,
      statementStore,
      onEvent: event => guard(onIdentityEvent(key, event), 'identity event'),
    });
    channels.set(key, channel);
    return channel;
  };

  const onIdentityEvent = async (peer: HexString, event: IdentityChannelEvent): Promise<void> => {
    switch (event.tag) {
      case 'accepted': {
        if (!isUsablePeerDevice(event.device)) return;
        const request = await getRequest(event.requestId);
        if (!request || request.direction !== 'outgoing' || request.peerAccountId !== peer) {
          // Accepted from another of our devices, or a replay: still learn the device.
          await addPeerDevice(peer, event.device);
          return;
        }
        if (request.status === 'pending') await setRequestStatus(request.requestId, 'accepted');
        const seed = { accountId: peer, username: request.peerUsername, chatPublicKey: request.peerChatPublicKey };
        await establishContact(seed, event.device, request.requestId, event.acceptedAt);
        if (request.welcomeMessage) {
          // The request's inner message IS the welcome message; its id is the
          // request id so the peer's reactions and replies target it.
          await addMessage({
            messageId: request.requestId,
            peerAccountId: peer,
            timestamp: request.timestamp,
            direction: 'outgoing',
            status: 'delivered',
            content: { type: 'text', text: request.welcomeMessage },
            reactions: [],
            editedAt: null,
          });
        }
        return;
      }
      case 'deviceAdded':
        await addPeerDevice(peer, event.device);
        return;
      case 'deviceRemoved':
        await removePeerDevice(peer, event.statementAccountId);
        return;
      case 'message':
        // A bot answers a request with its welcome text on the identity session.
        await handleIncoming(peer, event);
        return;
    }
  };

  const requireRequest = async (requestId: string, direction: RequestRow['direction']): Promise<RequestRow> => {
    const request = await getRequest(requestId);
    if (!request || request.direction !== direction) throw new Error(`no ${direction} request ${requestId}`);
    return request;
  };

  // ── Transport lifecycle ────────────────────────────────────────────────

  const startTransport = async (): Promise<void> => {
    for (const contact of await listContacts()) {
      ensureChannel(hexToBytes(contact.accountId), contact.chatPublicKey);
      sessions.start(contact);
    }
    for (const request of await listRequests()) {
      if (request.direction === 'outgoing' && request.status === 'pending') {
        ensureChannel(hexToBytes(request.peerAccountId), request.peerChatPublicKey);
      }
    }
    stopRequests = subscribeToIncomingRequests({ ownAccountId: identity.identityAccountId, statementStore }, data =>
      guard(intakeRequestStatement({ identity, lookup }, data), 'request intake'),
    );
  };

  const stopTransport = (): void => {
    stopRequests();
    sessions.stopAll();
    for (const channel of channels.values()) channel.dispose();
    channels.clear();
  };

  await startTransport();

  let wasDisconnected = false;
  const stopStatus =
    deps.onConnectionStatus?.(status => {
      if (status === 'disconnected') wasDisconnected = true;
      if (status !== 'connected' || !wasDisconnected || disposed) return;
      wasDisconnected = false;
      console.warn('[chat] connection restored, rebuilding sessions');
      stopTransport();
      guard(startTransport(), 'transport restart');
    }) ?? (() => undefined);

  // ── Outgoing ───────────────────────────────────────────────────────────

  const submit = async (peer: HexString, content: OutgoingContent, ids: { messageId: string; timestamp: number }) => {
    if (!sessions.has(peer)) throw new Error('no chat session with this contact');
    await sessions.send(peer, toWire(content), ids);
  };

  return {
    sendRequest: async (peer, welcomeMessage) => {
      const { requestId, timestamp } = await sendChatRequest({
        recipientAccountId: peer.accountId,
        recipientChatPublicKey: peer.chatPublicKey,
        senderIdentityAccountId: identity.identityAccountId,
        senderIdentityChatPrivateKey: identity.identityChatPrivateKey,
        senderDeviceEncryptionPublicKey: deviceKeys.encryptionPublicKey,
        senderDeviceSeed: deviceKeys.statementAccountSeed,
        welcomeMessage,
        statementStore,
        allocator,
      });
      await addRequest({
        requestId,
        peerAccountId: bytesToHex(peer.accountId),
        peerUsername: peer.username,
        peerChatPublicKey: peer.chatPublicKey,
        direction: 'outgoing',
        status: 'pending',
        welcomeMessage,
        timestamp,
        senderDevice: null,
        createdAt: Date.now(),
      });
      ensureChannel(peer.accountId, peer.chatPublicKey);
    },

    acceptRequest: async requestId => {
      const request = await requireRequest(requestId, 'incoming');
      await setRequestStatus(requestId, 'accepted');
      const seed = { accountId: request.peerAccountId, username: request.peerUsername, chatPublicKey: request.peerChatPublicKey };
      await establishContact(seed, request.senderDevice, requestId, Date.now());
      if (request.welcomeMessage) {
        await addMessage(
          {
            messageId: requestId,
            peerAccountId: request.peerAccountId,
            timestamp: request.timestamp,
            direction: 'incoming',
            status: 'received',
            content: { type: 'text', text: request.welcomeMessage },
            reactions: [],
            editedAt: null,
          },
          { read: true },
        );
      }
      // mds.md §"Accepting a Chat Request": the accept carries this device's
      // DeviceInfo on the identity-level session, because the peer cannot
      // address a device it does not know yet.
      await ensureChannel(hexToBytes(request.peerAccountId), request.peerChatPublicKey).post({
        tag: 'deviceChatAccepted',
        value: { requestId, device: ownDevice },
      });
    },

    declineRequest: async requestId => {
      await requireRequest(requestId, 'incoming');
      await setRequestStatus(requestId, 'declined');
    },

    sendMessage: async (peer, content) => {
      const ids = { messageId: randomId(), timestamp: Date.now() };
      await addMessage({
        messageId: ids.messageId,
        peerAccountId: peer,
        timestamp: ids.timestamp,
        direction: 'outgoing',
        status: 'sending',
        content,
        reactions: [],
        editedAt: null,
      });
      // Too large, or no usable peer device: the row stays as evidence.
      await submit(peer, content, ids).catch(async error => {
        await setMessageStatus(ids.messageId, 'failed');
        throw error;
      });
    },

    react: async (peer, messageId, emoji, add) => {
      await applyReaction(messageId, emoji, 'me', add);
      await submit(peer, { type: 'reaction', messageId, emoji, add }, { messageId: randomId(), timestamp: Date.now() });
    },

    edit: async (peer, messageId, text) => {
      const now = Date.now();
      await applyEdit(messageId, text, now);
      await submit(peer, { type: 'edit', messageId, text }, { messageId: randomId(), timestamp: now });
    },

    markRead: async peer => {
      await markRoomRead(peer);
    },

    dispose: () => {
      disposed = true;
      stopStatus();
      stopTransport();
    },
  };
};
