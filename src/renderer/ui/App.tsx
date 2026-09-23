import { useEffect, useState } from 'react';

import type { HexString } from '../app/bytes';
import { NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import { type ConnectionStatus, getPeopleConnection } from '../app/statementStore';
import { type ChatManager, createChatManager } from '../domain/chat/manager';
import type { DeviceKeys } from '../domain/device/keys';
import { getDeviceKeys } from '../domain/device/repository';
import { type IdentityLookup, createIdentityLookup } from '../domain/identity/lookup';
import { ensureSelfIdentitySeeded } from '../domain/identity/selfIdentity';
import { type UserIdentity, readUserIdentity } from '../domain/identity/userIdentity';
import type { CreateIdentityResponse, DesktopIdentityApi } from '../../shared/desktop-api';

import { Chats } from './Chats';
import { Requests } from './Requests';
import { Room } from './Room';
import { Search } from './Search';
import { Settings } from './Settings';
import { SignUp } from './SignUp';

type Boot = {
  username: string;
  deviceKeys: DeviceKeys;
  identity: UserIdentity | null;
  profileId: NetworkProfileId;
};

/**
 * The identity saved by the main process is the account (Pair.tsx stays in
 * the tree but is not reachable). `null` means this machine has none yet: sign up.
 * Device keys are read only after seeding, so no throwaway keys are minted.
 */
const start = async (identityApi: DesktopIdentityApi): Promise<Boot | null> => {
  const summary = await identityApi.get();
  if (!summary) return null;
  await ensureSelfIdentitySeeded(summary, identityApi.secretsForRenderer);
  const [deviceKeys, identity] = await Promise.all([getDeviceKeys(), readUserIdentity()]);
  return { username: summary.username, deviceKeys, identity, profileId: summary.profile };
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
  const [needsSignUp, setNeedsSignUp] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped to run the start-up again (after sign-up or logout).
  const [startCount, setStartCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [tab, setTab] = useState<Tab>('chats');
  const [openPeer, setOpenPeer] = useState<HexString | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    let active = true;
    Promise.resolve()
      .then(() => {
        const desktop = window.desktop;
        if (!desktop) throw new Error('This app runs only inside Polkadot Chat Desktop.');
        return start(desktop.identity);
      })
      .then(result => {
        if (!active) return;
        setNeedsSignUp(result === null);
        setBoot(result);
      })
      .catch((cause: unknown) => {
        console.error('[app] boot failed', cause);
        if (active) setError(cause instanceof Error ? cause.message : 'Could not open the saved account.');
      });
    return () => {
      active = false;
    };
  }, [startCount]);

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

  const signedUp = (result: CreateIdentityResponse) => {
    setNotice(
      result.confirmed
        ? `Signed up as ${result.username}.`
        : `Signed up as ${result.username}. The network has not confirmed it yet; others may not find you for a few minutes.`,
    );
    setNeedsSignUp(false);
    setStartCount(count => count + 1);
  };

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 720 }}>
      <h1>Polkadot Chat Web</h1>
      {error ? <p role="alert">{error}</p> : null}
      {!boot && !needsSignUp && !error ? <p>Loading...</p> : null}
      {needsSignUp && window.desktop ? <SignUp identityApi={window.desktop.identity} onSignedUp={signedUp} /> : null}
      {notice ? <p data-testid="notice">{notice}</p> : null}
      {boot ? <p data-testid="username">{boot.username}</p> : null}
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
              username={boot.username}
              identity={boot.identity}
              deviceKeys={boot.deviceKeys}
              profileId={boot.profileId}
            />
          ) : null}
        </>
      ) : null}
    </main>
  );
};
