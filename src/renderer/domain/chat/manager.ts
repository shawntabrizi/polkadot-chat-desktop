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
import {
  type ContactRow,
  type GroupJoinRow,
  type GroupPeerId,
  type MessageRow,
  type PeerDevice,
  type RequestRow,
  db,
  groupIdOf,
  groupPeerOf,
  isGroupPeer,
} from '../../app/database';
import type { ConnectionStatus } from '../../app/statementStore';
import { getContact, listContacts, removeContactDevice, upsertContactDevice } from '../contacts/repository';
import { type DeviceKeys, isUsablePeerDevice } from '../device/keys';
import type { IdentityLookup, PeerIdentity } from '../identity/lookup';
import type { UserIdentity } from '../identity/userIdentity';
import { sendChatRequest, subscribeToIncomingRequests } from '../requests/gateway';
import { intakeRequestStatement } from '../requests/intake';
import { addRequest, getRequest, listRequests, setRequestStatus } from '../requests/repository';

import { hopTicket, setHopLocation, withAttachmentKeys } from './attachmentKeyStore';
import {
  type Capabilities,
  type FileRail,
  NO_FILE_RAIL,
  OWN_CAPABILITIES,
  capabilitiesDue,
  capabilitiesUnsent,
  dropDeviceCapabilities,
  fileRailOf,
  GROUP_SUPPORT_WORDS,
  formFor,
  loadEffective,
  loadGroupSupport,
  markCapabilitiesSent,
  storeCapabilities,
} from './capabilities';
import { sharedGroupName } from './groupNames';
import { admitAfterDelete, deleteChatLocally, isBlocked, unfinishedDeletes, withdrawRequestLocally } from './chatActions';
import {
  type Attachment,
  type AttachmentItem,
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
import { joinProof } from './groupKeys';
import { type GroupsV2, createGroupsV2, isV2, joinOpenerText, parseInviteLink } from './groupsV2';
import { type IdentityChannel, createIdentityChannel } from './identityChannel';
import type { ButtonWire, GroupControl, IdentityChannelEvent } from './identityEvents';
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
import { type SubmissionMeter, createSubmissionMeter } from './submissions';
import { ACCOUNT_FULL_NOTICE, ACCOUNT_FULL_REASON, type AccountSpace, isAccountFullStop } from './accountSpace';

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
  /**
   * A new row: text, or a reply. Resolves once the row exists; delivery is
   * tracked on the row. `forwardedFrom` (M12e) marks the row as a forwarded
   * copy for this device only: the wire carries the plain text.
   */
  sendMessage: (
    peer: ChatTargetId,
    content: { type: 'text'; text: string } | { type: 'reply'; messageId: string; text: string },
    options?: { forwardedFrom?: string },
  ) => Promise<void>;
  /**
   * Spec 0012: an attachment message to a contact. The row exists at once
   * (status `sending`); `upload(messageId)` stores the chunks on Bulletin;
   * only when it resolves is the message submitted, as one statement on the
   * normal path. A failed upload marks the row failed and sends nothing.
   */
  sendAttachment: (peer: HexString, content: { items: AttachmentItem[]; caption: string | null }, upload: (messageId: string) => Promise<void>) => Promise<void>;
  /**
   * Spec 0013/0014: the rail an attachment of `bytes` in all to `peer` takes
   * now: `bulletin` (the 0014 variant), or `hop` (a baseline device, or a
   * file over 25 MiB). Rejects with the 0013 text when none fits.
   */
  attachmentRail: (peer: HexString, bytes?: number) => Promise<FileRail>;
  /**
   * Base spec HOP send (M20b): one file as `RichText` + `P2PMixnet`. The row
   * exists at once (`attachment` without its node yet); `upload(messageId)`
   * puts the file on a HOP node and resolves with where; then the message
   * goes as one statement. A failed upload marks the row failed.
   */
  sendHopFile: (
    peer: HexString,
    content: { text: string | null; attachment: Attachment },
    upload: (messageId: string) => Promise<NonNullable<Attachment['hop']>>,
  ) => Promise<string>;
  /** Spec 0013: `effective(peer)`, the intersection over the peer's devices (tests and diagnostics). */
  capabilitiesOf: (peer: HexString) => Promise<Capabilities>;
  /**
   * M12e: withdraw the pending request this identity sent `peer`. The row is
   * removed and the identity channel that waits for the accept is closed, so
   * nothing more is submitted for it; the request statement expires in the
   * store. A later accept is not seen: a new chat needs a new request.
   */
  withdrawRequest: (peer: HexString, at?: number) => Promise<void>;
  /**
   * M12e "Delete chat", after its Undo time: a group is left first (if still
   * a member) and then removed; a pending outgoing request is withdrawn; the
   * rest is `deleteChatLocally`. The peer keeps their copy.
   */
  deleteChat: (peer: ChatTargetId, at: number) => Promise<void>;
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
   * count and, if read receipts are on, queues spec 0005 `seen` for the newest
   * message from the peer: it rides the next message to that peer within 5 s
   * (one submission), else goes out alone when the 5 s end.
   */
  markRead: (peer: ChatTargetId) => Promise<void>;
  /**
   * A person changed the composer text for `peer` (not the clear after a
   * send). Sends spec 0005 `typing` (rate-limited) only if the user turned
   * "Send typing indicators" on (M12c: off by default).
   */
  composing: (peer: ChatTargetId, text: string) => void;
  /** Each peer's typing state (spec 0005), in memory, with the local "working" state of known bots. */
  typing: TypingStore;
  /** M12c: statements this manager submitted and messages the user sent, this session. */
  submissions: Pick<SubmissionMeter, 'snapshot' | 'subscribe'>;
  /** `AccountFull`: the chat list banner shows while `full` is true. */
  accountSpace: Pick<AccountSpace, 'snapshot' | 'subscribe'>;
  /** Every `transactionReference` a peer sends (spec 0007), so its finality can be followed on the chain. */
  onReference: (listener: (reference: TxReference) => void) => VoidFunction;
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
   * and keep one row for it that moves through the states. Since M12c the
   * caller sends one state per transaction (in block or failed; submitted
   * only when no block took it in 30 s); later states change the row only
   * (`recordReference`). Never waits for finality. `peer` may be a group
   * (M14): the reference then rides our next carrier on its topic.
   */
  sendReference: (peer: ChatTargetId, reference: TxReference) => Promise<void>;
  /**
   * Spec 0007, local only: the row of our own transaction for `peer` takes
   * this state (a new row if there is none, not yet sent). Nothing goes on
   * the wire.
   */
  recordReference: (peer: ChatTargetId, reference: TxReference) => Promise<void>;
  /**
   * Spec 0009: a new group with us as admin; `members` are the others. Sends
   * the roster (v1) to each member we have a chat with, and a chat request
   * to each one we have not (the roster follows once they accept). Returns
   * the group id; its room is `group:<id>`.
   */
  createGroup: (name: string, members: GroupMemberInput[], options?: { fanOut?: boolean }) => Promise<string>;
  /** Spec 0009: a text or reply to the group (the same as `sendMessage(group:<id>, …)`). */
  sendToGroup: (groupId: string, content: { type: 'text'; text: string } | { type: 'reply'; messageId: string; text: string }) => Promise<void>;
  /**
   * Spec 0009, admin only: a new roster (version + 1) to every member of it
   * and to every member it removes. `members` lists everyone but us.
   */
  updateRoster: (groupId: string, members: GroupMemberInput[]) => Promise<void>;
  /** Spec 0009: `groupLeave` to every other member; we send and take nothing more. Spec 0011: one carrier, then our keys go. */
  leaveGroup: (groupId: string) => Promise<void>;
  /** Spec 0011, admin: remove a member (a rekey on the old topic and the state on the new one: two submissions). */
  removeGroupMember: (groupId: string, account: HexString) => Promise<void>;
  /** Spec 0011, admin: add a member (the state, then a `welcome` over the DM session, or a chat request first). */
  addGroupMember: (groupId: string, member: GroupMemberInput) => Promise<void>;
  /** Spec 0011: our own v1 room becomes a private group in place (its rows stay). */
  upgradeGroup: (groupId: string) => Promise<void>;
  /** Spec 0011: ask a member (a bot admin first) for group messages we missed. Resolves who was asked. */
  requestGroupHistory: (groupId: string, to?: HexString, since?: number) => Promise<HexString | null>;
  /** Spec 0011: the group topics this manager watches (the e2e reads them). */
  groupTopics: () => string[];
  /** M16b: our invite link for the group (a new invite in the state when we have none; policy 0 becomes 1). */
  createGroupInvite: (groupId: string) => Promise<string>;
  /** M16b: every invite leaves the state; old links stop working. */
  revokeGroupInvites: (groupId: string) => Promise<void>;
  /**
   * M16b: join by an invite link (0011 "Invite link"): a `joinRequest` to a
   * listed admin we already chat with, else a chat request to the first one
   * the People chain knows, with the capability in its opener. The state of
   * the join is the `groupJoins` row until the admin's `welcome` arrives.
   */
  joinGroupByLink: (text: string) => Promise<{ groupId: string; name: string; member: boolean }>;
  approveGroupJoin: (groupId: string, account: HexString) => Promise<void>;
  rejectGroupJoin: (groupId: string, account: HexString) => Promise<void>;
  pinGroupMessage: (groupId: string, messageId: string, pinned: boolean) => Promise<void>;
  setGroupSettings: (groupId: string, settings: { name?: string; slowModeSecs?: number; joinPolicy?: number; historyShare?: number }) => Promise<void>;
  setGroupRole: (groupId: string, account: HexString, role: 0 | 1) => Promise<void>;
  setGroupPermissions: (groupId: string, account: HexString, permissions: number) => Promise<void>;
  transferGroupOwnership: (groupId: string, account: HexString) => Promise<void>;
  /** M16b: a stranger's invite, accepted (declining is "Delete chat"). */
  acceptGroupInvite: (groupId: string) => Promise<void>;
  dispose: VoidFunction;
};

