import { ArrowDownLeft, ArrowUpRight, Bell, BellOff } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';

import { type HexString, bytesToHex } from '../app/bytes';
import { DEFAULT_CHAT_PREFS, readChatPrefs } from '../app/chatPrefs';
import { BANNER_DELAY_MS, type ConnectionSnapshot, showsBanner } from '../app/connectionState';
import { type AssistantPeerId, type MessageRow, type PeerId, db } from '../app/database';
import { ASSISTANT_COMMANDS, ASSISTANT_USERNAME, type AssistantChat } from '../domain/assistant/assistant';
import {
  type PaymentRequest,
  cleanNote,
  declineText,
  movedBetween,
  needsTransferCheck,
  pas,
  payerState,
  paymentLine,
  paymentRequestOf,
  requestPaymentNote,
  requestProblem,
  requesterState,
  sendIntent,
  sendNote,
  sendPaymentRequest,
} from '../domain/chain/payments';
import type { TxRunner } from '../domain/chain/transactions';
import { type TxReference, type TxStatus, isLiveFrame, requestIdOfNote } from '../domain/chat/content';
import { getDraft, saveDraft } from '../domain/chat/drafts';
import type { PeerTyping } from '../domain/chat/signals';
import type { ChatManager } from '../domain/chat/manager';
import { listMessages, markButtonPressed, markRoomRead, setRoomMuted } from '../domain/chat/messages';
import { getPeerInfo } from '../domain/chat/peerInfo';
import { MAX_NICKNAME_CHARS, displayName, forwardText, isBlocked, setNickname } from '../domain/chat/chatActions';
import { clearKey } from '../domain/chat/undo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { AssistantSettings, ChainTransfer } from '../../shared/desktop-api';
import { type BalanceHint, decodeUint256, headerParts, hintCalldata, hintLine, planckInHintUnits, reviveAddressOf, spendable } from '../../shared/balanceHint';
import { CALL_KIND_REVIVE, type TxIntent, decodeTxIntent } from '../../shared/txIntent';

import { AssistantAvatar, PeerAvatar } from './Avatar';
import { BotBadge } from './BotBadge';
import { Composer } from './Composer';
import { type BubbleActions, messagePreview } from './MessageBubble';
import { MessageFlow } from './MessageFlow';
import { AttachRow } from './Attachments';
import { readSetting, writeSetting } from '../app/settings';
import { attachmentService, subscribeAttachmentService } from '../domain/chat/attachmentRuntime';
import { IMAGE_TYPES, pickProblem } from '../domain/chat/attachments';
import { prepareImage } from '../domain/chat/attachmentImage';
import { RoomHeader, TypingLine } from './RoomHeader';
import { type ForwardTarget, RoomMenu, useChatActions, usePending } from './chatActions';
import { AmountRow, type PaymentKind, RequestBody } from './Payments';
import { type StripPhase, TxStrip } from './Transactions';
import { engineLabel, toolsLine } from './engines';
import { plainError } from './format';
import { useBestBlock } from './useChain';
import { useLiveQuery } from './useLiveQuery';

/**
 * A contact's room sends through the chat manager. The Assistant's room
 * (local, not on chain) sends to the engine chosen in Settings instead and
 * has no replies, reactions or edits; its replies render as markdown.
 */
type Props = ({ peer: HexString; manager: ChatManager } | { peer: AssistantPeerId; assistant: AssistantChat }) & {
  /** The People-chain connection (contact rooms show a banner when it is down). */
  connection?: ConnectionSnapshot;
  /** A message search hit (M7b): scroll to it and highlight it for a moment. */
  scrollToMessageId?: string | null;
  /** Changes on every pick, so the same hit picked again jumps again. */
  scrollRequest?: number;
  /** Spec 0007: signs `tx` buttons and reports the states (contact rooms). */
  transactions?: TxRunner | null;
  /** The identity: its account (the bot's balance hint) and username (the strip's "Signs as"). */
  self?: { accountId: Uint8Array; username: string } | null;
  /** M12g: the genesis of the Asset Hub this app signs on; null hides Send and Request PAS. */
  assetHubChainId?: string | null;
};

type Mode = { mode: 'new' } | { mode: 'reply'; target: MessageRow } | { mode: 'edit'; target: MessageRow };

/** How long typing pauses before the draft is saved (M6 step 2). */
const DRAFT_SAVE_MS = 300;

/** Delete acts at once and can be undone this long; then it is sent (M7 step 3). */
const DELETE_UNDO_MS = 6000;

/** Spec 0006: a callback press spins until the bot's next message, at most this long. */
const CALLBACK_WAIT_MS = 10_000;
/** Any other press is highlighted this long. */
const PRESS_FLASH_MS = 1_000;

/**
 * The one signing strip of the room (spec 0007 rate limit): which button, the
 * intent, where it is. `paymentNote`: the note of a request's payment (M12g).
 */
type Strip = { messageId: string; row: number; index: number; bytes: Uint8Array; intent: TxIntent; state: StripPhase; outcome: string | null; paymentNote: string | null };

/** M12g: the strip of a "Send PAS", in the composer area (it answers no message). */
type SendStrip = { intent: TxIntent; amount: bigint; note: string; state: StripPhase; outcome: string | null };

/** What the chain said a reference's transaction moved, by hash and block. */
const transferKey = (reference: TxReference): string => `${reference.hash.toLowerCase()}:${reference.block ?? ''}`;

/**
 * Spec 0008 v2: reads `hint.selector(caller)` on the hint's contract at the
 * best block; the value in the hint's units, or null when the chain cannot tell.
 */
