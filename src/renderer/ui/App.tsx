import { useEffect, useState } from 'react';

import type { HexString } from '../app/bytes';
import { NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import { readNetworkProfileId, readSetting, writeNetworkProfileId } from '../app/settings';
import { type ConnectionStatus, getPeopleConnection } from '../app/statementStore';
import { type ChatManager, createChatManager } from '../domain/chat/manager';
import type { DeviceKeys } from '../domain/device/keys';
import { getDeviceKeys } from '../domain/device/repository';
import { type IdentityLookup, createIdentityLookup } from '../domain/identity/lookup';
import { type UserIdentity, clearUserIdentity, readUserIdentity } from '../domain/identity/userIdentity';

import { Chats } from './Chats';
import { Pair } from './Pair';
import { Requests } from './Requests';
import { Room } from './Room';
import { Search } from './Search';
import { Settings } from './Settings';

type Boot = {
  deviceKeys: DeviceKeys;
  identity: UserIdentity | null;
  profileId: NetworkProfileId;
  processedStatementHex: string | null;
};

type Tab = 'chats' | 'requests' | 'search' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'chats', label: 'Chats' },
  { id: 'requests', label: 'Requests' },
  { id: 'search', label: 'Search' },
  { id: 'settings', label: 'Settings' },
];

type Runtime = { manager: ChatManager; lookup: IdentityLookup };

export const App = () => {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [tab, setTab] = useState<Tab>('chats');
  const [openPeer, setOpenPeer] = useState<HexString | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    let active = true;
    Promise.all([getDeviceKeys(), readUserIdentity(), readNetworkProfileId(), readSetting('pairing.processedStatementHex')])
      .then(([deviceKeys, identity, profileId, processedStatementHex]) => {
        if (active) setBoot({ deviceKeys, identity, profileId, processedStatementHex });
      })
      .catch((cause: unknown) => {
        console.error('[app] boot failed', cause);
        if (active) setError('Could not open the local database.');
      });
    return () => {
      active = false;
    };
  }, []);

  // The chat manager lives as long as the identity: it starts once the pairing
  // is known and is disposed on logout or a profile change.
  const identity = boot?.identity ?? null;
  const deviceKeys = boot?.deviceKeys ?? null;
  const profileId = boot?.profileId ?? null;
  useEffect(() => {
    if (!identity || !deviceKeys || !profileId) return;
    let active = true;
    let manager: ChatManager | null = null;
    const connection = getPeopleConnection(NETWORK_PROFILES[profileId]);
    const stopStatus = connection.onStatus(setConnection);
    // The initial status is read off the effect's synchronous path (a
    // subscription only reports changes).
    void Promise.resolve().then(() => {
      if (active) setConnection(connection.status());
    });
    const lookup = createIdentityLookup(connection.lazyClient);
    createChatManager({
      identity,
      deviceKeys,
      statementStore: connection.adapter,
      lookup,
      onConnectionStatus: connection.onStatus,
    })
      .then(created => {
        if (!active) return created.dispose();
        manager = created;
        setRuntime({ manager: created, lookup });
      })
      .catch((cause: unknown) => {
        console.error('[app] chat manager failed to start', cause);
        if (active) setError('Chat could not start. Reload the page.');
      });
    return () => {
      active = false;
      stopStatus();
      manager?.dispose();
      setRuntime(null);
    };
  }, [identity, deviceKeys, profileId]);

  const setProfile = (id: NetworkProfileId) => {
    void writeNetworkProfileId(id);
    setBoot(current => (current ? { ...current, profileId: id } : current));
  };

  const logout = async () => {
    await clearUserIdentity();
    setBoot(current => (current ? { ...current, identity: null } : current));
  };

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 720 }}>
      <h1>Polkadot Chat Web</h1>
      {error ? <p role="alert">{error}</p> : null}
      {!boot && !error ? <p>Loading...</p> : null}
      {boot && !boot.identity ? (
        <Pair
          deviceKeys={boot.deviceKeys}
          profileId={boot.profileId}
          processedStatementHex={boot.processedStatementHex}
          onProfileChange={setProfile}
          onPaired={paired => setBoot(current => (current ? { ...current, identity: paired } : current))}
        />
      ) : null}
      {boot?.identity ? (
        <>
          <nav style={{ display: 'flex', gap: 8, margin: '12px 0', alignItems: 'center' }}>
            {TABS.map(entry => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setTab(entry.id);
                  setOpenPeer(null);
                }}
                aria-current={tab === entry.id ? 'page' : undefined}
                style={{ fontWeight: tab === entry.id ? 'bold' : 'normal' }}
              >
                {entry.label}
              </button>
            ))}
            <small data-testid="connection-status" style={{ marginLeft: 'auto' }}>
              {connection === 'connected' ? 'Connected' : connection === 'connecting' ? 'Connecting…' : 'Disconnected'}
            </small>
          </nav>
          {!runtime && !error ? <p>Starting chat...</p> : null}
          {tab === 'chats' && runtime && openPeer ? <Room peer={openPeer} manager={runtime.manager} onBack={() => setOpenPeer(null)} /> : null}
          {tab === 'chats' && !openPeer ? <Chats onOpen={setOpenPeer} /> : null}
          {tab === 'requests' && runtime ? <Requests manager={runtime.manager} /> : null}
          {tab === 'search' && runtime ? (
            <Search
              profile={NETWORK_PROFILES[boot.profileId]}
              selfIdentityAccountId={boot.identity.identityAccountId}
              lookup={runtime.lookup}
              manager={runtime.manager}
            />
          ) : null}
          {tab === 'settings' ? (
            <Settings
              identity={boot.identity}
              deviceKeys={boot.deviceKeys}
              profileId={boot.profileId}
              onLogout={() => void logout()}
            />
          ) : null}
        </>
      ) : null}
    </main>
  );
};
