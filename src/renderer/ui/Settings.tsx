import { NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import type { DeviceKeys } from '../domain/device/keys';
import type { UserIdentity } from '../domain/identity/userIdentity';

import { toHex, toSs58 } from './format';

type Props = {
  username: string;
  identity: UserIdentity;
  deviceKeys: DeviceKeys;
  profileId: NetworkProfileId;
};

/**
 * The self-owned identity this computer created. The identity account and
 * identifier-key container are what a bot-core test client needs to address
 * this identity (docs/acceptance.md).
 */
export const Settings = ({ username, identity, deviceKeys, profileId }: Props) => {
  const accountHex = `0x${toHex(identity.identityAccountId)}`;
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
    </section>
  );
};
