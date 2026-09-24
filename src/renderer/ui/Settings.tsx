import { Copy, Eye, EyeOff } from 'lucide-react';
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';

import {
  DEFAULT_CHAT_PREFS,
  type SendKey,
  readChatPrefs,
  writeExplorer,
  writeNotifications,
  writeReadReceipts,
  writeRevealReplies,
  writeSendKey,
  writeSendTyping,
  writeSound,
} from '../app/chatPrefs';
import { isMac, primaryModifierLabel } from '../app/keyboard';
import { NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import { TEST_PROMPT, askOnce } from '../domain/assistant/assistant';
import type { ChatManager } from '../domain/chat/manager';
import { listBlocked } from '../domain/chat/chatActions';
import { type SubmissionCounts, submissionsLine } from '../domain/chat/submissions';
import type { UserIdentity } from '../domain/identity/userIdentity';
import { THEMES, THEME_LABELS, type ThemeChoice, getTheme, setTheme } from '../theme/theme';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import type { AssistantEngineId, AssistantEngineStatus, AssistantSettings, AssistantTool, DesktopAssistantApi } from '../../shared/desktop-api';
import { EXPLORERS, EXPLORER_CAPTIONS, EXPLORER_LABELS, type ExplorerId } from '../../shared/explorers';

import { AgentSettings } from './AgentSettings';
import { ProfilesSettings } from './Profiles';
import { PeerAvatar } from './Avatar';
import { StorageSettings } from './StorageSettings';
import { type DemoRuntime, DemoSettings, useDemoBots } from './DemoBots';
import { useChatActions } from './chatActions';
import { Checkbox, Switch } from './controls';
import { ENGINE_LABELS, TOOL_CHOICES } from './engines';
import { formatDay, plainError, toHex } from './format';
import { useLiveQuery } from './useLiveQuery';

type Props = {
  username: string;
  identity: UserIdentity;
  profileId: NetworkProfileId;
  /** Removes the identity (undoable for a few seconds; the caller shows the toast). */
  onReset: () => Promise<void>;
  /** The LLM proxy through the main process; null outside Electron. */
  assistantApi: DesktopAssistantApi | null;
  /** The chat manager's submission counts (M12c); null while chat starts. */
  submissions: ChatManager['submissions'] | null;
  /** M12i Settings › Demo; null while chat starts. */
  demoRuntime: DemoRuntime | null;
};

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-4 rounded-container bg-surface-container p-5 shadow-1">
    <h2 className="text-heading-s text-fg-primary">{title}</h2>
    {children}
  </section>
);

