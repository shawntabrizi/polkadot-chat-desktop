import { NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import type { DeviceKeys } from '../domain/device/keys';
import type { UserIdentity } from '../domain/identity/userIdentity';

import { toHex, toSs58 } from './format';

type Props = {
  identity: UserIdentity;
  deviceKeys: DeviceKeys;
  profileId: NetworkProfileId;
  onLogout: VoidFunction;
};

/**
 * The paired identity, as the M1 "Paired" screen showed it. The identity
 * account and identifier-key container are what a bot-core test client needs
 * to address this identity (docs/acceptance.md).
 */
export const Settings = ({ identity, deviceKeys, profileId, onLogout }: Props) => (
  <section>
    <h2>Paired</h2>
    <dl>
      <dt>Network</dt>
      <dd>{NETWORK_PROFILES[profileId].label}</dd>
      <dt>Identity account</dt>
      <dd data-testid="identity-account">
        {toSs58(identity.identityAccountId)} <code>0x{toHex(identity.identityAccountId)}</code>
      </dd>
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
      <dt>Phone device (statement account)</dt>
      <dd>{identity.peerStatementAccountId ? toSs58(identity.peerStatementAccountId) : 'unknown'}</dd>
      <dt>Phone device encryption key</dt>
      <dd>0x{toHex(identity.peerDeviceEncPubKey)}</dd>
      <dt>Paired at</dt>
      <dd>{new Date(identity.pairedAt).toLocaleString()}</dd>
    </dl>
    <button type="button" onClick={onLogout}>
      Log out
    </button>
  </section>
);
