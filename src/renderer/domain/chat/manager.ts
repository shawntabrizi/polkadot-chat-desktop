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
import { readChatPrefs } from '../../app/chatPrefs';
import { type ContactRow, type GroupPeerId, type MessageRow, type PeerDevice, type RequestRow, groupIdOf, groupPeerOf, isGroupPeer } from '../../app/database';
import type { ConnectionStatus } from '../../app/statementStore';
import { getContact, listContacts, removeContactDevice, upsertContactDevice } from '../contacts/repository';
import { type DeviceKeys, isUsablePeerDevice } from '../device/keys';
import type { IdentityLookup, PeerIdentity } from '../identity/lookup';
import type { UserIdentity } from '../identity/userIdentity';
import { sendChatRequest, subscribeToIncomingRequests } from '../requests/gateway';
import { intakeRequestStatement } from '../requests/intake';
import { addRequest, getRequest, listRequests, setRequestStatus } from '../requests/repository';

import {
  type BotInfo,
  type GroupInfo,
  type GroupMember,
  type IncomingEffect,
  MAX_GROUP_MEMBERS,
  MAX_GROUP_NAME,
  type MessageContent,
  type OutgoingContent,
  type TxReference,
  type TypingKind,
  fromWire,
  keyboardOf,
  toWire,
} from './content';
import {
  admitGroupMessage,
  applyGroupInfo,
  clearInvite,
  getGroup,
  groupInfoOf,
  listGroups,
  markSelfLeft,
  otherMembers,
  recordLeave,
  saveOwnGroupInfo,
  takeSeq,
} from './groups';
import { type IdentityChannel, createIdentityChannel } from './identityChannel';
import type { ButtonWire, IdentityChannelEvent } from './identityEvents';
import {
  addMessage,
  applyDeletion,
  applySeen,
  applyEdit,
  applyReaction,
  applyReference,
  ensureRoom,
  getMessage,
  listMessages,
  markButtonPressed,
  markRoomRead,
  removeMessage,
  setMessageStatus,
  tombstoneMessage,
} from './messages';
import { applyBotInfo, getPeerInfo, markBotSignal, markStartSent, shouldSendStart } from './peerInfo';
import type { IncomingChatMessage } from './peerSession';
import { createSessionRegistry } from './sessions';
import { type TypingStore, createPendingSeen, createSeenSender, createTypingSender, createTypingStore } from './signals';

export type ChatManagerDeps = {
  identity: UserIdentity;
  deviceKeys: DeviceKeys;
  statementStore: StatementStoreAdapter;
  lookup: IdentityLookup;
  /** WS status of the People connection; transport is rebuilt after a drop. */
  onConnectionStatus?: (listener: (status: ConnectionStatus) => void) => VoidFunction;
  /** Our own username: the roster names us when we create a group (spec 0009). */
  username?: string;
};

/**
 * Where a message goes: a contact (its identity account) or a spec 0009
 * group (`group:<groupId>`, fanned out over the members' pairwise sessions).
 */
export type ChatTargetId = HexString | GroupPeerId;

/** A member as the caller names one: the identity account and the username. */
export type GroupMemberInput = { account: HexString; username: string };

