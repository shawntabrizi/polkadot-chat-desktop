import { useState } from 'react';

import { NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import type { DeviceKeys } from '../domain/device/keys';
import type { UserIdentity } from '../domain/identity/userIdentity';

import { toHex, toSs58 } from './format';

type Props = {
  username: string;
  identity: UserIdentity;
  deviceKeys: DeviceKeys;
  profileId: NetworkProfileId;
  /** Deletes the identity from this computer and reloads into sign-up. */
  onReset: () => Promise<void>;
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
export const Settings = ({ username, identity, deviceKeys, profileId, onReset }: Props) => {
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
      <h2>Reset</h2>
      <p>Delete this identity and its chats from this computer.</p>
      <button type="button" onClick={reset} disabled={resetting} data-testid="reset-identity">
        {resetting ? 'Resetting…' : 'Reset identity'}
      </button>
      {resetError ? <p role="alert">{resetError}</p> : null}
    </section>
  );
};
