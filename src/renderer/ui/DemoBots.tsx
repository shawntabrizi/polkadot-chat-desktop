// M12i demo mode: "Meet the demo bots" after sign-up (a full-pane view like
// "New group", never a modal) and Settings › Demo. Both press the same
// domain action (domain/demo/demo.ts), which is idempotent; the rows read
// their state from the database, so an accept shows as soon as it lands.

import { Bot } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import type { ChatManager } from '../domain/chat/manager';
import { UNDO_MS, deleteKey, pendingActions } from '../domain/chat/undo';
import {
  type DemoDeps,
  type DemoOutcome,
  type DemoRowStatus,
  demoChatsToRemove,
  demoPeerState,
  demoRowStatus,
  readDemoSnapshot,
  startDemoChats,
} from '../domain/demo/demo';
import type { IdentityLookup, UsernameResolver } from '../domain/identity/lookup';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

import { BUILT_IN_DEMO_BOTS, DEMO_TAG_LABELS, type DemoBot } from '../../shared/demoBots';

import { PeerAvatar } from './Avatar';
import { RoomHeader } from './RoomHeader';
import { useLiveQuery } from './useLiveQuery';

/** What the demo action needs from the running chat. */
export type DemoRuntime = { manager: ChatManager; lookup: IdentityLookup; resolveUsername: UsernameResolver };

/** The onboarding step moves on after the first accept or after this long, whichever is first. */
export const DEMO_INTRO_MAX_WAIT_MS = 5_000;

// ── The "show the step once" mark, set by sign-up ────────────────────────

const INTRO_KEY = 'pcd-demo-intro';

/** Sign-up sets it; the next chat screen shows the step once. Storage can be missing: then no step. */
export const markDemoIntro = (): void => {
  try {
    localStorage.setItem(INTRO_KEY, '1');
  } catch {
    // no storage: the step is skipped, Settings › Demo still has the button
  }
};

/** Reads and clears the mark: the step shows once, even if the app closes during it. */
export const takeDemoIntro = (): boolean => {
  try {
    const pending = localStorage.getItem(INTRO_KEY) === '1';
    localStorage.removeItem(INTRO_KEY);
    return pending;
  } catch {
    return false;
  }
};

// ── Shared parts ─────────────────────────────────────────────────────────

/** The built-in list at once, then main's answer (a fetched manifest, or the same list). */
export const useDemoBots = (profileId: NetworkProfileId): readonly DemoBot[] => {
  const [loaded, setLoaded] = useState<{ profileId: NetworkProfileId; bots: readonly DemoBot[] } | null>(null);
  useEffect(() => {
    const api = window.desktop?.demo;
    if (!api) return;
    let live = true;
    api.bots(profileId).then(
      bots => {
        if (live) setLoaded({ profileId, bots });
      },
      (cause: unknown) => console.warn('[demo] list from main failed; using the built-in list', cause),
    );
    return () => {
      live = false;
    };
  }, [profileId]);
  return loaded?.profileId === profileId ? loaded.bots : BUILT_IN_DEMO_BOTS[profileId];
};

const depsOf = (runtime: DemoRuntime): DemoDeps => ({
  snapshot: readDemoSnapshot,
  resolveUsername: runtime.resolveUsername,
  getPeerIdentity: accountId => runtime.lookup.getPeerIdentity(accountId),
  sendRequest: (peer, text) => runtime.manager.sendRequest(peer, text),
  sendMessage: (peer, text) => runtime.manager.sendMessage(peer, { type: 'text', text }),
});

type Local = ReadonlyMap<string, DemoOutcome | 'sending'>;

