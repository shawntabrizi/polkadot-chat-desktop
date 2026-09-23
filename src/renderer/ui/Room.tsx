import { Bell, BellOff } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';

import type { HexString } from '../app/bytes';
import { DEFAULT_CHAT_PREFS, readChatPrefs } from '../app/chatPrefs';
import { BANNER_DELAY_MS, type ConnectionSnapshot, showsBanner } from '../app/connectionState';
import { type AssistantPeerId, type MessageRow, type PeerId, db } from '../app/database';
import { ASSISTANT_COMMANDS, ASSISTANT_USERNAME, type AssistantChat } from '../domain/assistant/assistant';
import type { TxRunner } from '../domain/chain/transactions';
import { type TxStatus, isLiveFrame } from '../domain/chat/content';
import { getDraft, saveDraft } from '../domain/chat/drafts';
import type { PeerTyping } from '../domain/chat/signals';
import type { ChatManager } from '../domain/chat/manager';
import { listMessages, markButtonPressed, markRoomRead, setRoomMuted } from '../domain/chat/messages';
import { getPeerInfo } from '../domain/chat/peerInfo';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { AssistantSettings } from '../../shared/desktop-api';
import { type BalanceHint, decodeUint256, hintCalldata, hintLine, hintParts, planckInHintUnits, reviveAddressOf } from '../../shared/balanceHint';
import { CALL_KIND_REVIVE, type TxIntent, decodeTxIntent } from '../../shared/txIntent';

import { AssistantAvatar, PeerAvatar } from './Avatar';
import { BotBadge } from './BotBadge';
import { Composer } from './Composer';
import { type BubbleActions, messagePreview } from './MessageBubble';
import { MessageFlow } from './MessageFlow';
import { RoomHeader, TypingLine } from './RoomHeader';
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

/** The one signing strip of the room (spec 0007 rate limit): which button, the intent, where it is. */
type Strip = { messageId: string; row: number; index: number; bytes: Uint8Array; intent: TxIntent; state: StripPhase; outcome: string | null };

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

const noActivity = { subscribe: () => () => undefined, snapshot: () => null };
// A stable snapshot: useSyncExternalStore re-renders on every new object.
const NO_TYPING: ReadonlyMap<PeerId, PeerTyping> = new Map();
const noTyping = { subscribe: () => () => undefined, snapshot: () => NO_TYPING };

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

export const Room = (props: Props) => {
  const { peer, connection, scrollToMessageId = null, scrollRequest = 0, transactions = null, self = null } = props;
  const manager = 'manager' in props ? props.manager : null;
  const assistant = 'assistant' in props ? props.assistant : null;
  const contact = useLiveQuery(async () => (manager ? db.contacts.get(peer as HexString) : undefined), [peer, manager]);
  const messages = useLiveQuery(() => listMessages(peer), [peer]);
  const room = useLiveQuery(() => db.rooms.get(peer), [peer]);
  const requests = useLiveQuery(() => db.requests.where('peerAccountId').equals(peer).toArray(), [peer]);
  const prefs = useLiveQuery(readChatPrefs, []) ?? DEFAULT_CHAT_PREFS;
  const peerInfo = useLiveQuery(() => (manager ? getPeerInfo(peer) : Promise.resolve(undefined)), [peer, manager]);
  const botInfo = peerInfo?.botInfo ?? null;
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
      openStrip(row.messageId, r, i, action.intent);
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
  const openStrip = (messageId: string, r: number, i: number, bytes: Uint8Array) => {
    if (strip?.state.phase === 'signing') {
      setError('A transaction is being signed in this chat. Wait for it, then try again.');
      return;
    }
    const intent = decodeTxIntent(bytes);
    if (!intent) return;
    const opened: Strip = { messageId, row: r, index: i, bytes, intent, state: { phase: 'checking' }, outcome: null };
    setStrip(opened);
    const update = (next: Partial<Strip>) => setStrip(current => (current && current.messageId === messageId && current.row === r && current.index === i ? { ...current, ...next } : current));
    const chain = window.desktop?.chain;
    if (!chain || !manager || !transactions) {
      update({ state: { phase: 'refused', reason: 'This app cannot run chain actions here.', dryRun: null } });
      return;
    }
    // A call that pays into the bot's declared contract: the strip says what the balance becomes.
    const paid = balanceHint ? valueToHint(intent, balanceHint) : null;
    Promise.all([chain.dryRun(bytes), paid !== null && balanceHint && self ? readHintValue(balanceHint, self.accountId).catch(() => null) : Promise.resolve(null)])
      .then(([dryRun, current]) => {
        const outcome = paid !== null && balanceHint && current !== null ? `After this: ${hintLine(balanceHint, current + paid)}` : null;
        update({ state: dryRun.ok ? { phase: 'ready', dryRun } : { phase: 'refused', reason: dryRun.error ?? 'The test run failed.', dryRun }, outcome });
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
    // "Top up (1 PAS)": what it was, and how much.
    const note = display.amount ? `${display.title} (${display.amount}${display.asset ? ` ${display.asset}` : ''})` : display.title;
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
    return {
      press: (r: number, i: number) => void pressButton(row, r, i),
      active: open && strip ? { row: strip.row, index: strip.index, busy: true } : press?.messageId === row.messageId ? { row: press.row, index: press.index, busy: press.busy } : null,
      tx: button && status ? { ...button, status } : null,
    };
  };

  const unread = room?.unreadCount ?? 0;
  const markSeen = () => {
    if (unread === 0) return;
    void (manager ? manager.markRead(peer as HexString) : markRoomRead(peer));
  };

  const name = assistant ? ASSISTANT_USERNAME : (contact?.username ?? '');

  const submit = async () => {
    const text = draft.trim();
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
      await manager.retry(peer as HexString, row.messageId);
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
      return (row.content.type === 'text' || row.content.type === 'buttons') && row.status !== 'streaming'
        ? { remove: { label: 'Delete', run: () => requestDelete(row) }, ...(keyboard ? { keyboard } : {}) }
        : {};
    }
    const keyboard = keyboardFor(row);
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
    return {
      ...(keyboard ? { keyboard } : {}),
      ...(below ? { below } : {}),
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
  const balanceParts = balanceHint && hintValue !== null ? hintParts(balanceHint, hintValue) : null;
  // Mono for the amount only (design system §7: balances line up as they change).
  const balanceLine = balanceParts ? (
    <span data-testid="bot-balance">
      {balanceParts.label}: <span className="font-mono">{balanceParts.amount}</span>
      {balanceParts.replies ? ` (${balanceParts.replies})` : ''}
    </span>
  ) : null;

  const noDevice = contact !== undefined && contact.devices.length === 0;
  const muted = room?.muted === true;

  return (
    <>
      <RoomHeader
        avatar={assistant ? <AssistantAvatar /> : <PeerAvatar name={name || '?'} />}
        name={name}
        badge={botInfo ? <BotBadge kind={botInfo.kind} /> : undefined}
        status={
          assistant ? (
            assistantSettings ? (
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
      </RoomHeader>
      {!assistant && connection ? <ReconnectBanner connection={connection} /> : null}
      <MessageFlow
        rows={messages ?? []}
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
      />
      {error ? (
        <p role="alert" className="px-4 text-body-s text-fg-error">
          {error}
        </p>
      ) : null}
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
        quietSend={strip !== null}
      />
    </>
  );
};