export type ChatManager = {
  sendRequest: (peer: PeerIdentity, welcomeMessage: string | null) => Promise<void>;
  acceptRequest: (requestId: string) => Promise<void>;
  declineRequest: (requestId: string) => Promise<void>;
  /** A new row: text, or a reply. Resolves once the row exists; delivery is tracked on the row. */
  sendMessage: (peer: ChatTargetId, content: { type: 'text'; text: string } | { type: 'reply'; messageId: string; text: string }) => Promise<void>;
  react: (peer: ChatTargetId, messageId: string, emoji: string, add: boolean) => Promise<void>;
  edit: (peer: ChatTargetId, messageId: string, text: string) => Promise<void>;
  /**
   * RFC-0003 delete for everyone, own text or reply only. A `failed` message
   * never reached a statement: it is removed here and nothing is sent.
   * Otherwise it is tombstoned here at once and `deleted` goes out, which
   * asks the peer's devices to tombstone it too.
   */
  deleteForEveryone: (peer: ChatTargetId, messageId: string) => Promise<void>;
  /**
   * Spec 0006: press button `index` of row `row` of the peer's `buttons`
   * message. `command` sends its text as our own message; `callback` sends
   * `buttonPress` (no bubble); `url` only records the press (the caller
   * opened the link after the user confirmed its host). Anything else throws.
   */
  pressButton: (peer: ChatTargetId, messageId: string, row: number, index: number) => Promise<void>;
  /**
   * Spec 0006: send a keyboard. No screen calls it in M8: the compatibility
   * rule needs evidence the peer reads kind 242, and this client gathers none
   * (docs/decisions.md). Test scripts use it as the operator flag.
   */
  sendButtons: (peer: HexString, content: { text: string; rows: ButtonWire[][]; oneShot: boolean }) => Promise<void>;
  /** Sends a `failed` message again with the same id and timestamp; `failed` again if it still cannot go out. */
  retry: (peer: ChatTargetId, messageId: string) => Promise<void>;
  /**
   * The room is read (M6 rule: visible, focused, in view). Clears the unread
   * count and, if read receipts are on, sends spec 0005 `seen` for the newest
   * message from the peer (at most one per 2 s).
   */
  markRead: (peer: ChatTargetId) => Promise<void>;
  /**
   * A person changed the composer text for `peer` (not the clear after a
   * send). Sends spec 0005 `typing` (rate-limited) if the typing indicator is on.
   */
  composing: (peer: ChatTargetId, text: string) => void;
  /** Each peer's typing state (spec 0005), in memory. */
  typing: TypingStore;
  /**
   * Spec 0005: send one `typing` as is, outside the composer rules (an
   * agent's `working` hint). No screen calls it in M9; test scripts do.
   */
  sendTyping: (peer: ChatTargetId, kind: TypingKind, until: number) => Promise<void>;
  /**
   * The room with `peer` is open (M10 step 4). Sends `/start` once, as a
   * plain text, if the peer acts like a bot and has sent no `botInfo`
   * (`shouldSendStart`). Call again when the peer's info changes.
   */
  roomOpened: (peer: HexString) => Promise<void>;
  /**
   * Spec 0008: describe this client as a bot, on the identity channel as a
   * bot does. No screen calls it: a person's client never sends `botInfo`.
   * Test scripts use it as the operator flag.
   */
  sendBotInfo: (peer: HexString, info: BotInfo) => Promise<void>;
  /**
   * Spec 0007: tell `peer` the state of a transaction this client submitted
   * (a new `transactionReference` message each time) and keep one row for it
   * that moves through the states. Never waits for finality: the caller
   * sends each state as it happens.
   */
  sendReference: (peer: HexString, reference: TxReference) => Promise<void>;
  /**
   * Spec 0009: a new group with us as admin; `members` are the others. Sends
   * the roster (v1) to each member we have a chat with, and a chat request
   * to each one we have not (the roster follows once they accept). Returns
   * the group id; its room is `group:<id>`.
   */
  createGroup: (name: string, members: GroupMemberInput[]) => Promise<string>;
  /** Spec 0009: a text or reply to the group (the same as `sendMessage(group:<id>, …)`). */
  sendToGroup: (groupId: string, content: { type: 'text'; text: string } | { type: 'reply'; messageId: string; text: string }) => Promise<void>;
  /**
   * Spec 0009, admin only: a new roster (version + 1) to every member of it
   * and to every member it removes. `members` lists everyone but us.
   */
  updateRoster: (groupId: string, members: GroupMemberInput[]) => Promise<void>;
  /** Spec 0009: `groupLeave` to every other member; we send and take nothing more. */
  leaveGroup: (groupId: string) => Promise<void>;
  dispose: VoidFunction;
};