/** The press's own record per bot, and a clock for "No answer yet". */
const useDemoRun = (runtime: DemoRuntime | null) => {
  const [local, setLocal] = useState<Local>(new Map());
  const [now, setNow] = useState(() => Date.now());
  const snapshot = useLiveQuery(readDemoSnapshot, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const statusOf = (bot: DemoBot): DemoRowStatus =>
    snapshot ? demoRowStatus(demoPeerState(snapshot, bot.username), local.get(bot.username), now) : 'idle';
  const start = (targets: readonly DemoBot[], onStep?: (username: string, step: DemoOutcome | 'sending') => void): Promise<unknown> => {
    if (!runtime) return Promise.resolve();
    return startDemoChats(targets, depsOf(runtime), (username, step) => {
      setLocal(current => new Map(current).set(username, step));
      onStep?.(username, step);
    });
  };
  return { snapshot, statusOf, start };
};

const STATUS_TEXT: Record<Exclude<DemoRowStatus, 'idle' | 'chatting'>, string> = {
  sending: 'Sending…',
  sent: 'Sent',
  noAnswer: 'No answer yet',
  incoming: 'Wants to chat',
  blocked: 'Blocked',
  notOnNetwork: 'Not on this network',
  failed: 'Not sent',
};

const StatusText = ({ status, chattingText }: { status: DemoRowStatus; chattingText: string }) => {
  if (status === 'idle') return null;
  const text = status === 'chatting' ? chattingText : STATUS_TEXT[status];
  return (
    <span
      className={cn('shrink-0 text-body-s', status === 'chatting' ? 'text-fg-success' : status === 'failed' ? 'text-fg-error' : 'text-fg-tertiary')}
      data-testid="demo-status"
      data-status={status}
      aria-live="polite"
    >
      {text}
    </span>
  );
};

const DemoRow = ({ bot, children }: { bot: DemoBot; children?: ReactNode }) => (
  <li className="flex items-center gap-3 rounded-nested px-2 py-2" data-testid="demo-row" data-username={bot.username}>
    <PeerAvatar name={bot.username} size="md" />
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-label-m text-fg-primary">{bot.username}</span>
        <Badge className="rounded-full bg-surface-nested px-2 text-label-s font-normal text-fg-secondary" data-testid="demo-tag">
          {DEMO_TAG_LABELS[bot.tag]}
        </Badge>
      </div>
      <span className="truncate text-body-s text-fg-secondary">{bot.tagline}</span>
    </div>
    {children}
  </li>
);

// ── Onboarding: "Meet the demo bots" ─────────────────────────────────────

type IntroProps = {
  profileId: NetworkProfileId;
  /** Null while the chat starts: the button waits for it. */
  runtime: DemoRuntime | null;
  /** Skip, the first accept, or the wait is over: show the chat list. */
  onDone: () => void;
};

export const DemoIntro = ({ profileId, runtime, onDone }: IntroProps) => {
  const bots = useDemoBots(profileId);
  const { statusOf, start } = useDemoRun(runtime);
  const [running, setRunning] = useState(false);
  // The bots this press reached: their accept ends the step.
  const [sentHere, setSentHere] = useState<ReadonlySet<string>>(new Set());
  const done = useRef(onDone);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    done.current = onDone;
  });
  // The wait ends with the view: a later timer must not close what the person opened since.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Nothing to show on this network (Paseo has no demo bots).
  useEffect(() => {
    if (bots.length === 0) done.current();
  }, [bots.length]);

  const accepted = bots.some(bot => sentHere.has(bot.username) && statusOf(bot) === 'chatting');
  useEffect(() => {
    if (running && accepted) done.current();
  }, [running, accepted]);

  const startAll = () => {
    setRunning(true);
    timer.current = setTimeout(() => done.current(), DEMO_INTRO_MAX_WAIT_MS);
    // The sends go on after the step closes; their rows are in the chat list.
    void start(bots, (username, step) => {
      if (step === 'sent' || step === 'resumed') setSentHere(current => new Set(current).add(username));
    });
  };

  return (
    <>
      <RoomHeader
        avatar={
          <div className="flex size-10 items-center justify-center rounded-full bg-surface-nested">
            <Bot className="size-5 text-fg-secondary" aria-hidden />
          </div>
        }
        name="Meet the demo bots"
        status="Bots on this network you can chat with right away"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4" data-testid="demo-intro">
        <p className="max-w-md text-body-m text-fg-secondary">Each one gets a chat request that says “Hi!”. They accept and answer within seconds.</p>
        <ul className="flex max-w-md flex-col gap-0.5" aria-label="Demo bots">
          {bots.map(bot => (
            <DemoRow key={bot.username} bot={bot}>
              <StatusText status={statusOf(bot)} chattingText={sentHere.has(bot.username) ? 'Accepted' : 'Chatting'} />
            </DemoRow>
          ))}
        </ul>
        <div className="flex items-center gap-2">
          <Button
            className="h-auto w-fit cursor-pointer rounded-full px-8 py-3 text-label-l disabled:cursor-not-allowed"
            disabled={runtime === null || running}
            onClick={startAll}
            data-testid="demo-start-all"
          >
            {runtime === null ? 'Starting chat…' : running ? 'Starting chats…' : 'Start chats with all'}
          </Button>
          <Button variant="ghost" className="h-auto rounded-full px-6 py-3 text-label-l font-normal" onClick={() => done.current()} data-testid="demo-skip">
            Skip
          </Button>
        </div>
      </div>
    </>
  );
};