const Field = ({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={htmlFor} className="text-label-m text-fg-secondary">
      {label}
    </label>
    {children}
  </div>
);

const inputClass = 'h-10 rounded-nested text-body-m md:text-body-m';

/**
 * The self-owned identity this computer created. The identity account and
 * the identifier-key container are what a bot-core test client needs to
 * address this identity (docs/acceptance.md), so they stay reachable, behind
 * "Show account".
 */
const IdentitySection = ({ username, identity, profileId }: Pick<Props, 'username' | 'identity' | 'profileId'>) => {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const accountHex = `0x${toHex(identity.identityAccountId)}`;
  const chatKeyContainer = `0x00${toHex(identity.identityChatPublicKey)}${'00'.repeat(32)}`;
  return (
    <Section title="Identity">
      <div className="flex flex-col gap-1">
        <p className="text-label-l text-fg-primary" data-testid="identity-username">
          {username}
        </p>
        <p className="text-body-m text-fg-secondary">Created on this computer · {NETWORK_PROFILES[profileId].label}</p>
      </div>
      {shown ? (
        <div className="flex flex-col gap-3 rounded-nested bg-surface-nested p-3">
          <div className="flex flex-col gap-1">
            <p className="text-label-s text-fg-secondary">Account</p>
            <p className="text-body-m font-mono break-all text-fg-primary" data-testid="identity-account">
              {accountHex}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-label-s text-fg-secondary">Chat key (RFC-0004 container)</p>
            <p className="text-body-s font-mono break-all text-fg-primary">{chatKeyContainer}</p>
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="w-fit rounded-medium text-label-m" onClick={() => setShown(value => !value)} aria-expanded={shown}>
          {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          {shown ? 'Hide account' : 'Show account'}
        </Button>
        {shown ? (
          <Button
            variant="secondary"
            className="w-fit rounded-medium text-label-m"
            onClick={() => {
              void navigator.clipboard.writeText(accountHex).then(() => setCopied(true));
            }}
          >
            <Copy aria-hidden />
            {copied ? 'Copied' : 'Copy'}
          </Button>
        ) : null}
      </div>
    </Section>
  );
};

const AppearanceSection = () => {
  const [choice, setChoice] = useState<ThemeChoice>(getTheme);
  return (
    <Section title="Appearance">
      <Field label="Theme" htmlFor="theme">
        <Select
          value={choice}
          onValueChange={value => {
            const next = value as ThemeChoice;
            setTheme(next);
            setChoice(next);
          }}
        >
          <SelectTrigger id="theme" className="w-64 rounded-nested text-body-m" data-testid="theme-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">System</SelectItem>
            {THEMES.map(theme => (
              <SelectItem key={theme} value={theme}>
                {THEME_LABELS[theme]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </Section>
  );
};

/** A label (and an optional caption under it) and its switch on one row; the whole row is the hit area. */
const SwitchRow = ({
  id,
  label,
  caption,
  checked,
  onChange,
  testId,
}: {
  id: string;
  label: string;
  caption?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  testId?: string;
}) => (
  <div className="flex items-center justify-between gap-4">
    <label htmlFor={id} className="flex cursor-pointer flex-col gap-0.5">
      <span className="text-body-m text-fg-primary">{label}</span>
      {caption ? <span className="text-body-s text-fg-tertiary">{caption}</span> : null}
    </label>
    <Switch id={id} checked={checked} onCheckedChange={onChange} data-testid={testId} />
  </div>
);

const ChatSection = () => {
  const prefs = useLiveQuery(readChatPrefs, []) ?? DEFAULT_CHAT_PREFS;
  const mod = isMac() ? '⌘ Enter' : 'Ctrl Enter';
  return (
    <Section title="Chat">
      <Field label="Send message with" htmlFor="send-key">
        <Select value={prefs.sendKey} onValueChange={value => void writeSendKey(value as SendKey)}>
          <SelectTrigger id="send-key" className="w-64 rounded-nested text-body-m" data-testid="send-key-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="enter">Enter</SelectItem>
            <SelectItem value="mod-enter">{mod}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-body-s text-fg-tertiary">
          {prefs.sendKey === 'enter' ? 'Shift Enter adds a new line.' : 'Enter adds a new line.'}
        </p>
      </Field>
      <SwitchRow id="notifications" label="Notifications" checked={prefs.notifications} onChange={on => void writeNotifications(on)} testId="notifications-switch" />
      <SwitchRow id="sound" label="Sound" checked={prefs.sound} onChange={on => void writeSound(on)} testId="sound-switch" />
      <SwitchRow id="reveal" label="Reveal bot replies" checked={prefs.revealReplies} onChange={on => void writeRevealReplies(on)} testId="reveal-switch" />
      <SwitchRow
        id="send-typing"
        label="Send typing indicators"
        caption="Costs one network submission every 10 s while you type"
        checked={prefs.sendTyping}
        onChange={on => void writeSendTyping(on)}
        testId="typing-switch"
      />
      <SwitchRow id="read-receipts" label="Send read receipts" checked={prefs.readReceipts} onChange={on => void writeReadReceipts(on)} testId="receipts-switch" />
      <Field label="Block explorer" htmlFor="explorer">
        <Select value={prefs.explorer} onValueChange={value => void writeExplorer(value as ExplorerId)}>
          <SelectTrigger id="explorer" className="w-64 rounded-nested text-body-m" data-testid="explorer-select">
            {/* The trigger shows the name only; the caption belongs to the option. */}
            <SelectValue>{EXPLORER_LABELS[prefs.explorer]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {EXPLORERS.map(explorer => (
              <SelectItem key={explorer} value={explorer} data-testid={`explorer-${explorer}`}>
                <span className="flex flex-col items-start">
                  <span>{EXPLORER_LABELS[explorer]}</span>
                  {EXPLORER_CAPTIONS[explorer] ? <span className="text-caption text-fg-tertiary">{EXPLORER_CAPTIONS[explorer]}</span> : null}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-body-s text-fg-tertiary">Where “View on …” opens a transaction or your account.</p>
      </Field>
    </Section>
  );
};

/**
 * M12e: who this device blocked, with Unblock. A block is local: their
 * requests and messages are dropped here, and they are not told.
 */
/** "today", "yesterday", else "on 3 September 2026". */
const blockedWhen = (at: number): string => {
  const day = formatDay(at);
  return day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : `on ${day}`;
};

const PrivacySection = () => {
  const blocked = useLiveQuery(listBlocked, []) ?? [];
  const actions = useChatActions();
  return (
    <Section title="Privacy">
      <div className="flex flex-col gap-1">
        <p className="text-label-m text-fg-secondary">Blocked</p>
        <p className="text-body-s text-fg-tertiary">Their requests and messages are dropped on this device. They are not told.</p>
      </div>
      {blocked.length === 0 ? (
        <p className="text-body-m text-fg-secondary" data-testid="blocked-empty">
          No one is blocked. Block someone from a chat’s menu or from their request.
        </p>
      ) : (
        <ul className="-mx-2 flex flex-col" data-testid="blocked-list">
          {blocked.map(row => (
            <li key={row.accountId} className="flex items-center gap-3 rounded-nested px-2 py-2 transition-colors hover:bg-selection-container-hover" data-testid="blocked-row">
              <PeerAvatar name={row.username} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-label-m text-fg-primary">{row.username}</p>
                <p className="text-caption text-fg-tertiary">Blocked {blockedWhen(row.blockedAt)}</p>
              </div>
              <Button variant="secondary" className="rounded-medium text-label-m" onClick={() => actions.unblock(row.accountId, row.username)} data-testid="unblock">
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
};

/** The totals main keeps (M12e); the manager's own count outside Electron. */
const useDiagnostics = (submissions: NonNullable<Props['submissions']>): SubmissionCounts & { bulletinTransactions?: number } => {
  const local = useSyncExternalStore(submissions.subscribe, submissions.snapshot);
  const [totals, setTotals] = useState<(SubmissionCounts & { bulletinTransactions?: number }) | null>(null);
  useEffect(() => {
    const api = window.desktop?.diagnostics;
    if (!api) return;
    let live = true;
    const stop = api.onChanged(counts => setTotals(counts));
    api.get().then(
      counts => {
        if (live) setTotals(current => current ?? counts);
      },
      () => undefined,
    );
    return () => {
      live = false;
      stop();
    };
  }, []);
  return totals ?? local;
};

/**
 * M12c: what this app cost the shared Statement Store
 * (docs/spec/efficiency.md). The budget is one submission per message.
 */
const DiagnosticsSection = ({ submissions }: { submissions: NonNullable<Props['submissions']> }) => {
  const counts = useDiagnostics(submissions);
  return (
    <Section title="Diagnostics">
      <dl className="flex flex-col gap-1" data-testid="diagnostics">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-body-m text-fg-primary">Submissions per message</dt>
          <dd className="text-body-m text-fg-primary tabular-nums" data-testid="submissions-per-message">
            {submissionsLine(counts)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-body-s text-fg-secondary">Delivery acknowledgements (not counted above)</dt>
          <dd className="text-body-s text-fg-secondary tabular-nums">{counts.acknowledgements}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-body-s text-fg-secondary">Bulletin transactions (attachments; feeless, not statements)</dt>
          <dd className="text-body-s text-fg-secondary tabular-nums" data-testid="bulletin-transactions">
            {counts.bulletinTransactions ?? 0}
          </dd>
        </div>
      </dl>
      <p className="text-body-s text-fg-tertiary">Since the app started. Every submission is checked and passed on by every network node.</p>
    </Section>
  );
};

/** The shortcuts of M6 step 4, as the keys read on this computer. */
const shortcutRows = (): [string, string][] => {
  const mod = primaryModifierLabel();
  const alt = isMac() ? '⌥' : 'Alt+';
  return [
    [`${mod}K`, 'Search chats, people and messages'],
    [`${mod}N`, 'New chat'],
    ['↑ / ↓ and Enter in the search', 'Move through the results and open one'],
    [`${mod},`, 'Settings'],
    ['Esc', 'Clear the search, close the panel, or go back to the chat list'],
    [`${mod}↑ / ${mod}↓ or ${alt}↑ / ${alt}↓`, 'Previous or next chat'],
    [`${mod}1 … ${mod}9`, 'Open the first to ninth chat'],
    ['↑ in an empty message field', 'Edit your last message'],
    ['Esc in the message field', 'Cancel the reply or edit'],
  ];
};

const KeyboardSection = () => (
  <Section title="Keyboard">
    <dl className="flex flex-col" data-testid="keyboard-shortcuts">
      {shortcutRows().map(([keys, action]) => (
        <div key={keys} className="-mx-2 flex items-baseline gap-4 rounded-small px-2 py-1.5 transition-colors hover:bg-selection-container-hover">
          <dt className="w-56 shrink-0 text-body-s text-fg-primary">{keys}</dt>
          <dd className="text-body-s text-fg-secondary">{action}</dd>
        </div>
      ))}
    </dl>
  </Section>
);

/**
 * Who answers the Assistant (the proxy, or a coding-agent CLI on this
 * computer), the tools a CLI may use, and the proxy's model, URL and key.
 * The key goes to the main process and never comes back: the screen only
 * shows whether one is stored.
 */
const AssistantSection = ({ api }: { api: DesktopAssistantApi }) => {
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<{ text: string; tone: 'plain' | 'error' } | null>(null);
  const [testing, setTesting] = useState(false);
  const [detected, setDetected] = useState<AssistantEngineStatus[] | null>(null);
  const [detecting, setDetecting] = useState(false);

  const show = (next: AssistantSettings) => {
    setSettings(next);
    setModel(next.model);
    setBaseUrl(next.baseUrl);
  };

  useEffect(() => {
    api.getSettings().then(show, (cause: unknown) =>
      setStatus({ text: `${plainError(cause, 'The settings did not load.')} Reopen Settings to try again.`, tone: 'error' }),
    );
  }, [api]);

  const save = async (update: Parameters<DesktopAssistantApi['setSettings']>[0]) => {
    setStatus(null);
    try {
      show(await api.setSettings(update));
      setKey('');
      setStatus({ text: 'Saved.', tone: 'plain' });
    } catch (cause) {
      setStatus({ text: `${plainError(cause, 'The settings were not saved.')} Fix it and save again.`, tone: 'error' });
    }
  };

  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const reply = await askOnce(api, TEST_PROMPT);
      setStatus({ text: `Reply: ${reply.trim() || '(empty)'}`, tone: 'plain' });
    } catch (cause) {
      setStatus({ text: `Test failed: ${plainError(cause, 'no reply came back.')}`, tone: 'error' });
    } finally {
      setTesting(false);
    }
  };

  const detect = async () => {
    setDetecting(true);
    try {
      setDetected(await api.detect());
    } catch (cause) {
      setStatus({ text: `${plainError(cause, 'The search for installed engines failed.')} Try again.`, tone: 'error' });
    } finally {
      setDetecting(false);
    }
  };

  if (!settings) {
    return (
      <Section title="Assistant">
        <p className={status?.tone === 'error' ? 'text-body-m text-fg-error' : 'text-body-m text-fg-tertiary'}>{status?.text ?? 'Loading…'}</p>
      </Section>
    );
  }
  const proxy = settings.engine === 'proxy';
  const keyState = settings.hasKey
    ? 'key stored'
    : settings.envKey
      ? 'no key stored; the app uses the proxy key from its environment'
      : 'no key stored';
  const toggleTool = (tool: AssistantTool, on: boolean) => {
    const next = on ? [...settings.tools, tool] : settings.tools.filter(entry => entry !== tool);
    // Shell implies Read and Write, Write implies Read (the policy closes
    // them): turning Read off also turns off what needs it.
    const needsRead: AssistantTool[] = ['write', 'bash'];
    const cleaned = !on && tool === 'read' ? next.filter(entry => !needsRead.includes(entry)) : !on && tool === 'write' ? next.filter(entry => entry !== 'bash') : next;
    void save({ tools: cleaned });
  };
  const detectedFor = (id: AssistantEngineId) => detected?.find(entry => entry.id === id);
  return (
    <Section title="Assistant">
      <div className="flex flex-col gap-4">
        <Field label="Engine" htmlFor="assistant-engine">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={settings.engine} onValueChange={value => void save({ engine: value as AssistantEngineId })}>
              <SelectTrigger id="assistant-engine" className="w-64 rounded-nested text-body-m" data-testid="engine-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ENGINE_LABELS) as AssistantEngineId[]).map(id => (
                  <SelectItem key={id} value={id}>
                    {ENGINE_LABELS[id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="secondary"
              className="w-fit rounded-medium text-label-m"
              onClick={() => void detect()}
              disabled={detecting}
              data-testid="engine-detect"
            >
              {detecting ? 'Looking…' : 'Detect installed'}
            </Button>
          </div>
        </Field>
        {detected ? (
          <dl className="flex flex-col rounded-nested bg-surface-nested px-3 py-2" data-testid="engine-status">
            {detected.map(entry => (
              <div key={entry.id} className="flex items-baseline gap-4 py-1">
                <dt className="w-32 shrink-0 text-body-s text-fg-primary">{entry.label === 'Proxy' ? ENGINE_LABELS.proxy : ENGINE_LABELS[entry.id]}</dt>
                <dd className={entry.installed ? 'min-w-0 truncate text-body-s text-fg-secondary' : 'text-body-s text-fg-tertiary'}>
                  {entry.installed ? (entry.version ?? 'installed') : 'not installed'}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {proxy ? null : (
          <div className="flex flex-col gap-2" data-testid="assistant-tools">
            <p className="text-label-m text-fg-secondary">Tools</p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {TOOL_CHOICES.map(choice => (
                <label key={choice.id} className="flex cursor-pointer items-center gap-2 text-body-m text-fg-primary">
                  <Checkbox checked={settings.tools.includes(choice.id)} onCheckedChange={value => toggleTool(choice.id, value === true)} aria-label={choice.label} />
                  {choice.label}
                </label>
              ))}
            </div>
            <p className="text-body-s text-fg-tertiary">
              Tools run inside the assistant workspace folder only.{' '}
              {detectedFor(settings.engine)?.installed === false ? `${ENGINE_LABELS[settings.engine]} is not installed on this computer.` : null}
            </p>
          </div>
        )}
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={event => {
          event.preventDefault();
          void save({ model, baseUrl, ...(key ? { key } : {}) });
        }}
      >
        {proxy ? (
          <>
            <Field label="Model" htmlFor="assistant-model">
              <Input id="assistant-model" value={model} onChange={event => setModel(event.target.value)} aria-label="Model" className={inputClass} />
            </Field>
            <Field label="Base URL" htmlFor="assistant-base-url">
              <Input
                id="assistant-base-url"
                value={baseUrl}
                onChange={event => setBaseUrl(event.target.value)}
                aria-label="Base URL"
                className={inputClass}
              />
            </Field>
            <Field label="API key" htmlFor="assistant-key">
              <Input
                id="assistant-key"
                type="password"
                value={key}
                onChange={event => setKey(event.target.value)}
                autoComplete="off"
                placeholder={settings.hasKey ? 'key stored' : 'sk-…'}
                aria-label="API key"
                className={inputClass}
              />
              <p className="text-body-s text-fg-tertiary" data-testid="assistant-key-state">
                {keyState}
              </p>
            </Field>
          </>
        ) : (
          <p className="text-body-s text-fg-tertiary" data-testid="assistant-key-state">
            {ENGINE_LABELS[settings.engine]} answers with its own account on this computer, in an empty folder of this app.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {proxy ? (
            <Button type="submit" className="w-fit rounded-medium text-label-m">
              Save
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            className="w-fit rounded-medium text-label-m"
            onClick={() => void test()}
            disabled={testing}
            data-testid="assistant-test"
          >
            {testing ? 'Testing…' : 'Test'}
          </Button>
          {proxy && settings.hasKey ? (
            <Button type="button" variant="ghost" className="w-fit rounded-medium text-label-m font-normal" onClick={() => void save({ key: '' })}>
              Remove key
            </Button>
          ) : null}
        </div>
        {status ? (
          <p className={status.tone === 'error' ? 'text-body-m text-fg-error' : 'text-body-m text-fg-secondary'} data-testid="assistant-status">
            {status.text}
          </p>
        ) : null}
      </form>
    </Section>
  );
};

const DangerSection = ({ onReset }: Pick<Props, 'onReset'>) => {
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reset = () => {
    setResetting(true);
    setError(null);
    onReset().catch((cause: unknown) => {
      setError(`${plainError(cause, 'The identity was not reset.')} Nothing was deleted.`);
      setResetting(false);
    });
  };
  return (
    <Section title="Danger">
      <p className="text-body-m text-fg-secondary">
        Delete this identity and its chats from this computer. There is no backup: the username cannot be used again.
      </p>
      <Button
        variant="destructive"
        className="w-fit rounded-medium text-label-m text-fg-primary-inverted"
        onClick={reset}
        disabled={resetting}
        data-testid="reset-identity"
      >
        {resetting ? 'Resetting…' : 'Reset identity'}
      </Button>
      {error ? (
        <p role="alert" className="text-body-m text-fg-error">
          {error}
        </p>
      ) : null}
    </Section>
  );
};

/** M12i: the demo bots; hidden on a network that has none (Paseo). */
const DemoSection = ({ profileId, runtime }: { profileId: NetworkProfileId; runtime: DemoRuntime | null }) => {
  const bots = useDemoBots(profileId);
  if (bots.length === 0) return null;
  return (
    <Section title="Demo">
      <DemoSettings profileId={profileId} bots={bots} runtime={runtime} />
    </Section>
  );
};

/** M13: publish the Assistant as an on-chain peer; only inside the desktop app. */
const AgentSection = ({ profileId }: { profileId: NetworkProfileId }) => {
  const desktop = window.desktop;
  if (!desktop?.agent) return null;
  return (
    <Section title="Agent">
      <AgentSettings api={desktop.agent} identityApi={desktop.identity} profileId={profileId} />
    </Section>
  );
};

/** Settings fill the right pane: sections as containers on the page surface. */
export const Settings = ({ username, identity, profileId, onReset, assistantApi, submissions, demoRuntime }: Props) => (
  <div className="h-full overflow-y-auto" data-testid="settings">
    <div className="mx-auto flex max-w-2xl flex-col gap-2 pb-2">
      <h1 className="px-5 pt-4 pb-2 text-heading-l text-fg-primary">Settings</h1>
      <IdentitySection username={username} identity={identity} profileId={profileId} />
      {window.desktop?.profiles ? (
        <Section title="Profiles">
          <ProfilesSettings api={window.desktop.profiles} />
        </Section>
      ) : null}
      <AppearanceSection />
      <ChatSection />
      <PrivacySection />
      <Section title="Storage">
        <StorageSettings attachmentsOn={NETWORK_PROFILES[profileId].bulletin !== null} />
      </Section>
      {assistantApi ? (
        <AssistantSection api={assistantApi} />
      ) : (
        <Section title="Assistant">
          <p className="text-body-m text-fg-secondary">Available only inside Polkadot Chat Desktop.</p>
        </Section>
      )}
      <AgentSection profileId={profileId} />
      <DemoSection profileId={profileId} runtime={demoRuntime} />
      <KeyboardSection />
      {submissions ? <DiagnosticsSection submissions={submissions} /> : null}
      <DangerSection onReset={onReset} />
    </div>
  </div>
);