/** The group a pairwise content is about, if any. */
const groupIdOfEffect = (effect: IncomingEffect): string | null => {
  switch (effect.kind) {
    case 'groupInfo':
      return effect.info.groupId;
    case 'groupLeave':
    case 'groupMessage':
      return effect.groupId;
    case 'groupControl':
      return effect.control.value.groupId;
    default:
      return null;
  }
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
  const { identity, deviceKeys, lookup } = deps;
  // Everything this device submits goes through the meter (M12c diagnostics),
  // which also merges back-to-back session requests into one submission.
  const meter = createSubmissionMeter(deps.statementStore);
  const statementStore = meter.store;
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

  /**
   * An own message did not go out. After a final `AccountFull` the row says
   * why, and its chat gets one error line while the account stays full
   * (docs/decisions.md "AccountFull"). No retry starts on its own.
   */
  const failOutgoing = async (peer: ChatTargetId, messageId: string, error: unknown): Promise<void> => {
    const row = await getMessage(messageId);
    if (!row || row.direction !== 'outgoing') return;
    if (!isAccountFullStop(error)) {
      await setMessageStatus(messageId, 'failed');
      return;
    }
    await setMessageStatus(messageId, 'failed', ACCOUNT_FULL_REASON);
    const since = meter.space.snapshot().since ?? Date.now();
    const notice: MessageContent = { type: 'notice', text: ACCOUNT_FULL_NOTICE, tone: 'error' };
    const line = systemRow(peer, `account-full:${since}:${peer}`, Date.now(), notice);
    await addMessage(isGroupPeer(peer) ? { ...line, groupId: groupIdOf(peer) } : line, { read: true });
  };

  // ── Spec 0005 signals (ephemeral: never a row, a notification or unread) ─

  const typing = createTypingStore();
  const pendingSeen = createPendingSeen();
  const referenceListeners = new Set<(reference: TxReference) => void>();
  const referenceArrived = (reference: TxReference) => {
    for (const listener of referenceListeners) listener(reference);
  };

  /** Sends one signal; a signal that cannot go out is dropped (it is only a hint). */
  const signal = (peer: ChatTargetId, content: OutgoingContent, what: string) => {
    if (!isGroupPeer(peer) && !sessions.has(peer)) return;
    guard(submit(peer, content, { messageId: randomId(), timestamp: Date.now() }), what);
  };
  // The composer calls this only while the user edits; the switch is read at
  // each send, so turning it off stops the next hint.
  const typingSender = createTypingSender((peer, kind, until) =>
    guard(
      readChatPrefs().then(prefs => {
        if (prefs.sendTyping) signal(peer as ChatTargetId, { type: 'typing', kind, until }, 'typing');
      }),
      'typing',
    ),
  );
  // Reached only when no message to the peer took the `seen` along within 5 s.
  const seenSender = createSeenSender((peer, upTo, at) => signal(peer as HexString, { type: 'seen', upTo, at }, 'seen'));

  /** An own row now exists: apply a `seen` that named it before it did. */
  const settlePendingSeen = async (peer: HexString, messageId: string): Promise<void> => {
    const at = pendingSeen.take(peer, messageId);
    if (at !== null) await applySeen(peer, messageId, at);
  };

  // ── Inbound content (session and identity channel alike) ──────────────

  const handleIncoming = async (peer: HexString, message: IncomingChatMessage): Promise<void> => {
    // M12e: a blocked peer's content is dropped here, before any row or notification.
    if (await isBlocked(peer)) return;
    const effect = fromWire(message.content);
    // A deleted chat: what was said before the delete is read again from the
    // store at each start and must not bring the room back (docs/decisions.md
    // "Deleted chats stay deleted"). A group's content is checked by its room.
    const groupId = groupIdOfEffect(effect);
    if (!(await admitAfterDelete(groupId === null ? peer : groupPeerOf(groupId), message.timestamp))) return;
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
        // A bot that removes its placeholder is done working (spec 0005).
        typing.endLocal(peer);
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
        referenceArrived(effect.reference);
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
      case 'capabilities':
        // Spec 0013, keyed as pca keys it: the sending device (its session's
        // topic), or on the identity session the device its batch accepted
        // with, else the peer's identity account (it stands in while no device is known).
        await storeCapabilities(peer, message.device ?? hexToBytes(peer), effect.capabilities, message.timestamp);
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
      case 'groupControl':
        await onGroupControl(peer, effect.control);
        return;
      case 'ignore':
        return;
    }
  };

  // ── Spec 0011 groups, pairwise control ────────────────────────────────

  const onGroupControl = async (sender: HexString, control: GroupControl): Promise<void> => {
    const outcome = await groupsV2.onControl(sender, control);
    // M16b: our own join by link ends with the admin's welcome, or waits on its decision.
    if (control.tag === 'welcome' && (outcome === 'welcomed' || outcome === 'rekeyed')) await db.groupJoins.delete(control.value.groupId);
    if (control.tag === 'joinDecision') {
      const join = await db.groupJoins.get(control.value.groupId);
      if (join && join.admin === sender && join.status !== 'rejected')
        await db.groupJoins.put({ ...join, status: control.value.status === 0 ? 'pending' : 'rejected', updatedAt: Date.now() });
      return;
    }
    if (['welcomed', 'rekeyed', 'invited', 'answered', 'done', 'page', 'held', 'pending', 'admitted'].includes(outcome)) return;
    console.warn('[chat] group control %s from %s: %s', control.tag, sender, outcome);
  };

  /** M16b: the joins by link that wait for this admin's chat: their `joinRequest` goes now. */
  const sendPendingJoins = async (peer: HexString): Promise<void> => {
    for (const join of await db.groupJoins.toArray()) {
      if (join.admin !== peer || join.status !== 'requested') continue;
      await submit(peer, { type: 'groupControl', control: joinRequestOf(join) }, { messageId: randomId(), timestamp: Date.now() });
    }
  };

  const joinRequestOf = (join: GroupJoinRow): GroupControl => ({ tag: 'joinRequest', value: { groupId: join.groupId, inviteId: join.inviteId, proof: join.proof, note: '' } });

  /**
   * M16b, admin side: a chat request whose opener carries a valid `[grp:…]`
   * capability for one of our invites is accepted at once (0011 "Invite
   * link"); the joiner then sends `joinRequest` on the new session. A new
   * contact made this way is marked (`joinedVia`): a stranger for welcomes.
   */
  const admitJoinOpener = async (request: RequestRow): Promise<void> => {
    const groupId = await groupsV2.joinOpenerGroup(request.peerAccountId, request.welcomeMessage);
    if (!groupId) return;
    const known = !!(await getContact(request.peerAccountId));
    await acceptRequest(request.requestId);
    if (!known) await db.contacts.update(request.peerAccountId, { joinedVia: groupId });
    console.warn('[chat] accepted a join request for %s from %s', groupId, request.peerUsername);
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
    // A v1 wrapper for a group this client runs as v2 (or a stale copy after the upgrade): not taken.
    if (isV2(await getGroup(groupId))) return;
    const admitted = await admitGroupMessage(groupId, sender, seq, message.timestamp);
    if (!admitted) {
      console.warn('[chat] dropped a group message for %s from a non-member %s', groupId, sender);
      return;
    }
    await applyGroupEffect(admitted.peer, groupId, sender, message, effect, seq);
  };

  /**
   * One group content from `sender`, already admitted (v1 roster and seq, or
   * a v2 carrier's signer and `post` checks), applied to the group's room.
   */
  const applyGroupEffect = async (room: GroupPeerId, groupId: string, sender: HexString, message: IncomingChatMessage, effect: IncomingEffect, seq?: number): Promise<void> => {
    switch (effect.kind) {
      case 'message':
        typing.messageFrom(room, message.timestamp);
        await addMessage({
          messageId: message.messageId,
          peerAccountId: room,
          groupId,
          senderAccountId: sender,
          ...(seq === undefined ? {} : { groupSeq: seq }),
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
        // The member who signed it is named on the bubble, as on any group message (M14).
        await applyReference(room, 'incoming', { messageId: message.messageId, timestamp: message.timestamp }, effect.reference, { senderAccountId: sender });
        referenceArrived(effect.reference);
        return;
      // No read receipts in groups (v1); calls, rosters, capabilities (0013: never in groups) and nested group kinds are not group content.
      case 'seen':
      case 'capabilities':
      case 'callOffer':
      case 'deviceAdded':
      case 'deviceRemoved':
      case 'groupInfo':
      case 'groupMessage':
      case 'groupLeave':
      case 'groupControl':
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
    onSendFailed: (peer, messageId, error) => guard(failOutgoing(peer, messageId, error), 'failed message'),
  });

  // Spec 0011: v2 groups (one statement per message on the group topic).
  const ownSigner = bytesToHex(deviceKeys.statementAccountPublicKey);
  const peerIdentity = async (account: HexString) => lookup.getPeerIdentity(hexToBytes(account)).catch(() => null);
  const groupsV2: GroupsV2 = createGroupsV2({
    self,
    signer: ownSigner,
    ownChatPrivateKey: identity.identityChatPrivateKey,
    ownChatPublicKey: identity.identityChatPublicKey,
    store: statementStore,
    prover,
    chatKeyOf: async account => (await getContact(account))?.chatPublicKey ?? (await peerIdentity(account))?.chatPublicKey ?? null,
    // Each device signs with its own statement account; those are the member's posting set (0011 Multi-device).
    postingOf: async account =>
      account === self ? [ownSigner] : ((await getContact(account))?.devices ?? []).map(device => bytesToHex(device.statementAccountId)),
    nameOf: async account =>
      (account === self ? deps.username : undefined) ?? (await getContact(account))?.username ?? (await peerIdentity(account))?.username ?? `${account.slice(0, 8)}…`,
    isBot: async account => ((await getPeerInfo(account))?.botInfo ?? null) !== null || ((await getPeerInfo(account))?.botSignalAt ?? null) !== null,
    reachable: account => sessions.has(account),
    sendControl: (peer, control) => submit(peer, { type: 'groupControl', control }, { messageId: randomId(), timestamp: Date.now() }),
    applyMessage: (groupId, sender, message) => applyGroupEffect(groupPeerOf(groupId), groupId, sender, message, fromWire(message.content)),
    trusted: async account => {
      const contact = await getContact(account);
      return !!contact && !contact.joinedVia;
    },
    joinRequested: async groupId => !!(await db.groupJoins.get(groupId)),
    onAccountFull: where => meter.space.markFull(where),
  });
  let groupTimer: ReturnType<typeof setInterval> | null = null;

  // ── Roster ─────────────────────────────────────────────────────────────

  const addPeerDevice = async (peer: HexString, device: PeerDevice): Promise<void> => {
    if (!isUsablePeerDevice(device)) return;
    const contact = await getContact(peer);
    if (!contact) return;
    const known = contact.devices.some(existing => bytesToHex(existing.statementAccountId) === bytesToHex(device.statementAccountId));
    const updated = await upsertContactDevice(contact, device);
    sessions.publishRoster(peer, updated.devices);
    // Spec 0013: a new device has not seen our set (a replayed add at start is not new).
    if (!known) await capabilitiesUnsent(peer);
  };

  const removePeerDevice = async (peer: HexString, statementAccountId: Uint8Array): Promise<void> => {
    const updated = await removeContactDevice(peer, statementAccountId);
    if (updated) sessions.publishRoster(peer, updated.devices);
    await dropDeviceCapabilities(peer, statementAccountId);
  };

  /**
   * Spec 0013 `effective(peer)`. A bot that sent its `botInfo` counts as
   * advertised (owner ruling): the pca transition set. Content on the identity
   * channel alone does not: a bot with its extensions off is a baseline peer.
   */
  const effectiveFor = async (peer: HexString): Promise<Capabilities> => {
    const [contact, info] = await Promise.all([getContact(peer), getPeerInfo(peer)]);
    const bot = (info?.botInfo ?? null) !== null;
    return loadEffective(peer, contact?.devices ?? [], bot, hexToBytes(peer));
  };

  /**
   * Owner ask 2026-09-24: nobody is put in a private group unless every known
   * device of theirs advertised groups v2 (0013 feature bit 0; a bot through
   * its `botInfo`). Checked before any state statement, so a refused member
   * costs nothing and no invite, welcome, roster or history goes to them.
   */
  const assertGroupReady = async (members: readonly GroupMemberInput[]): Promise<void> => {
    for (const member of members) {
      if (member.account === self) continue;
      const [contact, info] = await Promise.all([getContact(member.account), getPeerInfo(member.account)]);
      const support = await loadGroupSupport(member.account, contact?.devices ?? [], (info?.botInfo ?? null) !== null, hexToBytes(member.account));
      if (support !== 'ready') throw new Error(`${member.username} cannot be added: ${GROUP_SUPPORT_WORDS[support].toLowerCase()}.`);
    }
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
    guard(sendPendingJoins(contact.accountId), 'group joins');
    return contact;
  };

  /** Spec 0009: a member we invited by chat request accepted it: the roster goes to them now. */
  const sendPendingInvites = async (peer: HexString): Promise<void> => {
    for (const group of await listGroups()) {
      if (group.admin !== self || group.self !== 'member' || !group.invites.includes(peer)) continue;
      if (isV2(group)) await groupsV2.welcomeTo(group.id, peer);
      else await submit(peer, { type: 'groupInfo', info: groupInfoOf(group) }, { messageId: randomId(), timestamp: Date.now() });
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
        // An accept read again after the chat was deleted (every start does) is old news.
        if (!(await admitAfterDelete(peer, event.acceptedAt))) {
          await addPeerDevice(peer, event.device);
          return;
        }
        if (request.status === 'pending') {
          await setRequestStatus(request.requestId, 'accepted');
          // Spec 0013: a chat starts; our set rides our first message in it.
          await capabilitiesUnsent(peer);
        }
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

  const acceptRequest: ChatManager['acceptRequest'] = async requestId => {
    const request = await requireRequest(requestId, 'incoming');
    await setRequestStatus(requestId, 'accepted');
    // Spec 0013: a chat starts; our set rides our first message in it.
    await capabilitiesUnsent(request.peerAccountId);
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
      guard(
        intakeRequestStatement({ identity, lookup }, data).then(row => (row ? admitJoinOpener(row) : undefined)),
        'request intake',
      ),
    );
    guard(groupsV2.start().then(() => groupsV2.tick()), 'group topics');
    // Spec 0011 timers: key erase after 14 days, admin rotation after 7 days.
    groupTimer ??= setInterval(() => guard(groupsV2.tick(), 'group timers'), 3_600_000);
  };

  const stopTransport = (): void => {
    groupsV2.stop();
    if (groupTimer) clearInterval(groupTimer);
    groupTimer = null;
    stopRequests();
    sessions.stopAll();
    for (const channel of channels.values()) channel.dispose();
    channels.clear();
  };

  const deleteChat: ChatManager['deleteChat'] = async (peer, at) => {
    if (isGroupPeer(peer)) {
      const group = await getGroup(groupIdOf(peer));
      if (group?.self === 'member') await leaveGroup(group.id);
    } else if (!(await getContact(peer))) {
      channels.get(peer)?.dispose();
      channels.delete(peer);
    }
    await deleteChatLocally(peer, at);
  };

  await startTransport();
  // A delete or withdraw whose Undo time was cut short by a quit: its mark is
  // on disk, its commit was only in memory. It runs now, at the press's time.
  guard(
    unfinishedDeletes().then(async marks => {
      for (const mark of marks) await deleteChat(mark.peerId as ChatTargetId, mark.deletedAt);
    }),
    'unfinished deletes',
  );

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

  // Spec 0013: peers whose copy of our set is on its way (a second message in the same moment does not add another).
  const capabilitiesQueued = new Set<HexString>();

  const submit = async (peer: ChatTargetId, content: OutgoingContent, ids: { messageId: string; timestamp: number }) => {
    if (isGroupPeer(peer)) {
      const group = await getGroup(groupIdOf(peer));
      if (!isV2(group)) return fanOut(peer, content, ids);
      // 0011: typing and seen are not sent in groups; everything else is one carrier statement.
      if (content.type === 'typing' || content.type === 'seen') return;
      return groupsV2.send(group.id, toWire(content), ids);
    }
    if (!sessions.has(peer)) throw new Error('no chat session with this contact');
    // Spec 0013 (owner ruling 2026-09-24): every extension kind only to a
    // peer whose every device listed it; else its fallback, or nothing.
    const effective = await effectiveFor(peer);
    // A `joinRequest` goes only to an admin an invite link names: the link is that admin's own
    // groups v2 client speaking, and the admin sends nothing (so no set) until this request
    // arrives. Gating it on a set would stall every join by link (seen in e2e:group2b after M20).
    const joinRequest = content.type === 'groupControl' && content.control.tag === 'joinRequest';
    const form: ReturnType<typeof formFor> = joinRequest ? { send: content } : formFor(effective, content);
    if ('drop' in form) return;
    if ('refuse' in form) throw new Error(form.refuse);
    const due = await capabilitiesDue(peer);
    // Everything below enters the session batch in the same task, so the
    // submission meter sends one statement for all of it.
    // Spec 0005 (revision 2026-09-23): a `seen` still waiting for this peer
    // rides this message, if the peer reads `seen`.
    const signalOnly = form.send.type === 'seen' || form.send.type === 'typing';
    const pending = signalOnly ? null : seenSender.take(peer);
    const seen = pending && 'send' in formFor(effective, { type: 'seen', ...pending }) ? pending : null;
    const riding: Promise<unknown>[] = [];
    // Spec 0013: our set rides the first message of a chat (and after a set change or a new peer device).
    // Not awaited: the message's own status does not wait for the bookkeeping.
    if (due && !capabilitiesQueued.has(peer)) {
      capabilitiesQueued.add(peer);
      void sessions
        .send(peer, toWire({ type: 'capabilities', capabilities: OWN_CAPABILITIES }), { messageId: randomId(), timestamp: Date.now() })
        .then(() => markCapabilitiesSent(peer))
        .catch((error: unknown) => console.warn('[chat] capabilities did not go out', error))
        .finally(() => capabilitiesQueued.delete(peer));
    }
    if (seen) {
      riding.push(
        sessions.send(peer, toWire({ type: 'seen', ...seen }), { messageId: randomId(), timestamp: Date.now() }).catch((error: unknown) => console.warn('[chat] seen did not go out', error)),
      );
    }
    await Promise.all([sessions.send(peer, toWire(form.send), ids), ...riding]);
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
    const reachable = otherMembers(group, self).filter(member => sessions.has(member.account));
    // Spec 0013: a member whose devices do not all read the group kind gets no copy.
    const readable = await Promise.all(reachable.map(async member => 'send' in formFor(await effectiveFor(member.account), { type: 'groupMessage', groupId: group.id, infoVersion: group.version, seq: 0, content })));
    const targets = reachable.filter((_member, i) => readable[i]);
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

  /**
   * Spec 0011: members no DM reached get a chat request; their `welcome` follows the accept (`sendPendingInvites`).
   * Only a member whose devices all advertised groups v2 (an upgraded v1 roster can hold others): no invite text to anyone else.
   * An unnamed group's invite names it as the invitee will see it (their derived name, usernames only).
   */
  const inviteUnreached = async (groupId: string, members: readonly GroupMemberInput[], unreached: readonly HexString[]): Promise<void> => {
    if (unreached.length === 0) return;
    const group = await getGroup(groupId);
    const invited: HexString[] = [];
    for (const account of unreached) {
      const member = members.find(entry => entry.account === account);
      if (!member) continue;
      const ready = await assertGroupReady([member]).then(
        () => true,
        (error: unknown) => (console.warn('[chat] no group invite', error), false),
      );
      if (!ready) continue;
      invited.push(account);
      await inviteByRequest(member, group ? sharedGroupName(group, account) : '').catch(error => console.warn('[chat] group invite failed', error));
    }
    await db.groups.update(groupId, { invites: invited });
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
    if (isV2(group)) throw new Error('A private group changes members one at a time.');
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

  /**
   * Review M16b ruling 6: a message we send to a contact made only by a join
   * request (`joinedVia`) says we know them now, so their later `welcome`s
   * are no longer a stranger's invites.
   */
  const trustByMessage = async (peer: ChatTargetId): Promise<void> => {
    if (isGroupPeer(peer)) return;
    const contact = await getContact(peer);
    if (contact?.joinedVia) await db.contacts.update(peer, { joinedVia: undefined });
  };

  const sendMessage: ChatManager['sendMessage'] = async (peer, content, options = {}) => {
    const ids = { messageId: randomId(), timestamp: Date.now() };
    await trustByMessage(peer);
    await addMessage({
      messageId: ids.messageId,
      peerAccountId: peer,
      ...(isGroupPeer(peer) ? { groupId: groupIdOf(peer) } : {}),
      ...(options.forwardedFrom ? { forwardedFrom: options.forwardedFrom } : {}),
      timestamp: ids.timestamp,
      direction: 'outgoing',
      status: 'sending',
      content,
      reactions: [],
      editedAt: null,
    });
    // Spec 0005 (revision 2026-09-23): a known bot shows "working" from now
    // until its reply, with no wire signal.
    const bot = !isGroupPeer(peer) && ((await getPeerInfo(peer))?.botInfo ?? null) !== null;
    if (!isGroupPeer(peer)) await settlePendingSeen(peer, ids.messageId);
    // The real message ends our typing hint on the peer's side.
    typingSender.sent(peer);
    if (bot) typing.localWorking(peer);
    // Too large, or no usable peer device: the row stays as evidence.
    await submit(peer, content, ids).catch(async error => {
      if (bot) typing.endLocal(peer);
      await failOutgoing(peer, ids.messageId, error);
      throw error;
    });
    meter.messageSent();
  };

  const sendAttachment: ChatManager['sendAttachment'] = async (peer, content, upload) => {
    const ids = { messageId: randomId(), timestamp: Date.now() };
    const row: MessageContent = { type: 'attachment', items: content.items, caption: content.caption };
    await trustByMessage(peer);
    await addMessage({ messageId: ids.messageId, peerAccountId: peer, timestamp: ids.timestamp, direction: 'outgoing', status: 'sending', content: row, reactions: [], editedAt: null });
    await settlePendingSeen(peer, ids.messageId);
    typingSender.sent(peer);
    try {
      await upload(ids.messageId);
      await submit(peer, { type: 'attachment', items: content.items, caption: content.caption }, ids);
    } catch (error) {
      await failOutgoing(peer, ids.messageId, error);
      throw error;
    }
    meter.messageSent();
  };

  const attachmentRail: ChatManager['attachmentRail'] = async (peer, bytes = 0) => {
    const rail = fileRailOf(await effectiveFor(peer), bytes);
    if (!rail) throw new Error(NO_FILE_RAIL);
    return rail;
  };

  const sendHopFile: ChatManager['sendHopFile'] = async (peer, content, upload) => {
    const ids = { messageId: randomId(), timestamp: Date.now() };
    await trustByMessage(peer);
    // The row shows the file at once; it names its node once the upload is done.
    const pendingAttachment: Attachment = { ...content.attachment };
    delete pendingAttachment.hop;
    await addMessage({
      messageId: ids.messageId,
      peerAccountId: peer,
      timestamp: ids.timestamp,
      direction: 'outgoing',
      status: 'sending',
      content: { type: 'richText', text: content.text, attachments: [pendingAttachment] },
      reactions: [],
      editedAt: null,
    });
    await settlePendingSeen(peer, ids.messageId);
    typingSender.sent(peer);
    try {
      const hop = await upload(ids.messageId);
      const attachment: Attachment = { ...content.attachment, hop };
      await setHopLocation(ids.messageId, 0, attachment);
      await submit(peer, { type: 'hopFile', text: content.text, attachment }, ids);
    } catch (error) {
      await failOutgoing(peer, ids.messageId, error);
      throw error;
    }
    meter.messageSent();
    return ids.messageId;
  };

  const leaveGroup: ChatManager['leaveGroup'] = async groupId => {
    const group = await getGroup(groupId);
    if (!group || group.self !== 'member') return;
    if (isV2(group)) return groupsV2.leave(groupId);
    const failures: unknown[] = [];
    for (const member of otherMembers(group, self)) {
      await sendTo(member.account, { type: 'groupLeave', groupId }).catch(error => failures.push(error));
    }
    await markSelfLeft(groupId);
    if (failures.length > 0) console.warn('[chat] groupLeave did not reach %d member(s)', failures.length);
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

    acceptRequest,

    declineRequest: async requestId => {
      await requireRequest(requestId, 'incoming');
      await setRequestStatus(requestId, 'declined');
    },

    sendMessage,
    sendAttachment,
    attachmentRail,
    sendHopFile,
    capabilitiesOf: effectiveFor,

    withdrawRequest: async (peer, at) => {
      await withdrawRequestLocally(peer, at);
      // A contact keeps its channel: it carries the roster too.
      if (await getContact(peer)) return;
      channels.get(peer)?.dispose();
      channels.delete(peer);
    },

    deleteChat,

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
        await failOutgoing(peer, ids.messageId, error);
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
      const stored = await getMessage(messageId);
      if (!stored || stored.peerAccountId !== peer || stored.direction !== 'outgoing' || stored.status !== 'failed') return;
      // M15c: an attachment's keys are sealed in `keys`; the same message goes out with them again.
      const row = await withAttachmentKeys(stored);
      // M20b: a HOP file whose upload finished goes again with its ticket (the node keeps it 24 h).
      const hopFile = row.content.type === 'richText' ? row.content.attachments[0] : undefined;
      if (row.content.type === 'richText' && hopFile?.hop?.node) {
        const attachment: Attachment = { ...hopFile, hop: { ...hopFile.hop, ticket: await hopTicket(messageId, 0, hopFile) } };
        await setMessageStatus(messageId, 'sending');
        await submit(peer, { type: 'hopFile', text: row.content.text, attachment }, { messageId, timestamp: row.timestamp }).catch(async error => {
          await failOutgoing(peer, messageId, error);
          throw error;
        });
        return;
      }
      if (row.content.type !== 'text' && row.content.type !== 'reply' && row.content.type !== 'attachment') throw new Error('Only a text message can be sent again.');
      // An attachment's chunks are stored again by the caller first (attachments.ts); the message is the same.
      const content: OutgoingContent =
        row.content.type === 'reply'
          ? { type: 'reply', messageId: row.content.messageId, text: row.content.text }
          : row.content.type === 'attachment'
            ? { type: 'attachment', items: row.content.items, caption: row.content.caption }
            : { type: 'text', text: row.content.text };
      await setMessageStatus(messageId, 'sending');
      // The same id: the peer dedups by it, so a first attempt that did land is not shown twice.
      await submit(peer, content, { messageId, timestamp: row.timestamp }).catch(async error => {
        await failOutgoing(peer, messageId, error);
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

    submissions: { snapshot: meter.snapshot, subscribe: meter.subscribe },

    accountSpace: { snapshot: meter.space.snapshot, subscribe: meter.space.subscribe },

    onReference: listener => {
      referenceListeners.add(listener);
      return () => referenceListeners.delete(listener);
    },

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
      if ('drop' in formFor(await effectiveFor(peer), { type: 'botInfo', info })) return;
      await ensureChannel(hexToBytes(peer), contact.chatPublicKey).post(toWire({ type: 'botInfo', info }));
    },

    sendReference: async (peer, reference) => {
      const { messageId } = await applyReference(peer, 'outgoing', { messageId: randomId(), timestamp: Date.now() }, reference);
      const row = await getMessage(messageId);
      // A row that never went out (`recordReference`) goes out under its own
      // id, so the session moves it to sent and delivered. A row the peer
      // already has needs a new id: the peer drops a repeated id.
      const unsent = row?.status === 'sending' || row?.status === 'failed';
      const ids = unsent && row ? { messageId: row.messageId, timestamp: row.timestamp } : { messageId: randomId(), timestamp: Date.now() };
      await submit(peer, { type: 'transactionReference', reference }, ids).catch(async error => {
        // The chain state is real even when the peer was not told: the row stays, marked.
        if (unsent) await failOutgoing(peer, messageId, error);
        throw error;
      });
    },

    recordReference: async (peer, reference) => {
      await applyReference(peer, 'outgoing', { messageId: randomId(), timestamp: Date.now() }, reference);
    },

    createGroup: async (name, members, options = {}) => {
      // Owner ask 2026-09-24: the name is optional; an unnamed group shows its members' names.
      const title = name.trim();
      if ([...title].length > MAX_GROUP_NAME) throw new Error(`A group name has at most ${MAX_GROUP_NAME} characters.`);
      if (!deps.username) throw new Error('Your username is not known yet.');
      const now = Date.now();
      const roster = [{ account: self, username: deps.username, joinedAt: now }, ...rosterOf(members, [], now)];
      if (roster.length < 2) throw new Error('Pick at least one member.');
      if (!options.fanOut) {
        // Spec 0011: the state on ChState_1, then a `welcome` to each member; a member without a chat gets a request first.
        await assertGroupReady(roster.slice(1));
        const { groupId, unreached } = await groupsV2.create(title, roster.slice(1));
        await inviteUnreached(groupId, members, unreached);
        return groupId;
      }
      if (roster.length > MAX_GROUP_MEMBERS) throw new Error(`A group has at most ${MAX_GROUP_MEMBERS} members.`);
      if (title === '') throw new Error('A v1 group needs a name.');
      const info: GroupInfo = { groupId: randomId(), name: title, admin: self, members: roster, version: 1, createdAt: now };
      await saveOwnGroupInfo(info, [], now);
      const invites = await distribute(info, roster);
      if (invites.length > 0) await saveOwnGroupInfo(info, invites, now);
      return info.groupId;
    },

    sendToGroup: (groupId, content) => sendMessage(groupPeerOf(groupId), content),

    updateRoster,

    leaveGroup,

    removeGroupMember: async (groupId, account) => {
      await groupsV2.remove(groupId, account);
    },

    addGroupMember: async (groupId, member) => {
      await assertGroupReady([member]);
      const reached = await groupsV2.add(groupId, member.account, member.username);
      if (!reached) await inviteUnreached(groupId, [member], [member.account]);
    },

    upgradeGroup: async groupId => {
      const group = await getGroup(groupId);
      const unreached = await groupsV2.upgrade(groupId);
      await inviteUnreached(groupId, group?.members ?? [], unreached);
    },

    requestGroupHistory: (groupId, to, since) => groupsV2.requestHistory(groupId, to, since === undefined ? undefined : { tag: 'timestamp', value: since }),

    groupTopics: () => groupsV2.topics(),

    createGroupInvite: groupId => groupsV2.inviteLink(groupId),
    revokeGroupInvites: groupId => groupsV2.revokeInvites(groupId),

    joinGroupByLink: async text => {
      const link = parseInviteLink(text);
      if (!link) throw new Error('This is not a group invite link.');
      if ((await getGroup(link.groupId))?.self === 'member') return { groupId: link.groupId, name: link.name, member: true };
      const now = Date.now();
      const base = { groupId: link.groupId, name: link.name, admins: link.admins, inviteId: link.inviteId, proof: joinProof(link.secret, self), status: 'requested' as const, createdAt: now, updatedAt: now };
      // An admin we already chat with gets the request on that session.
      const reachable = link.admins.find(account => sessions.has(account));
      if (reachable) {
        const join: GroupJoinRow = { ...base, admin: reachable };
        await db.groupJoins.put(join);
        await submit(reachable, { type: 'groupControl', control: joinRequestOf(join) }, { messageId: randomId(), timestamp: now });
        return { groupId: link.groupId, name: link.name, member: false };
      }
      for (const account of link.admins) {
        if (await isBlocked(account)) continue;
        const peer = await lookup.getPeerIdentity(hexToBytes(account)).catch(() => null);
        if (!peer) continue;
        await db.groupJoins.put({ ...base, admin: account });
        // The capability rides in the opener; the admin's client accepts it at once and we send `joinRequest` then.
        await sendRequestTo(peer, joinOpenerText(link.name, link.inviteId, base.proof));
        return { groupId: link.groupId, name: link.name, member: false };
      }
      throw new Error('No admin of this group could be found on the network.');
    },

    approveGroupJoin: (groupId, account) => groupsV2.approveJoin(groupId, account),
    rejectGroupJoin: (groupId, account) => groupsV2.rejectJoin(groupId, account),
    pinGroupMessage: (groupId, messageId, pinned) => groupsV2.setPinned(groupId, messageId, pinned),
    setGroupSettings: async (groupId, settings) => {
      const name = settings.name?.trim();
      // Empty clears the name: the group shows its members' names again.
      if (name !== undefined && [...name].length > MAX_GROUP_NAME) throw new Error(`A group name has at most ${MAX_GROUP_NAME} characters.`);
      await groupsV2.setSettings(groupId, { ...settings, ...(name !== undefined ? { name } : {}) });
    },
    setGroupRole: (groupId, account, role) => groupsV2.setRole(groupId, account, role),
    setGroupPermissions: (groupId, account, permissions) => groupsV2.setPermissions(groupId, account, permissions),
    transferGroupOwnership: (groupId, account) => groupsV2.transferOwnership(groupId, account),
    acceptGroupInvite: groupId => groupsV2.acceptInvite(groupId),

    dispose: () => {
      disposed = true;
      referenceListeners.clear();
      typingSender.dispose();
      seenSender.dispose();
      typing.dispose();
      stopStatus();
      stopTransport();
    },
  };
};
