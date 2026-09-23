import { useEffect, useState } from 'react';

import { NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import { TEST_PROMPT, askOnce } from '../domain/assistant/assistant';
import type { DeviceKeys } from '../domain/device/keys';
import type { UserIdentity } from '../domain/identity/userIdentity';

import type { AssistantSettings, DesktopAssistantApi } from '../../shared/desktop-api';

import { toHex, toSs58 } from './format';

type Props = {
  username: string;
  identity: UserIdentity;
  deviceKeys: DeviceKeys;
  profileId: NetworkProfileId;
  /** Deletes the identity from this computer and reloads into sign-up. */
  onReset: () => Promise<void>;
  /** The LLM proxy through the main process; null outside Electron. */
  assistantApi: DesktopAssistantApi | null;
};

const RESET_CONFIRM =
  'Reset identity?\n\nThis deletes your username, keys and chats from this computer. ' +
  'There is no backup: the username cannot be used again. This cannot be undone.';

// The IPC layer wraps errors as "Error invoking remote method '…': Error: <message>".
const plainError = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

/**
 * The self-owned identity this computer created. The identity account and
 * identifier-key container are what a bot-core test client needs to address
 * this identity (docs/acceptance.md).
 */
/**
 * The Assistant's model, proxy URL and API key. The key goes to the main
 * process and never comes back: the screen only shows whether one is stored.
 */
const AssistantSettingsForm = ({ api }: { api: DesktopAssistantApi }) => {
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const show = (next: AssistantSettings) => {
    setSettings(next);
    setModel(next.model);
    setBaseUrl(next.baseUrl);
  };

  useEffect(() => {
    api.getSettings().then(show, (cause: unknown) => setStatus(plainError(cause)));
  }, [api]);

  const save = async (update: Parameters<DesktopAssistantApi['setSettings']>[0]) => {
    setStatus(null);
    try {
      show(await api.setSettings(update));
      setKey('');
      setStatus('Saved.');
    } catch (cause) {
      setStatus(plainError(cause));
    }
  };

  const test = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const reply = await askOnce(api, TEST_PROMPT);
      setStatus(`Reply: ${reply.trim() || '(empty)'}`);
    } catch (cause) {
      setStatus(`Test failed: ${plainError(cause)}`);
    } finally {
      setTesting(false);
    }
  };

  if (!settings) return <p>{status ?? 'Loading…'}</p>;
  const keyState = settings.hasKey
    ? 'key stored'
    : settings.envKey
      ? 'no key stored; the app uses the proxy key from its environment'
      : 'no key stored';
  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        void save({ model, baseUrl, ...(key ? { key } : {}) });
      }}
    >
      <p>
        <label>
          Model <input value={model} onChange={event => setModel(event.target.value)} size={32} aria-label="Model" />
        </label>
      </p>
      <p>
        <label>
          Base URL <input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} size={32} aria-label="Base URL" />
        </label>
      </p>
      <p>
        <label>
          API key{' '}
          <input
            type="password"
            value={key}
            onChange={event => setKey(event.target.value)}
            autoComplete="off"
            placeholder={settings.hasKey ? 'key stored' : 'sk-…'}
            aria-label="API key"
          />
        </label>{' '}
        <small data-testid="assistant-key-state">{keyState}</small>
        {settings.hasKey ? (
          <>
            {' '}
            <button type="button" onClick={() => void save({ key: '' })}>
              Remove key
            </button>
          </>
        ) : null}
      </p>
      <button type="submit">Save</button>{' '}
      <button type="button" onClick={() => void test()} disabled={testing} data-testid="assistant-test">
        {testing ? 'Testing…' : 'Test'}
      </button>
      {status ? <p data-testid="assistant-status">{status}</p> : null}
    </form>
  );
};

export const Settings = ({ username, identity, deviceKeys, profileId, onReset, assistantApi }: Props) => {
  const accountHex = `0x${toHex(identity.identityAccountId)}`;
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const reset = () => {
    if (!window.confirm(RESET_CONFIRM)) return;
    setResetting(true);
    setResetError(null);
    onReset().catch((cause: unknown) => {
      setResetError(plainError(cause));
      setResetting(false);
    });
  };
  return (
    <section>
      <h2>Identity</h2>
      <p>Created on this computer</p>
      <dl>
        <dt>Username</dt>
        <dd data-testid="identity-username">{username}</dd>
        <dt>Account</dt>
        <dd data-testid="identity-account">
          <code>{accountHex}</code>{' '}
          <button type="button" onClick={() => void navigator.clipboard.writeText(accountHex)}>
            Copy
          </button>
        </dd>
        <dt>Network</dt>
        <dd>{NETWORK_PROFILES[profileId].label}</dd>
        <dt>Identity chat key (RFC-0004 container)</dt>
        <dd>
          <code style={{ wordBreak: 'break-all' }}>
            0x00{toHex(identity.identityChatPublicKey)}
            {'00'.repeat(32)}
          </code>
        </dd>
        <dt>Root account</dt>
        <dd>{toSs58(identity.rootAccountId)}</dd>
        <dt>This device (statement account)</dt>
        <dd>{toSs58(deviceKeys.statementAccountPublicKey)}</dd>
      </dl>
      <h2>Assistant</h2>
      {assistantApi ? <AssistantSettingsForm api={assistantApi} /> : <p>Available only inside Polkadot Chat Desktop.</p>}
      <h2>Reset</h2>
      <p>Delete this identity and its chats from this computer.</p>
      <button type="button" onClick={reset} disabled={resetting} data-testid="reset-identity">
        {resetting ? 'Resetting…' : 'Reset identity'}
      </button>
      {resetError ? <p role="alert">{resetError}</p> : null}
    </section>
  );
};