const systemRow = (peer: ChatTargetId, messageId: string, timestamp: number, content: MessageContent): MessageRow => ({
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
  const self = bytesToHex(identity.identityAccountId);
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

  // ── Spec 0005 signals (ephemeral: never a row, a notification or unread) ─

  const typing = createTypingStore();
  const pendingSeen = createPendingSeen();

  /** Sends one signal; a signal that cannot go out is dropped (it is only a hint). */
  const signal = (peer: ChatTargetId, content: OutgoingContent, what: string) => {
    if (!isGroupPeer(peer) && !sessions.has(peer)) return;
    guard(submit(peer, content, { messageId: randomId(), timestamp: Date.now() }), what);
  };
  const typingSender = createTypingSender((peer, kind, until) =>
    guard(
      readChatPrefs().then(prefs => {
        if (prefs.typingIndicator) signal(peer as ChatTargetId, { type: 'typing', kind, until }, 'typing');
      }),
      'typing',
    ),
  );
  const seenSender = createSeenSender((peer, upTo, at) => signal(peer as HexString, { type: 'seen', upTo, at }, 'seen'));

  /** An own row now exists: apply a `seen` that named it before it did. */
  const settlePendingSeen = async (peer: HexString, messageId: string): Promise<void> => {
    const at = pendingSeen.take(peer, messageId);
    if (at !== null) await applySeen(peer, messageId, at);
  };

  // ── Inbound content (session and identity channel alike) ──────────────

  const handleIncoming = async (peer: HexString, message: IncomingChatMessage): Promise<void> => {
    const effect = fromWire(message.content);
    switch (effect.kind) {
      case 'message':
        // Any real message from the peer ends its typing hint.
        typing.messageFrom(peer, message.timestamp);
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
      case 'deleted':
        // Never a bubble, never a notification: only the tombstone it makes.
        await applyDeletion(peer, effect.targetMessageId);
        return;
      case 'buttonPress': {
        // Spec 0006: only for a keyboard we sent to this very peer.
        const target = await getMessage(effect.messageId);
        if (!target || target.peerAccountId !== peer || target.direction !== 'outgoing' || target.content.type !== 'buttons') return;
        const button = target.content.rows[effect.row]?.[effect.index];
        if (!button) return;
        await addMessage(systemRow(peer, `press:${message.messageId}`, message.timestamp, { type: 'buttonPressed', label: button.label }), { read: true });
        return;
      }
      case 'typing':
        typing.receive(peer, effect.typing, effect.until, message.timestamp);
        return;
      case 'seen':
        if ((await applySeen(peer, effect.upTo, effect.at)) === 'unknown') pendingSeen.add(peer, effect.upTo, effect.at);
        return;
      case 'botInfo':
        // Spec 0008: stored per peer, never a bubble, never answered.
        await applyBotInfo(peer, effect.info, message.timestamp);
        return;
      case 'transactionReference':
        // Spec 0007: a bubble, merged with earlier states of the same transaction.
        typing.messageFrom(peer, message.timestamp);
        await applyReference(peer, 'incoming', { messageId: message.messageId, timestamp: message.timestamp }, effect.reference);
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
      case 'groupInfo':
        await onGroupInfo(peer, effect.info);
        return;
      case 'groupLeave':
        await onGroupLeave(peer, effect.groupId, message);
        return;
      case 'groupMessage':
        await onGroupMessage(peer, message, effect.groupId, effect.seq, effect.effect);
        return;
      case 'ignore':
        return;
    }
  };

  // ── Spec 0009 groups, inbound ──────────────────────────────────────────

  const onGroupInfo = async (sender: HexString, info: GroupInfo): Promise<void> => {
    const result = await applyGroupInfo(sender, info, self);
    if (result === 'ignored') console.warn('[chat] ignored a groupInfo for %s from %s', info.groupId, sender);
  };

  const onGroupLeave = async (sender: HexString, groupId: string, message: IncomingChatMessage): Promise<void> => {
    if (!(await recordLeave(groupId, sender, message.messageId, message.timestamp))) return;
    // Spec 0009: the admin then sends a new roster without the member.
    const group = await getGroup(groupId);
    if (group && group.admin === self && group.self === 'member') {
      await updateRoster(groupId, otherMembers(group, self).filter(member => member.account !== sender));
    }
  };

  /**
   * A wrapped content from `sender` for a group: admitted only from a member
   * (spec 0009), then applied to the group's room. Every copy of one message
   * has the same envelope id, so a second copy is a no-op (`addMessage`).
   */
  const onGroupMessage = async (sender: HexString, message: IncomingChatMessage, groupId: string, seq: number, effect: IncomingEffect): Promise<void> => {
    const admitted = await admitGroupMessage(groupId, sender, seq, message.timestamp);
    if (!admitted) {
      console.warn('[chat] dropped a group message for %s from a non-member %s', groupId, sender);
      return;
    }
    const room = admitted.peer;
    switch (effect.kind) {
      case 'message':
        typing.messageFrom(room, message.timestamp);
        await addMessage({
          messageId: message.messageId,
          peerAccountId: room,
          groupId,
          senderAccountId: sender,
          groupSeq: seq,
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
      case 'edit': {
        // Only the author edits a message, in a group too.
        const target = await getMessage(effect.messageId);
        if (target?.peerAccountId === room && target.senderAccountId === sender) await applyEdit(effect.messageId, effect.text, message.timestamp);
        return;
      }
      case 'deleted':
        await applyDeletion(room, effect.targetMessageId, Date.now(), sender);
        return;
      case 'buttonPress': {
        const target = await getMessage(effect.messageId);
        if (!target || target.peerAccountId !== room || target.direction !== 'outgoing' || target.content.type !== 'buttons') return;
        const button = target.content.rows[effect.row]?.[effect.index];
        if (!button) return;
        await addMessage({ ...systemRow(room, `press:${message.messageId}`, message.timestamp, { type: 'buttonPressed', label: button.label }), groupId, senderAccountId: sender }, { read: true });
        return;
      }
      case 'typing':
        typing.receive(room, effect.typing, effect.until, message.timestamp);
        return;
      case 'botInfo':
        // A bot's info arrives wrapped too; it describes the bot, not the group.
        await applyBotInfo(sender, effect.info, message.timestamp);
        return;
      case 'transactionReference':
        typing.messageFrom(room, message.timestamp);
        await applyReference(room, 'incoming', { messageId: message.messageId, timestamp: message.timestamp }, effect.reference);
        return;
      // No read receipts in groups (v1); calls, rosters and nested group kinds are not group content.
      case 'seen':
      case 'callOffer':
      case 'deviceAdded':
      case 'deviceRemoved':
      case 'groupInfo':
      case 'groupMessage':
      case 'groupLeave':
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
    guard(sendPendingInvites(contact.accountId), 'group invites');
    return contact;
  };

  /** Spec 0009: a member we invited by chat request accepted it: the roster goes to them now. */
  const sendPendingInvites = async (peer: HexString): Promise<void> => {
    for (const group of await listGroups()) {
      if (group.admin !== self || group.self !== 'member' || !group.invites.includes(peer)) continue;
      await submit(peer, { type: 'groupInfo', info: groupInfoOf(group) }, { messageId: randomId(), timestamp: Date.now() });
      await clearInvite(group.id, peer);
    }
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
          await settlePendingSeen(peer, request.requestId);
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
        // A bot answers a request with its welcome text on the identity
        // session; a phone never sends content there. That is the only sign
        // of an older bot (the automatic `/start`, M10 step 4).
        await markBotSignal(peer, event.timestamp);
        await handleIncoming(peer, event);
        return;
    }
  };

  // Peers whose automatic `/start` is on its way: a second call while the
  // first one still runs must not send it twice.
  const starting = new Set<HexString>();

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

  const submit = async (peer: ChatTargetId, content: OutgoingContent, ids: { messageId: string; timestamp: number }) => {
    if (isGroupPeer(peer)) return fanOut(peer, content, ids);
    if (!sessions.has(peer)) throw new Error('no chat session with this contact');
    await sessions.send(peer, toWire(content), ids);
  };

  /**
   * Spec 0009 send: the content wrapped in `groupMessage` with our next
   * `seq` (typing: the current one), one copy per other member of the roster we hold, all with the
   * same envelope id. A member without a chat yet ("invited") is skipped;
   * it fails only when no copy can go out.
   */
  const fanOut = async (peer: GroupPeerId, content: OutgoingContent, ids: { messageId: string; timestamp: number }): Promise<void> => {
    const group = await getGroup(groupIdOf(peer));
    if (!group) throw new Error('This group is not known on this device.');
    if (group.self !== 'member') throw new Error('You are no longer a member of this group.');
    const targets = otherMembers(group, self).filter(member => sessions.has(member.account));
    if (targets.length === 0) throw new Error('No member of this group can be reached yet.');
    // A typing hint carries our current `seq` and does not advance it (as pca's
    // bot does, vectors-0009): a receiver that drops typing sees no gap.
    const seq = content.type === 'typing' ? Math.max(0, group.nextSeq - 1) : await takeSeq(group.id);
    const wire = toWire({ type: 'groupMessage', groupId: group.id, infoVersion: group.version, seq, content });
    const results = await Promise.allSettled(targets.map(member => sessions.send(member.account, wire, ids)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed && results.every(result => result.status === 'rejected')) throw failed.reason;
    if (failed) console.warn('[chat] a group copy did not go out', failed.reason);
  };

  /** Sends a roster (or a leave) to one member, if a chat with them exists. */
  const sendTo = async (peer: HexString, content: OutgoingContent): Promise<boolean> => {
    if (!sessions.has(peer)) return false;
    await submit(peer, content, { messageId: randomId(), timestamp: Date.now() });
    return true;
  };

  /** A chat request to a member we have no chat with; the roster follows on accept. */
  const inviteByRequest = async (member: GroupMemberInput, groupName: string): Promise<void> => {
    const pending = (await listRequests()).some(request => request.peerAccountId === member.account && request.status === 'pending');
    if (pending) return;
    const peer = await lookup.getPeerIdentity(hexToBytes(member.account));
    if (!peer) throw new Error(`${member.username} has no chat key on the People chain yet.`);
    await sendRequestTo(peer, `${deps.username ?? 'Someone'} invited you to the group “${groupName}”`);
  };

  const rosterOf = (members: readonly GroupMemberInput[], previous: readonly GroupMember[], now: number): GroupMember[] => {
    const seen = new Set<string>([self]);
    const out: GroupMember[] = [];
    for (const member of members) {
      if (seen.has(member.account)) continue;
      seen.add(member.account);
      out.push({ account: member.account, username: member.username, joinedAt: previous.find(entry => entry.account === member.account)?.joinedAt ?? now });
    }
    return out;
  };

  /** Sends `info` to each listed member; members without a chat are invited by request and returned. */
  const distribute = async (info: GroupInfo, to: readonly GroupMemberInput[]): Promise<HexString[]> => {
    const invites: HexString[] = [];
    for (const member of to) {
      if (member.account === self) continue;
      if (await sendTo(member.account, { type: 'groupInfo', info })) continue;
      if (!info.members.some(entry => entry.account === member.account)) continue;
      invites.push(member.account);
      await inviteByRequest(member, info.name).catch(error => console.warn('[chat] group invite failed', error));
    }
    return invites;
  };

  const updateRoster: ChatManager['updateRoster'] = async (groupId, members) => {
    const group = await getGroup(groupId);
    if (!group) throw new Error('This group is not known on this device.');
    if (group.admin !== self) throw new Error('Only the admin changes the members.');
    if (group.self !== 'member') throw new Error('You are no longer a member of this group.');
    const now = Date.now();
    const selfMember = group.members.find(member => member.account === self) ?? { account: self, username: deps.username ?? '', joinedAt: group.createdAt };
    const roster = [selfMember, ...rosterOf(members, group.members, now)];
    if (roster.length > MAX_GROUP_MEMBERS) throw new Error(`A group has at most ${MAX_GROUP_MEMBERS} members.`);
    const info: GroupInfo = { ...groupInfoOf(group), members: roster, version: group.version + 1 };
    const kept = group.invites.filter(account => roster.some(member => member.account === account));
    // Stored first: a reply that arrives while the copies go out already sees the new roster.
    await saveOwnGroupInfo(info, kept, now);
    const removed = group.members.filter(member => !roster.some(entry => entry.account === member.account));
    const invites = await distribute(info, [...roster, ...removed]);
    await saveOwnGroupInfo(info, [...new Set([...kept, ...invites])], now);
  };

  const sendMessage: ChatManager['sendMessage'] = async (peer, content) => {
    const ids = { messageId: randomId(), timestamp: Date.now() };
    await addMessage({
      messageId: ids.messageId,
      peerAccountId: peer,
      ...(isGroupPeer(peer) ? { groupId: groupIdOf(peer) } : {}),
      timestamp: ids.timestamp,
      direction: 'outgoing',
      status: 'sending',
      content,
      reactions: [],
      editedAt: null,
    });
    if (!isGroupPeer(peer)) await settlePendingSeen(peer, ids.messageId);
    // The real message ends our typing hint on the peer's side.
    typingSender.sent(peer);
    // Too large, or no usable peer device: the row stays as evidence.
    await submit(peer, content, ids).catch(async error => {
      await setMessageStatus(ids.messageId, 'failed');
      throw error;
    });
  };

  const sendRequestTo = async (peer: PeerIdentity, welcomeMessage: string | null): Promise<void> => {
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
  };

  return {
    sendRequest: sendRequestTo,

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

    sendMessage,

    pressButton: async (peer, messageId, row, index) => {
      const target = await getMessage(messageId);
      if (!target || target.peerAccountId !== peer || target.direction !== 'incoming' || target.content.type !== 'buttons') {
        throw new Error('This message has no buttons.');
      }
      if (target.content.oneShot && target.content.pressed) throw new Error('These buttons were already used.');
      const button = target.content.rows[row]?.[index];
      if (!button) throw new Error('This button does not exist.');
      const action = button.action;
      switch (action.kind) {
        case 'command':
          await sendMessage(peer, { type: 'text', text: action.command });
          break;
        case 'callback':
          await submit(peer, { type: 'buttonPress', messageId, row, index, payload: action.payload }, { messageId: randomId(), timestamp: Date.now() });
          break;
        case 'url':
          break;
        case 'tx':
          // The signing strip runs it (dry-run, sign, references); this only records the press.
          break;
        case 'unsupported':
          throw new Error('This app cannot run this action yet.');
      }
      await markButtonPressed(messageId, row, index);
    },

    sendButtons: async (peer, buttons) => {
      const ids = { messageId: randomId(), timestamp: Date.now() };
      const content: OutgoingContent = { type: 'buttons', ...buttons };
      await addMessage({
        messageId: ids.messageId,
        peerAccountId: peer,
        timestamp: ids.timestamp,
        direction: 'outgoing',
        status: 'sending',
        content: { type: 'buttons', text: buttons.text, rows: keyboardOf(buttons.rows), oneShot: buttons.oneShot, pressed: null },
        reactions: [],
        editedAt: null,
      });
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

    deleteForEveryone: async (peer, messageId) => {
      const row = await getMessage(messageId);
      if (!row || row.peerAccountId !== peer || row.direction !== 'outgoing') throw new Error('Only your own message can be deleted.');
      if (row.content.type === 'deleted') return;
      if (row.content.type !== 'text' && row.content.type !== 'reply') throw new Error('Only a text message can be deleted.');
      if (row.status === 'failed') {
        await removeMessage(messageId);
        return;
      }
      // No session: fail before the tombstone, so the user can try again.
      if (!isGroupPeer(peer) && !sessions.has(peer)) throw new Error('no chat session with this contact');
      // The SDK exposes no way to take one message out of the outstanding
      // batch (RFC-0003 case 2), so a sent message is always retracted
      // cooperatively (docs/decisions.md).
      await tombstoneMessage(messageId);
      await submit(peer, { type: 'deleted', targetMessageId: messageId }, { messageId: randomId(), timestamp: Date.now() });
    },

    retry: async (peer, messageId) => {
      const row = await getMessage(messageId);
      if (!row || row.peerAccountId !== peer || row.direction !== 'outgoing' || row.status !== 'failed') return;
      if (row.content.type !== 'text' && row.content.type !== 'reply') throw new Error('Only a text message can be sent again.');
      const content: OutgoingContent =
        row.content.type === 'reply' ? { type: 'reply', messageId: row.content.messageId, text: row.content.text } : { type: 'text', text: row.content.text };
      await setMessageStatus(messageId, 'sending');
      // The same id: the peer dedups by it, so a first attempt that did land is not shown twice.
      await submit(peer, content, { messageId, timestamp: row.timestamp }).catch(async error => {
        await setMessageStatus(messageId, 'failed');
        throw error;
      });
    },

    markRead: async peer => {
      await markRoomRead(peer);
      // Spec 0009: no read receipts in groups (v1).
      if (isGroupPeer(peer) || !(await readChatPrefs()).readReceipts) return;
      const newest = (await listMessages(peer)).filter(row => row.direction === 'incoming').at(-1);
      if (newest) seenSender.displayed(peer, newest.messageId);
    },

    composing: (peer, text) => typingSender.edited(peer, text),

    typing,

    sendTyping: (peer, kind, until) => submit(peer, { type: 'typing', kind, until }, { messageId: randomId(), timestamp: Date.now() }),

    roomOpened: async peer => {
      if (starting.has(peer) || !sessions.has(peer)) return;
      starting.add(peer);
      try {
        if (!shouldSendStart(await getPeerInfo(peer))) return;
        // Marked first: a failed send is not tried again on its own (the row stays, with Retry).
        await markStartSent(peer, Date.now());
        await sendMessage(peer, { type: 'text', text: '/start' });
      } finally {
        starting.delete(peer);
      }
    },

    sendBotInfo: async (peer, info) => {
      const contact = await getContact(peer);
      if (!contact) throw new Error('no contact to describe this client to');
      await ensureChannel(hexToBytes(peer), contact.chatPublicKey).post(toWire({ type: 'botInfo', info }));
    },

    sendReference: async (peer, reference) => {
      const ids = { messageId: randomId(), timestamp: Date.now() };
      const { messageId, added } = await applyReference(peer, 'outgoing', ids, reference);
      // The session marks the first message sent and delivered (the row's id).
      await submit(peer, { type: 'transactionReference', reference }, ids).catch(async error => {
        // The chain state is real even when the peer was not told: the row stays, marked.
        if (added) await setMessageStatus(messageId, 'failed');
        throw error;
      });
    },

    createGroup: async (name, members) => {
      const title = name.trim();
      if (title === '' || [...title].length > MAX_GROUP_NAME) throw new Error(`A group name has 1 to ${MAX_GROUP_NAME} characters.`);
      if (!deps.username) throw new Error('Your username is not known yet.');
      const now = Date.now();
      const roster = [{ account: self, username: deps.username, joinedAt: now }, ...rosterOf(members, [], now)];
      if (roster.length < 2) throw new Error('Pick at least one member.');
      if (roster.length > MAX_GROUP_MEMBERS) throw new Error(`A group has at most ${MAX_GROUP_MEMBERS} members.`);
      const info: GroupInfo = { groupId: randomId(), name: title, admin: self, members: roster, version: 1, createdAt: now };
      await saveOwnGroupInfo(info, [], now);
      const invites = await distribute(info, roster);
      if (invites.length > 0) await saveOwnGroupInfo(info, invites, now);
      return info.groupId;
    },

    sendToGroup: (groupId, content) => sendMessage(groupPeerOf(groupId), content),

    updateRoster,

    leaveGroup: async groupId => {
      const group = await getGroup(groupId);
      if (!group || group.self !== 'member') return;
      const failures: unknown[] = [];
      for (const member of otherMembers(group, self)) {
        await sendTo(member.account, { type: 'groupLeave', groupId }).catch(error => failures.push(error));
      }
      await markSelfLeft(groupId);
      if (failures.length > 0) console.warn('[chat] groupLeave did not reach %d member(s)', failures.length);
    },

    dispose: () => {
      disposed = true;
      typingSender.dispose();
      seenSender.dispose();
      typing.dispose();
      stopStatus();
      stopTransport();
    },
  };
};