const readHintValue = async (hint: BalanceHint, accountId: Uint8Array): Promise<bigint | null> => {
  const chain = window.desktop?.chain;
  if (!chain) return null;
  return decodeUint256(await chain.contractRead(hint.chainId, hint.contract, hintCalldata(hint.selector, reviveAddressOf(accountId))));
};

/** The value a call sends to the hint's contract, in the hint's units; null when it sends none there. */
const valueToHint = (intent: TxIntent, hint: BalanceHint): bigint | null => {
  const contract = hint.contract.toLowerCase();
  const sent = intent.calls
    .filter(call => call.kind === CALL_KIND_REVIVE && call.to && `0x${Array.from(call.to, b => b.toString(16).padStart(2, '0')).join('')}` === contract)
    .reduce((sum, call) => sum + call.value, 0n);
  return sent > 0n ? planckInHintUnits(hint, sent) : null;
};

/** The last pressed button of the room; `since` is the newest incoming message at the press. */
type PressState = { messageId: string; row: number; index: number; busy: boolean; since: string | null };

const NO_ROWS: readonly MessageRow[] = [];
const noActivity = { subscribe: () => () => undefined, snapshot: () => null };
// A stable snapshot: useSyncExternalStore re-renders on every new object.
const NO_TYPING: ReadonlyMap<PeerId, PeerTyping> = new Map();
const noTyping = { subscribe: () => () => undefined, snapshot: () => NO_TYPING };
/** The header line of an embedded bot at work: the words and dots of a received `typing{working}`. */
const LOCAL_WORKING: PeerTyping = { kind: 'working', until: 0, local: true };

/** "Reconnecting to the People chain…" once the connection has been down 5 s. */
const ReconnectBanner = ({ connection }: { connection: ConnectionSnapshot }) => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const since = connection.state === 'connected' ? null : connection.notConnectedSince;
    const wait = since === null ? 0 : since + BANNER_DELAY_MS - Date.now();
    const timer = setTimeout(() => setVisible(showsBanner(connection, Date.now())), Math.max(0, wait));
    return () => clearTimeout(timer);
  }, [connection]);
  if (!visible || connection.state === 'connected') return null;
  return (
    <p className="mx-4 mb-1 rounded-nested bg-surface-nested px-3 py-2 text-body-s text-fg-secondary" role="status" data-testid="reconnect-banner">
      Reconnecting to the People chain…
    </p>
  );
};

const MuteButton = ({ peer, muted }: { peer: PeerId; muted: boolean }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className="rounded-full font-normal"
        aria-label={muted ? 'Unmute' : 'Mute'}
        aria-pressed={muted}
        data-testid="mute-toggle"
        onClick={() => void setRoomMuted(peer, !muted)}
      >
        {muted ? <BellOff className="size-5 text-fg-secondary" /> : <Bell className="size-5 text-fg-secondary" />}
      </Button>
    </TooltipTrigger>
    <TooltipContent>{muted ? 'Unmute' : 'Mute'}</TooltipContent>
  </Tooltip>
);

/** The nickname in place of the title (M12e): Enter or leaving the field saves, Esc cancels. */
const NicknameEditor = ({ initial, onDone }: { initial: string; onDone: (value: string | null) => void }) => {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (result: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(result);
  };
  return (
    <Input
      autoFocus
      value={value}
      maxLength={MAX_NICKNAME_CHARS}
      onChange={event => setValue(event.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(value);
        } else if (event.key === 'Escape') {
          // Esc cancels here; it must not also close the room (Shell's shortcut).
          event.preventDefault();
          finish(null);
        }
      }}
      placeholder="Nickname"
      aria-label="Nickname"
      data-testid="nickname-input"
      className="h-9 max-w-xs rounded-nested px-2 text-heading-m md:text-heading-m"
    />
  );
};

