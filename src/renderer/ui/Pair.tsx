import { useEffect, useMemo, useState } from 'react';

import { NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import { writeSetting } from '../app/settings';
import { getPeopleConnection } from '../app/statementStore';
import type { DeviceKeys } from '../domain/device/keys';
import { type UserIdentity, readUserIdentity, saveUserIdentity } from '../domain/identity/userIdentity';
import { HOST_METADATA } from '../domain/pairing/host';
import { buildPairingDeeplink } from '../domain/pairing/v2/proposal';
import { startPairingV2 } from '../domain/pairing/v2/service';
import { type HandshakeState, submitted } from '../domain/pairing/v2/state';

import { QrCode } from './QrCode';

type Props = {
  deviceKeys: DeviceKeys;
  profileId: NetworkProfileId;
  /** Hex of the last pairing statement handled; keeps a stale `Success` from replaying. */
  processedStatementHex: string | null;
  onProfileChange: (id: NetworkProfileId) => void;
  onPaired: (identity: UserIdentity) => void;
};

const statusLine = (state: HandshakeState): string => {
  switch (state.tag) {
    case 'Idle':
    case 'Submitted':
      return 'Submitted. Scan the code with the Polkadot app and approve this device.';
    case 'Pending':
      return 'Pending. The phone approved; it is allocating store allowance on-chain.';
    case 'Success':
      return 'Success. Saving the identity...';
    case 'Failed':
      return `Failed: ${state.reason}`;
  }
};

export const Pair = ({ deviceKeys, profileId, processedStatementHex, onProfileChange, onPaired }: Props) => {
  const [state, setState] = useState<HandshakeState>(submitted());
  // Pure function of the device keys; `startPairingV2` derives the same string.
  const qrPayload = useMemo(
    () =>
      buildPairingDeeplink(
        {
          statementAccountPublicKey: deviceKeys.statementAccountPublicKey,
          encryptionPublicKey: deviceKeys.encryptionPublicKey,
        },
        HOST_METADATA,
      ),
    [deviceKeys],
  );
  // Bumped by "Try again" to start a fresh exchange after a Failed.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let processedHex = processedStatementHex;
    const pairing = startPairingV2({
      statementStore: getPeopleConnection(NETWORK_PROFILES[profileId]).adapter,
      deviceIdentity: {
        statementAccountPublicKey: deviceKeys.statementAccountPublicKey,
        statementAccountSecret: deviceKeys.statementAccountSeed,
        encryptionPublicKey: deviceKeys.encryptionPublicKey,
        encryptionPrivateKey: deviceKeys.encryptionPrivateKey,
      },
      metadata: HOST_METADATA,
      initialProcessedDataHex: processedHex,
      onStatementProcessed: hex => {
        processedHex = hex;
        void writeSetting('pairing.processedStatementHex', hex);
      },
      persistOnSuccess: async success => {
        await saveUserIdentity(success);
        const identity = await readUserIdentity();
        if (identity) onPaired(identity);
      },
    });
    const subscription = pairing.state$.subscribe(setState);
    return () => {
      subscription.unsubscribe();
      pairing.abort();
    };
    // `onPaired` and `processedStatementHex` are read once per exchange on purpose:
    // restarting the exchange on every parent render would discard the QR the
    // user is scanning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceKeys, profileId, attempt]);

  return (
    <section>
      <h2>Pair with your phone</h2>
      <label>
        Network{' '}
        <select value={profileId} onChange={event => onProfileChange(event.target.value as NetworkProfileId)}>
          {Object.values(NETWORK_PROFILES).map(profile => (
            <option key={profile.id} value={profile.id}>
              {profile.label}
            </option>
          ))}
        </select>
      </label>
      <div style={{ margin: '16px 0' }}>
        <QrCode value={qrPayload} size={320} />
      </div>
      <p data-testid="pairing-status">{statusLine(state)}</p>
      {state.tag === 'Failed' ? (
        <button type="button" onClick={() => setAttempt(attempt + 1)}>
          Try again
        </button>
      ) : null}
      <details>
        <summary>Pairing link</summary>
        <code style={{ wordBreak: 'break-all' }}>{qrPayload}</code>
      </details>
    </section>
  );
};

