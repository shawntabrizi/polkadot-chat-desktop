import { Copy, Eye, EyeOff } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

import { NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import { TEST_PROMPT, askOnce } from '../domain/assistant/assistant';
import type { UserIdentity } from '../domain/identity/userIdentity';
import { THEMES, THEME_LABELS, type ThemeChoice, getTheme, setTheme } from '../theme/theme';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import type { AssistantSettings, DesktopAssistantApi } from '../../shared/desktop-api';

import { plainError, toHex } from './format';

type Props = {
  username: string;
  identity: UserIdentity;
  profileId: NetworkProfileId;
  /** Removes the identity (undoable for a few seconds; the caller shows the toast). */
  onReset: () => Promise<void>;
  /** The LLM proxy through the main process; null outside Electron. */
  assistantApi: DesktopAssistantApi | null;
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

/**
 * The Assistant's model, proxy URL and API key. The key goes to the main
 * process and never comes back: the screen only shows whether one is stored.
 */
const AssistantSection = ({ api }: { api: DesktopAssistantApi }) => {
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<{ text: string; tone: 'plain' | 'error' } | null>(null);
  const [testing, setTesting] = useState(false);

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

  if (!settings) {
    return (
      <Section title="Assistant">
        <p className={status?.tone === 'error' ? 'text-body-m text-fg-error' : 'text-body-m text-fg-tertiary'}>{status?.text ?? 'Loading…'}</p>
      </Section>
    );
  }
  const keyState = settings.hasKey
    ? 'key stored'
    : settings.envKey
      ? 'no key stored; the app uses the proxy key from its environment'
      : 'no key stored';
  return (
    <Section title="Assistant">
      <form
        className="flex flex-col gap-4"
        onSubmit={event => {
          event.preventDefault();
          void save({ model, baseUrl, ...(key ? { key } : {}) });
        }}
      >
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
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" className="w-fit rounded-medium text-label-m">
            Save
          </Button>
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
          {settings.hasKey ? (
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

/** Settings fill the right pane: sections as containers on the page surface. */
export const Settings = ({ username, identity, profileId, onReset, assistantApi }: Props) => (
  <div className="h-full overflow-y-auto" data-testid="settings">
    <div className="mx-auto flex max-w-2xl flex-col gap-2 pb-2">
      <h1 className="px-5 pt-4 pb-2 text-heading-l text-fg-primary">Settings</h1>
      <IdentitySection username={username} identity={identity} profileId={profileId} />
      <AppearanceSection />
      {assistantApi ? (
        <AssistantSection api={assistantApi} />
      ) : (
        <Section title="Assistant">
          <p className="text-body-m text-fg-secondary">Available only inside Polkadot Chat Desktop.</p>
        </Section>
      )}
      <DangerSection onReset={onReset} />
    </div>
  </div>
);