export const Room = (props: Props) => {
  const { peer, connection, scrollToMessageId = null, scrollRequest = 0, transactions = null, self = null, assetHubChainId = null } = props;
  const manager = 'manager' in props ? props.manager : null;
  const assistant = 'assistant' in props ? props.assistant : null;
  const contact = useLiveQuery(async () => (manager ? db.contacts.get(peer as HexString) : undefined), [peer, manager]);
  const messages = useLiveQuery(() => listMessages(peer), [peer]);
  const room = useLiveQuery(() => db.rooms.get(peer), [peer]);
  const requests = useLiveQuery(() => db.requests.where('peerAccountId').equals(peer).toArray(), [peer]);
  const prefs = useLiveQuery(readChatPrefs, []) ?? DEFAULT_CHAT_PREFS;
  const peerInfo = useLiveQuery(() => (manager ? getPeerInfo(peer) : Promise.resolve(undefined)), [peer, manager]);
  const botInfo = peerInfo?.botInfo ?? null;
  const blocked = useLiveQuery(() => (manager ? isBlocked(peer as HexString) : Promise.resolve(false)), [peer, manager]) ?? false;
  const chatActions = useChatActions();
  const pending = usePending();
  // "Clear history" waits out its Undo time with the messages hidden (M12e).
  const clearing = pending.has(clearKey(peer));
  const [editingNickname, setEditingNickname] = useState(false);
  const balanceHint = manager && self ? (botInfo?.balance ?? null) : null;
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<Mode>({ mode: 'new' });
  const [error, setError] = useState<string | null>(null);
  const [assistantSettings, setAssistantSettings] = useState<AssistantSettings | null>(null);
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(() => new Set());
  const [press, setPress] = useState<PressState | null>(null);
  const [strip, setStrip] = useState<Strip | null>(null);
  // The `tx` button each keyboard started a transaction from (this session).
  const [txButtons, setTxButtons] = useState<ReadonlyMap<string, { row: number; index: number }>>(() => new Map());
  const [hintValue, setHintValue] = useState<bigint | null>(null);
  // M12g: the amount row, a send's strip, and what the chain said about payments to us.
  const [payment, setPayment] = useState<PaymentKind | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [sendStrip, setSendStrip] = useState<SendStrip | null>(null);
  const [transfers, setTransfers] = useState<ReadonlyMap<string, readonly ChainTransfer[]>>(() => new Map());
  const checking = useRef(new Set<string>());

  const activityStore = assistant ? { subscribe: assistant.onActivity, snapshot: assistant.activity } : noActivity;
  const activity = useSyncExternalStore(activityStore.subscribe, activityStore.snapshot);
  const typingStore = manager ? manager.typing : noTyping;
  const peerTyping = useSyncExternalStore(typingStore.subscribe, typingStore.snapshot).get(peer) ?? null;

  useEffect(() => {
    if (!assistant) return;
    let active = true;
    window.desktop?.assistant.getSettings().then(
      settings => {
        if (active) setAssistantSettings(settings);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [assistant]);

  // ── Draft: restored when the room opens, saved 300 ms after typing stops.
  const [draftLoaded, setDraftLoaded] = useState(false);
  const latestDraft = useRef({ text: '', dirty: false });
  useEffect(() => {
    let active = true;
    void getDraft(peer).then(text => {
      if (!active) return;
      if (text) setDraft(current => current || text);
      setDraftLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [peer]);
  useEffect(() => {
    // Edit text is the old message, not a draft.
    if (!draftLoaded || mode.mode === 'edit') return;
    latestDraft.current = { text: draft, dirty: true };
    const timer = setTimeout(() => {
      latestDraft.current.dirty = false;
      void saveDraft(peer, draft);
    }, DRAFT_SAVE_MS);
    return () => clearTimeout(timer);
  }, [draft, draftLoaded, mode.mode, peer]);
  // Leaving the room within 300 ms of a keystroke still keeps it.
  useEffect(
    () => () => {
      if (latestDraft.current.dirty) void saveDraft(peer, latestDraft.current.text);
    },
    [peer],
  );

  // ── Unread: "New messages" sits above the first message that was unread
  // when the room opened; it stays there while the room is open.
  const [firstUnreadId, setFirstUnreadId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (firstUnreadId !== undefined || !messages || room === undefined) return;
    const count = room?.unreadCount ?? 0;
    const incoming = messages.filter(row => row.direction === 'incoming');
    const anchor = count > 0 ? (incoming[Math.max(0, incoming.length - count)]?.messageId ?? null) : null;
    // Set once, off the render path.
    void Promise.resolve().then(() => setFirstUnreadId(anchor));
  }, [messages, room, firstUnreadId]);

  // M10 step 4: a bot that has not described itself gets `/start` once. Asked
  // again whenever what we know about the peer changes while the room is open
  // (its welcome text may land just after the room opened).
  const contactKnown = contact !== undefined;
  useEffect(() => {
    if (!manager || !contactKnown) return;
    manager.roomOpened(peer as HexString).catch((cause: unknown) => console.warn('[room] /start failed', cause));
  }, [manager, contactKnown, peer, peerInfo]);

  // One assistant reply at a time: Send waits until it ends or is stopped.
  const answering = assistant !== null && (messages ?? []).some(row => row.status === 'streaming');
  // Spec 0012 (M15a): one image waits in the composer until Send; its notice shows until the first one went out.
  const [attachment, setAttachment] = useState<File | null>(null);
  const attachNotice = useLiveQuery(async () => (await readSetting('chat.attachmentNotice')) !== 'seen', []) ?? false;
  const attachments = useSyncExternalStore(subscribeAttachmentService, attachmentService, attachmentService);
  const canAttach = manager !== null && contact !== undefined && contact !== null && !blocked && attachments !== null;
  const pickFiles = (files: File[]) => {
    const [file] = files;
    if (!file) return;
    const problem = pickProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setAttachment(file);
  };

  // ── Buttons (spec 0006): the pressed button stays marked until the bot
  // answers (callback) or for a moment (anything else).
  const lastIncomingId = [...(messages ?? [])].reverse().find(row => row.direction === 'incoming')?.messageId ?? null;
  useEffect(() => {
    if (!press) return;
    if (press.since !== lastIncomingId) {
      void Promise.resolve().then(() => setPress(current => (current === press ? null : current)));
      return;
    }
    const timer = setTimeout(() => setPress(current => (current === press ? null : current)), press.busy ? CALLBACK_WAIT_MS : PRESS_FLASH_MS);
    return () => clearTimeout(timer);
  }, [press, lastIncomingId]);

  const pressButton = async (row: MessageRow, r: number, i: number) => {
    if (row.content.type !== 'buttons') return;
    const action = row.content.rows[r]?.[i]?.action;
    if (!action || action.kind === 'unsupported') return;
    setError(null);
    if (action.kind === 'tx') {
      openStrip(row.messageId, r, i, action.intent, paymentRequestOf(row));
      return;
    }
    const current: PressState = { messageId: row.messageId, row: r, index: i, busy: action.kind === 'callback', since: lastIncomingId };
    setPress(current);
    try {
      if (action.kind === 'url') {
        if (!window.desktop) throw new Error('Links open in the desktop app only.');
        await window.desktop.app.openUrl(action.url);
      }
      if (manager) await manager.pressButton(peer as HexString, row.messageId, r, i);
      else if (assistant) {
        // The Assistant's buttons: a command is the user's next message.
        if (action.kind === 'command') await assistant.send(action.command);
        await markButtonPressed(row.messageId, r, i);
      }
    } catch (cause) {
      setPress(state => (state === current ? null : state));
      setError(`${plainError(cause, 'The button did not work.')} Try again.`);
    }
  };

  // ── Spec 0007: the signing strip. One per room; a dry-run always comes first.
  const signingNow = strip?.state.phase === 'signing' || sendStrip?.state.phase === 'signing';
  const openStrip = (messageId: string, r: number, i: number, bytes: Uint8Array, request: PaymentRequest | null) => {
    if (signingNow) {
      setError('A transaction is being signed in this chat. Wait for it, then try again.');
      return;
    }
    const intent = decodeTxIntent(bytes);
    if (!intent) return;
    const paymentNote = request && !request.own ? requestPaymentNote(request.messageId, request.note) : null;
    const opened: Strip = { messageId, row: r, index: i, bytes, intent, state: { phase: 'checking' }, outcome: null, paymentNote };
    // One strip per room: a send's strip closes.
    setSendStrip(null);
    setStrip(opened);
    const update = (next: Partial<Strip>) => setStrip(current => (current && current.messageId === messageId && current.row === r && current.index === i ? { ...current, ...next } : current));
    const chain = window.desktop?.chain;
    if (!chain || !manager || !transactions) {
      update({ state: { phase: 'refused', reason: 'This app cannot run chain actions here.', dryRun: null } });
      return;
    }
    // A call that pays into the bot's declared contract: the strip says what the balance becomes.
    const paid = balanceHint ? valueToHint(intent, balanceHint) : null;
    Promise.all([
      chain.dryRun(bytes),
      paid !== null && balanceHint && self ? readHintValue(balanceHint, self.accountId).catch(() => null) : Promise.resolve(null),
      // M12g: a request is paid only when its call pays the person who sent it.
      paymentNote && request ? requestProblem(request, peer, chain.transferCall) : Promise.resolve(null),
    ])
      .then(([dryRun, current, problem]) => {
        // From the header's number (M12f: less what the bot has not charged yet), so the two agree.
        const outcome = paid !== null && balanceHint && current !== null ? `After this: ${hintLine(balanceHint, spendable(balanceHint, current) + paid)}` : null;
        if (problem) update({ state: { phase: 'refused', reason: problem, dryRun }, outcome });
        else update({ state: dryRun.ok ? { phase: 'ready', dryRun } : { phase: 'refused', reason: dryRun.error ?? 'The test run failed.', dryRun }, outcome });
      })
      .catch((cause: unknown) => update({ state: { phase: 'refused', reason: `${plainError(cause, 'The network did not answer.')} Try again.`, dryRun: null } }));
  };

  const signStrip = async () => {
    if (!strip || strip.state.phase !== 'ready' || !transactions || !manager) return;
    const { dryRun } = strip.state;
    const current = strip;
    if (!dryRun.id) return;
    setStrip({ ...current, state: { phase: 'signing', dryRun } });
    const { display } = current.intent;
    // "Top up (1 PAS)": what it was, and how much. A request's payment names the request (M12g).
    const note = current.paymentNote ?? (display.amount ? `${display.title} (${display.amount}${display.asset ? ` ${display.asset}` : ''})` : display.title);
    try {
      await transactions.run({ peer: peer as HexString, dryRunId: dryRun.id, chainId: current.intent.chainId, note, intentMessageId: current.messageId });
      setTxButtons(map => new Map(map).set(current.messageId, { row: current.row, index: current.index }));
      await manager.pressButton(peer as HexString, current.messageId, current.row, current.index);
      setStrip(s => (s === null || s.messageId !== current.messageId ? s : null));
    } catch (cause) {
      setStrip(s => (s && s.messageId === current.messageId ? { ...s, state: { phase: 'refused', reason: `${plainError(cause, 'It was not signed.')}`, dryRun } } : s));
    }
  };

  // The latest state of the transaction each keyboard started (our own reference rows).
  const txStatusOf = (messageId: string): TxStatus | null => {
    const ref = [...(messages ?? [])]
      .reverse()
      .find(r => r.direction === 'outgoing' && r.content.type === 'transactionReference' && r.content.reference.intentMessageId === messageId);
    return ref?.content.type === 'transactionReference' ? ref.content.reference.status : null;
  };

  const keyboardFor = (row: MessageRow) => {
    if (row.content.type !== 'buttons' || row.direction !== 'incoming' || answering) return undefined;
    const button = txButtons.get(row.messageId);
    const status = button ? txStatusOf(row.messageId) : null;
    const open = strip?.messageId === row.messageId && (strip.state.phase === 'checking' || strip.state.phase === 'signing');
    const keyboard = {
      press: (r: number, i: number) => void pressButton(row, r, i),
      active: open && strip ? { row: strip.row, index: strip.index, busy: true } : press?.messageId === row.messageId ? { row: press.row, index: press.index, busy: press.busy } : null,
      tx: button && status ? { ...button, status } : null,
    };
    const request = manager ? requestsById.get(row.messageId) : undefined;
    if (!request) return keyboard;
    // M12g, the payer's side of a request: "Paid" or "Declined" once done (from the rows, so it survives a restart), else Decline beside Pay.
    const payer = payerState(request, messages ?? [], Date.now());
    const done = payer.state === 'paid' ? 'Paid' : payer.state === 'declined' ? 'Declined' : null;
    return {
      ...keyboard,
      tx: payer.status ? { row: 0, index: 0, status: payer.status } : keyboard.tx,
      done: done ? { row: 0, index: 0, label: done } : null,
      extra:
        payer.state === 'pending' && !open ? (
          <Button type="button" variant="ghost" size="sm" className="h-auto min-h-8 cursor-pointer rounded-medium py-1.5 text-label-m font-normal" onClick={() => void decline(request)} data-testid="request-decline">
            Decline
          </Button>
        ) : null,
    };
  };

  const decline = async (request: PaymentRequest) => {
    if (!manager) return;
    setError(null);
    if (strip?.messageId === request.messageId && strip.state.phase !== 'signing') setStrip(null);
    try {
      // Plain text, so a phone sees it too; the rows then say "declined" on both sides.
      await manager.sendMessage(peer as HexString, { type: 'text', text: declineText(request.title) });
    } catch (cause) {
      setError(`${plainError(cause, 'The decline was not sent.')} Try again.`);
    }
  };

  // ── M12g: requests and payments in this room.
  const requestsById = useMemo(() => {
    const found = new Map<string, PaymentRequest>();
    for (const row of messages ?? []) {
      const request = paymentRequestOf(row);
      if (request) found.set(row.messageId, request);
    }
    return found;
  }, [messages]);
  const selfHex = self ? bytesToHex(self.accountId) : null;

  // A peer's reference that claims to pay one of our requests, or to send us
  // PAS (M12h): read what the chain moved in that extrinsic (once per hash
  // and block). "Paid" and "sent you" rest on this.
  useEffect(() => {
    const chain = window.desktop?.chain;
    if (!chain || !manager) return;
    for (const row of messages ?? []) {
      if (row.direction !== 'incoming' || row.content.type !== 'transactionReference') continue;
      const reference = row.content.reference;
      if (!needsTransferCheck(reference, id => requestsById.get(id)?.own === true) || reference.block === null) continue;
      const key = transferKey(reference);
      if (transfers.has(key) || checking.current.has(key)) continue;
      checking.current.add(key);
      chain.transfersOf(reference.hash, reference.block).then(
        found => setTransfers(current => new Map(current).set(key, found)),
        (cause: unknown) => console.warn('[room] payment check failed', cause),
      ).finally(() => checking.current.delete(key));
    }
  }, [messages, requestsById, transfers, manager]);

  const paymentViewFor = (row: MessageRow): { body?: React.ReactNode; referenceText?: string | null } => {
    if (!manager) return {};
    if (row.content.type === 'transactionReference') {
      const reference = row.content.reference;
      const requestId = requestIdOfNote(reference.note);
      const requested = requestId ? (requestsById.get(requestId)?.amount ?? null) : null;
      const found = transfers.get(transferKey(reference));
      const received = found && selfHex ? movedBetween(found, peer, selfHex) : undefined;
      return { referenceText: paymentLine(reference, row.direction === 'outgoing', name, requested, received) };
    }
    const request = row.direction === 'outgoing' ? requestsById.get(row.messageId) : undefined;
    if (!request || !selfHex) return {};
    const state = requesterState(request, messages ?? [], reference => transfers.get(transferKey(reference)), { self: selfHex, peer }, Date.now());
    return { body: <RequestBody request={request} state={state.state} checking={state.checking} block={state.paidBy?.block ?? null} /> };
  };

  const chainForPayments = manager && transactions && self && assetHubChainId && contact ? window.desktop?.chain : undefined;

  const openPayment = (kind: PaymentKind) => {
    setError(null);
    setPayment(kind);
  };

  // "Send PAS" → Review: the local intent, then the same dry-run and strip as a `tx` button.
  const reviewSend = async (amount: bigint, note: string) => {
    const chain = chainForPayments;
    if (!chain || !assetHubChainId) return;
    if (signingNow) {
      setError('A transaction is being signed in this chat. Wait for it, then try again.');
      return;
    }
    setPaymentBusy(true);
    setError(null);
    try {
      const bytes = await sendIntent(chain.transferCall, { peer, peerName: name, chainId: assetHubChainId, amount, note });
      const intent = decodeTxIntent(bytes);
      if (!intent) throw new Error('The transfer could not be built.');
      const opened: SendStrip = { intent, amount, note: cleanNote(note), state: { phase: 'checking' }, outcome: null };
      setStrip(null);
      setPayment(null);
      setSendStrip(opened);
      const update = (next: Partial<SendStrip>) => setSendStrip(current => (current?.intent === intent ? { ...current, ...next } : current));
      const [dryRun, balance] = await Promise.all([chain.dryRun(bytes), chain.balance().catch(() => null)]);
      const outcome = dryRun.ok && dryRun.fee && balance ? `Balance after: ${pas(BigInt(balance.free) - amount - BigInt(dryRun.fee))} PAS` : null;
      update({ state: dryRun.ok ? { phase: 'ready', dryRun } : { phase: 'refused', reason: dryRun.error ?? 'The test run failed.', dryRun }, outcome });
    } catch (cause) {
      setSendStrip(current => (current ? { ...current, state: { phase: 'refused', reason: `${plainError(cause, 'The network did not answer.')} Try again.`, dryRun: null } } : current));
      if (!sendStrip) setError(`${plainError(cause, 'The transfer could not be prepared.')} Try again.`);
    } finally {
      setPaymentBusy(false);
    }
  };

  const signSend = async () => {
    if (!sendStrip || sendStrip.state.phase !== 'ready' || !transactions) return;
    const { dryRun } = sendStrip.state;
    const current = sendStrip;
    if (!dryRun.id) return;
    setSendStrip({ ...current, state: { phase: 'signing', dryRun } });
    try {
      await transactions.run({ peer: peer as HexString, dryRunId: dryRun.id, chainId: current.intent.chainId, note: sendNote(current.amount, current.note), intentMessageId: null });
      // The reference bubble takes over.
      setSendStrip(s => (s?.intent === current.intent ? null : s));
    } catch (cause) {
      setSendStrip(s => (s?.intent === current.intent ? { ...s, state: { phase: 'refused', reason: plainError(cause, 'It was not signed.'), dryRun } } : s));
    }
  };

  // "Request PAS" → Send request: a buttons message whose tx button pays us.
  const sendRequest = async (amount: bigint, note: string) => {
    const chain = chainForPayments;
    if (!chain || !manager || !self || !assetHubChainId) return;
    setPaymentBusy(true);
    setError(null);
    try {
      await sendPaymentRequest(
        { transferCall: chain.transferCall, sendButtons: manager.sendButtons },
        { peer: peer as HexString, self: { accountHex: bytesToHex(self.accountId), username: self.username }, chainId: assetHubChainId, amount, note },
      );
      setPayment(null);
    } catch (cause) {
      setError(`${plainError(cause, 'The request was not sent.')} Try again.`);
    } finally {
      setPaymentBusy(false);
    }
  };

  const unread = room?.unreadCount ?? 0;
  const markSeen = () => {
    // A room marked as unread (M12e) is read once it is seen too.
    if (unread === 0 && room?.markedUnread !== true) return;
    void (manager ? manager.markRead(peer as HexString) : markRoomRead(peer));
  };

  const name = assistant ? ASSISTANT_USERNAME : contact ? displayName(contact) : '';
  // M12e Forward: whose message the copy was, for the local caption.
  const authorOf = (row: MessageRow): string => (row.direction === 'outgoing' ? (self?.username ?? 'you') : name);
  const forwardFor = (row: MessageRow) =>
    forwardText(row) !== null && row.status !== 'streaming' ? (target: ForwardTarget) => chatActions.forward(target, row, authorOf(row)) : undefined;

  const sendAttachment = async (file: File, caption: string | null) => {
    const service = attachmentService();
    if (!manager || !service) return;
    setError(null);
    setAttachment(null);
    setDraft('');
    setMode({ mode: 'new' });
    let prepared;
    try {
      prepared = await prepareImage(file);
    } catch (cause) {
      setAttachment(file);
      setDraft(caption ?? '');
      setError(`${plainError(cause, 'This image cannot be read.')} Pick another one.`);
      return;
    }
    try {
      await writeSetting('chat.attachmentNotice', 'seen');
      await service.send(manager, peer as HexString, [prepared], caption);
    } catch (cause) {
      // The bubble stays, marked "Not sent · Retry": the local copy is the source of a retry.
      setError(`${plainError(cause, 'The image was not sent.')} Press Retry under it to try again.`);
    }
  };

  const submit = async () => {
    const text = draft.trim();
    if (attachment && mode.mode !== 'edit') return sendAttachment(attachment, text === '' ? null : text);
    if (!text || answering) return;
    setError(null);
    const current = mode;
    setDraft('');
    setMode({ mode: 'new' });
    try {
      if (assistant) await assistant.send(text);
      else if (!manager) return;
      else if (current.mode === 'edit') await manager.edit(peer as HexString, current.target.messageId, text);
      else if (current.mode === 'reply') await manager.sendMessage(peer as HexString, { type: 'reply', messageId: current.target.messageId, text });
      else await manager.sendMessage(peer as HexString, { type: 'text', text });
    } catch (cause) {
      // Keep the text: losing it on top of the failure is worse.
      setDraft(text);
      setError(`${plainError(cause, 'The message was not sent.')} Your text is back in the field; send it again.`);
    }
  };

  const toggleReaction = async (row: MessageRow, emoji: string) => {
    if (!manager) return;
    const mine = row.reactions.some(r => r.emoji === emoji && r.by === 'me');
    setError(null);
    try {
      await manager.react(peer as HexString, row.messageId, emoji, !mine);
    } catch (cause) {
      setError(`${plainError(cause, 'The reaction was not sent.')} Try again.`);
    }
  };

  const retry = async (row: MessageRow) => {
    if (!manager) return;
    setError(null);
    try {
      // An attachment stores its chunks again first (same key and nonce: the same message).
      const service = attachmentService();
      if (row.content.type === 'attachment' && service) await service.reupload(manager, peer as HexString, row.messageId);
      else await manager.retry(peer as HexString, row.messageId);
    } catch (cause) {
      setError(`${plainError(cause, 'The message was not sent.')} Try again.`);
    }
  };

  const markDeleting = (messageId: string, on: boolean) =>
    setDeleting(current => {
      const next = new Set(current);
      if (on) next.add(messageId);
      else next.delete(messageId);
      return next;
    });

  // Act, then undo (design system §10): no confirm. The bubble says
  // "Deleting…" while Undo is offered; the deletion is sent when it ends.
  // It is committed even if the room is closed meanwhile.
  const requestDelete = (row: MessageRow) => {
    setError(null);
    markDeleting(row.messageId, true);
    let undone = false;
    const commit = setTimeout(() => {
      if (undone) return;
      const work = assistant
        ? assistant.deleteMessage(row.messageId)
        : manager
          ? manager.deleteForEveryone(peer as HexString, row.messageId)
          : Promise.resolve();
      work
        .catch((cause: unknown) => setError(`${plainError(cause, 'The message was not deleted.')} Try again.`))
        .finally(() => markDeleting(row.messageId, false));
    }, DELETE_UNDO_MS);
    toast('Message deleted', {
      // RFC-0003: delete for everyone is a request to the peer's device, never a guarantee.
      ...(assistant ? {} : { description: 'This asks their device to delete it.' }),
      duration: DELETE_UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          clearTimeout(commit);
          markDeleting(row.messageId, false);
        },
      },
    });
  };

  const isEditable = (row: MessageRow) =>
    row.direction === 'outgoing' && (row.content.type === 'text' || row.content.type === 'reply') && !deleting.has(row.messageId);
  const startEdit = (row: MessageRow) => {
    setMode({ mode: 'edit', target: row });
    setDraft(messagePreview(row));
  };

  const actionsFor = (row: MessageRow): BubbleActions | null => {
    // A tombstone, a message on its way out, and a bot's live frame take no actions.
    if (row.content.type === 'deleted' || deleting.has(row.messageId) || (manager && isLiveFrame(row.content))) return null;
    if (!manager) {
      // The Assistant: Copy text, its buttons, and Delete (local only) once a reply is finished.
      const keyboard = keyboardFor(row);
      const forward = forwardFor(row);
      return (row.content.type === 'text' || row.content.type === 'buttons') && row.status !== 'streaming'
        ? { remove: { label: 'Delete', run: () => requestDelete(row) }, ...(keyboard ? { keyboard } : {}), ...(forward ? { forward } : {}) }
        : {};
    }
    const keyboard = keyboardFor(row);
    const payments = paymentViewFor(row);
    const below =
      strip && strip.messageId === row.messageId ? (
        <TxStrip
          intent={strip.intent}
          state={strip.state}
          signerName={self?.username ?? 'this account'}
          outcome={strip.outcome}
          onSign={() => void signStrip()}
          onCancel={() => setStrip(null)}
        />
      ) : null;
    const forward = forwardFor(row);
    return {
      ...(keyboard ? { keyboard } : {}),
      ...(below ? { below } : {}),
      ...(forward ? { forward } : {}),
      ...payments,
      react: emoji => void toggleReaction(row, emoji),
      reply: () => setMode({ mode: 'reply', target: row }),
      edit: isEditable(row) ? () => startEdit(row) : undefined,
      retry: row.direction === 'outgoing' && row.status === 'failed' ? () => void retry(row) : undefined,
      remove: isEditable(row) ? { label: 'Delete for everyone', run: () => requestDelete(row) } : undefined,
    };
  };

  // Up arrow in an empty field edits your last text message (contacts only).
  const lastOwnText = manager ? [...(messages ?? [])].reverse().find(row => isEditable(row) && row.status !== 'failed') : undefined;

  const context =
    mode.mode === 'new'
      ? null
      : {
          title: mode.mode === 'edit' ? 'Editing message' : mode.target.direction === 'outgoing' ? 'Reply to yourself' : `Reply to ${name}`,
          text: messagePreview(mode.target),
          onClose: () => {
            if (mode.mode === 'edit') setDraft('');
            setMode({ mode: 'new' });
          },
        };

  // ── Spec 0008 v2 (M11b step 1): a bot that declares a `balance` hint gets
  // "label: value unit" under its name, read at the best block on every new
  // best block while the room is open, and again when a transaction moves.
  const lastReferenceState = (messages ?? [])
    .filter(row => row.content.type === 'transactionReference')
    .map(row => (row.content.type === 'transactionReference' ? `${row.messageId}:${row.content.reference.status}` : ''))
    .join(',');
  const selfAccount = self?.accountId ?? null;
  const bestBlock = useBestBlock();
  const hintKey = balanceHint && selfAccount ? `${balanceHint.chainId}:${balanceHint.contract}:${balanceHint.selector}` : null;
  useEffect(() => {
    if (!balanceHint || !selfAccount) return;
    let active = true;
    readHintValue(balanceHint, selfAccount).then(
      value => {
        if (active && value !== null) setHintValue(value);
      },
      (cause: unknown) => console.warn('[room] balance hint read failed', cause),
    );
    return () => {
      active = false;
    };
    // The hint object is new on every read of the row; its key says when it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintKey, selfAccount, bestBlock, lastIncomingId, lastReferenceState]);
  // Spec 0008 v3 (M12f): one number, the chain's value less the `pending` of the
  // bot's latest botInfo (the same as its /balance); the split only in a tooltip.
  const balanceParts = balanceHint && hintValue !== null ? headerParts(balanceHint, hintValue) : null;
  // Mono for the amount only (design system §7: balances line up as they change).
  const amount = balanceParts ? <span className="font-mono">{balanceParts.amount}</span> : null;
  const balanceLine = balanceParts ? (
    <span data-testid="bot-balance">
      {balanceParts.label}:{' '}
      {balanceParts.split ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="cursor-default rounded-sm underline decoration-dotted underline-offset-2" data-testid="bot-balance-amount">
              {amount}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" data-testid="bot-balance-split">{balanceParts.split}</TooltipContent>
        </Tooltip>
      ) : (
        amount
      )}
      {balanceParts.replies ? ` (${balanceParts.replies})` : ''}
    </span>
  ) : null;

  const noDevice = contact !== undefined && contact.devices.length === 0;
  const muted = room?.muted === true;
  // Spec 0005 (M12c): an embedded bot shows the same "working…" as a chat bot
  // while its reply is being written; it is local, so nothing is sent.
  const assistantWorking = assistant !== null && (messages ?? []).some(row => row.direction === 'incoming' && row.status === 'streaming');

  return (
    <>
      <RoomHeader
        avatar={assistant ? <AssistantAvatar /> : <PeerAvatar name={contact?.username || name || '?'} />}
        name={name}
        nameNote={contact?.nickname ? contact.username : undefined}
        titleEditor={
          editingNickname && contact ? (
            <NicknameEditor
              initial={contact.nickname ?? ''}
              onDone={value => {
                setEditingNickname(false);
                if (value !== null) void setNickname(contact.accountId, value).catch((cause: unknown) => setError(`${plainError(cause, 'The nickname was not saved.')} Try again.`));
              }}
            />
          ) : undefined
        }
        badge={botInfo ? <BotBadge kind={botInfo.kind} /> : undefined}
        status={
          blocked ? (
            <span className="text-fg-tertiary" data-testid="blocked-status">
              Blocked
            </span>
          ) : assistant ? (
            assistantWorking ? (
              <TypingLine typing={LOCAL_WORKING} />
            ) : assistantSettings ? (
              <span data-testid="assistant-engine">
                {engineLabel(assistantSettings.engine)}, in this app · {toolsLine(assistantSettings.tools)}
              </span>
            ) : (
              'AI, in this app'
            )
          ) : noDevice ? (
            <span className="text-fg-warning">No device of this contact is known yet, so messages cannot be delivered.</span>
          ) : peerTyping ? (
            <TypingLine typing={peerTyping} />
          ) : balanceLine ? (
            // The balance first (it is what changes), then the bot's own line.
            <>
              {balanceLine}
              {botInfo && botInfo.description !== '' ? (
                <>
                  {' · '}
                  <span data-testid="bot-description" title={botInfo.description}>
                    {botInfo.description}
                  </span>
                </>
              ) : null}
            </>
          ) : botInfo && botInfo.description !== '' ? (
            <span data-testid="bot-description" title={botInfo.description}>
              {botInfo.description}
            </span>
          ) : undefined
        }
      >
        {room ? <MuteButton peer={peer} muted={muted} /> : null}
        {assistant ? (
          <RoomMenu subject={{ peer, name, kind: 'assistant', room }} />
        ) : contact ? (
          <RoomMenu
            subject={{
              peer,
              name,
              kind: 'contact',
              room,
              contact: { accountId: contact.accountId, username: contact.username, blocked },
              onNickname: () => setEditingNickname(true),
              hasNickname: contact.nickname !== undefined,
            }}
          />
        ) : null}
      </RoomHeader>
      {!assistant && connection ? <ReconnectBanner connection={connection} /> : null}
      <MessageFlow
        rows={clearing ? NO_ROWS : (messages ?? [])}
        peerName={name}
        requests={requests ?? []}
        assistant={assistant !== null}
        actionsFor={actionsFor}
        firstUnreadId={firstUnreadId ?? null}
        unread={unread}
        onSeen={markSeen}
        noteFor={row => (activity && row.messageId === activity.messageId && row.status === 'streaming' ? activity.title : null)}
        deleting={deleting}
        reveal={prefs.revealReplies}
        jumpTo={scrollToMessageId ? { messageId: scrollToMessageId, request: scrollRequest } : null}
        stream={assistant?.stream}
      />
      {error ? (
        <p role="alert" className="px-4 text-body-s text-fg-error">
          {error}
        </p>
      ) : null}
      {blocked && contact ? (
        <div className="flex shrink-0 items-center justify-center gap-3 px-4 pt-2 pb-5" data-testid="blocked-bar">
          <p className="text-body-m text-fg-secondary">You blocked {name}. Their messages are dropped on this device.</p>
          <Button variant="secondary" className="rounded-medium text-label-m" onClick={() => chatActions.unblock(contact.accountId, name)}>
            Unblock
          </Button>
        </div>
      ) : (
        <Composer
          draft={draft}
          onDraft={text => {
            setDraft(text);
            // Spec 0005: only a person's edits of a new message; never the Assistant, never an edit.
            if (manager && mode.mode !== 'edit') manager.composing(peer as HexString, text);
          }}
          onSend={() => void submit()}
          context={context}
          sendDisabled={answering}
          onStop={answering ? () => void assistant?.stop() : undefined}
          sendLabel={mode.mode === 'edit' ? 'Save' : 'Send'}
          sendKey={prefs.sendKey}
          onEditLast={lastOwnText ? () => startEdit(lastOwnText) : undefined}
          // Commands only for a new message: an edit or a reply is not one.
          commands={mode.mode !== 'new' ? [] : assistant ? ASSISTANT_COMMANDS : (botInfo?.commands ?? [])}
          quietSend={strip !== null || sendStrip !== null}
          plusMenu={
            chainForPayments
              ? [
                  { label: 'Send PAS', icon: <ArrowUpRight />, onSelect: () => openPayment('send'), testId: 'plus-send-pas' },
                  { label: 'Request PAS', icon: <ArrowDownLeft />, onSelect: () => openPayment('request'), testId: 'plus-request-pas' },
                ]
              : []
          }
          panel={
            payment ? (
              <AmountRow
                key={payment}
                kind={payment}
                peerName={name}
                busy={paymentBusy}
                onSubmit={(amount, note) => void (payment === 'send' ? reviewSend(amount, note) : sendRequest(amount, note))}
                onCancel={() => setPayment(null)}
              />
            ) : sendStrip ? (
              <TxStrip
                intent={sendStrip.intent}
                state={sendStrip.state}
                signerName={self?.username ?? 'this account'}
                outcome={sendStrip.outcome}
                onSign={() => void signSend()}
                onCancel={() => setSendStrip(null)}
              />
            ) : attachment ? (
              <AttachRow file={attachment} notice={attachNotice} onRemove={() => setAttachment(null)} />
            ) : null
          }
          attach={canAttach && mode.mode !== 'edit' ? { accept: IMAGE_TYPES.join(','), onFiles: pickFiles } : null}
          hasAttachment={attachment !== null}
        />
      )}
    </>
  );
};