// ── Settings › Demo ──────────────────────────────────────────────────────

type ListProps = { profileId: NetworkProfileId; bots: readonly DemoBot[]; runtime: DemoRuntime | null };

/** The rows, "Start chat" per row, "Start all", and "Remove demo chats". Empty on a network with no demo bots. */
export const DemoSettings = ({ profileId, bots, runtime }: ListProps) => {
  const { snapshot, statusOf, start } = useDemoRun(runtime);
  const [busy, setBusy] = useState(false);
  const removable = snapshot ? demoChatsToRemove(snapshot, bots) : [];
  const startable = (status: DemoRowStatus) => status === 'idle' || status === 'failed' || status === 'notOnNetwork';

  const startAll = () => {
    setBusy(true);
    void start(bots).finally(() => setBusy(false));
  };

  const removeAll = () => {
    if (!runtime || removable.length === 0) return;
    const at = Date.now();
    const undos = removable.map(({ peer }) => pendingActions.schedule(deleteKey(peer), () => runtime.manager.deleteChat(peer, at)).undo);
    toast(removable.length === 1 ? 'Demo chat removed' : `${removable.length} demo chats removed`, {
      description: 'Only on this device. Start them again at any time.',
      duration: UNDO_MS,
      action: { label: 'Undo', onClick: () => undos.forEach(undo => undo()) },
    });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="demo-settings">
      <p className="text-body-m text-fg-secondary">Bots on {NETWORK_PROFILES[profileId].label} that accept any chat. Each request says “Hi!”.</p>
      <ul className="-mx-2 flex flex-col gap-0.5" aria-label="Demo bots">
        {bots.map(bot => {
          const status = statusOf(bot);
          return (
            <DemoRow key={bot.username} bot={bot}>
              <StatusText status={status} chattingText="Chatting" />
              {startable(status) ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-medium text-label-m"
                  disabled={runtime === null}
                  onClick={() => void start([bot])}
                  data-testid="demo-start-one"
                >
                  Start chat
                </Button>
              ) : null}
            </DemoRow>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button className="w-fit rounded-medium text-label-m" disabled={runtime === null || busy} onClick={startAll} data-testid="demo-settings-start-all">
          {busy ? 'Starting…' : 'Start all'}
        </Button>
        <Button
          variant="ghost"
          className="w-fit rounded-medium text-label-m font-normal"
          disabled={runtime === null || removable.length === 0}
          onClick={removeAll}
          data-testid="demo-remove"
        >
          Remove demo chats
        </Button>
      </div>
    </div>
  );
};
