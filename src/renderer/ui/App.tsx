import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { appDatabase } from '../app/database';
import { NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import { type ConnectionSnapshot, createConnectionTracker } from '../app/connectionState';
import { setPhoneSignIn } from '../app/phoneSignIn';
import { isWeb } from '../app/platform';
import { getPeopleConnection } from '../app/statementStore';
import { type AssistantChat, createAssistantChat } from '../domain/assistant/assistant';
import { type ReferenceFollower, createReferenceFollower } from '../domain/chain/finality';
import { type TxRunner, createTxRunner } from '../domain/chain/transactions';
import { type ChatManager, createChatManager } from '../domain/chat/manager';
import { readAllowance } from '../domain/chat/allowance';
import { createAttachmentService } from '../domain/chat/attachments';
import { migrateAttachmentKeys } from '../domain/chat/attachmentKeyStore';
import { attachmentService, setAttachmentService } from '../domain/chat/attachmentRuntime';
import { forwardCounts } from '../domain/chat/submissions';
import { ensureFaucet } from '../domain/faucet/faucet';
import type { DeviceKeys } from '../domain/device/keys';
import { getDeviceKeys } from '../domain/device/repository';
import { type IdentityLookup, type UsernameResolver, createIdentityLookup, createUsernameResolver } from '../domain/identity/lookup';
import { ensurePairedIdentitySeeded } from '../domain/identity/pairedIdentity';
import { ensureSelfIdentitySeeded } from '../domain/identity/selfIdentity';
import { type UserIdentity, readUserIdentity } from '../domain/identity/userIdentity';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

import type { CreateIdentityResponse, DesktopIdentityApi } from '../../shared/desktop-api';

import { markDemoIntro } from './DemoBots';
import { Pair } from './Pair';
import { Shell } from './Shell';
import { SignUp } from './SignUp';
import { plainError, toSs58 } from './format';

type Boot = {
  username: string;
  deviceKeys: DeviceKeys;
  identity: UserIdentity | null;
  profileId: NetworkProfileId;
  /** M10a: signed in with the phone (no seed on this machine). */
  paired: boolean;
};

/** How long "Reset identity" stays undoable here; the main process keeps its backup a little longer. */
const RESET_UNDO_MS = 8_000;

/**
 * The identity saved by the main process is the account: a local one, or
 * (M10a) the phone's sign-in. `null` means this machine has none yet: the
 * first-run screen (Pair.tsx, or SignUp.tsx for a local account).
 * Device keys are read only after seeding, so no throwaway keys are minted.
 */
const start = async (identityApi: DesktopIdentityApi): Promise<Boot | null> => {
  const summary = await identityApi.get();
  setPhoneSignIn(summary?.paired === true);
  if (!summary) return null;
  if (summary.paired) await ensurePairedIdentitySeeded(summary, identityApi.pairedSecrets);
  else await ensureSelfIdentitySeeded(summary, identityApi.secretsForRenderer);
  const [deviceKeys, identity] = await Promise.all([getDeviceKeys(), readUserIdentity()]);
  return { username: summary.username, deviceKeys, identity, profileId: summary.profile, paired: summary.paired === true };
};

type Runtime = { manager: ChatManager; lookup: IdentityLookup; resolveUsername: UsernameResolver; transactions: TxRunner | null };

const Centered = ({ children }: { children: ReactNode }) => (
  <main className="flex min-h-screen items-center justify-center p-4 text-center">{children}</main>
);

export const App = () => {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [needsSignUp, setNeedsSignUp] = useState(false);
  // M10a: the first run shows the phone's QR; this switches to the local sign-up.
  const [localSignUp, setLocalSignUp] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  // Bumped to run the start-up again (after sign-up or an undone reset).
  const [startCount, setStartCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [connection, setConnection] = useState<ConnectionSnapshot>({ state: 'connecting', notConnectedSince: null });

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
        if (active) setError(`${plainError(cause, 'The saved account did not open.')} Restart the app to try again.`);
      });
    return () => {
      active = false;
    };
  }, [startCount]);

  // The Assistant needs no identity or chain, only the main process (none on the web, M22a).
  const [assistant, setAssistant] = useState<AssistantChat | null>(null);
  useEffect(() => {
    const api = isWeb() ? undefined : window.desktop?.assistant;
    if (!api) return;
    let active = true;
    const chat = createAssistantChat(api);
    // Set off the effect's synchronous path, as the connection status is.
    void Promise.resolve().then(() => {
      if (active) setAssistant(chat);
    });
    return () => {
      active = false;
      chat.dispose();
      setAssistant(null);
    };
  }, []);

  // The chat manager lives as long as the identity: it starts once the
  // identity is known and is disposed on reset or a profile change.
  const identity = boot?.identity ?? null;
  const deviceKeys = boot?.deviceKeys ?? null;
  const profileId = boot?.profileId ?? null;
  const username = boot?.username ?? null;
  const paired = boot?.paired ?? false;

  // The Faucet (M10 step 6) is local, but its link carries this identity's address.
  useEffect(() => {
    if (!identity) return;
    ensureFaucet(toSs58(identity.identityAccountId)).catch((cause: unknown) => console.error('[app] the Faucet room failed', cause));
  }, [identity]);

  useEffect(() => {
    if (!identity || !deviceKeys || !profileId || !username) return;
    let active = true;
    let manager: ChatManager | null = null;
    let transactions: TxRunner | null = null;
    let follower: ReferenceFollower | null = null;
    let stopForward: VoidFunction = () => undefined;
    const connection = getPeopleConnection(NETWORK_PROFILES[profileId]);
    const tracker = createConnectionTracker(connection);
    const stopStatus = tracker.subscribe(() => setConnection(tracker.snapshot()));
    // The initial status is read off the effect's synchronous path (a
    // subscription only reports changes).
    void Promise.resolve().then(() => {
      if (active) setConnection(tracker.snapshot());
    });
    const lookup = createIdentityLookup(connection);
    const resolveUsername = createUsernameResolver(connection);
    createChatManager({
      identity,
      deviceKeys,
      statementStore: connection.adapter,
      lookup,
      onConnectionStatus: connection.onStatus,
      username,
      // M10a: a phone sign-in's device has an allowance only while the phone renews it.
      readAllowance: paired ? () => readAllowance(connection.lazyClient.getRequestFn(), deviceKeys.statementAccountPublicKey) : undefined,
    })
      .then(created => {
        if (!active) return created.dispose();
        manager = created;
        // Spec 0007: references of the transactions this app signs go out through the manager.
        const chain = window.desktop?.chain;
        transactions = chain ? createTxRunner({ chain, sendReference: created.sendReference, recordReference: created.recordReference }) : null;
        // M12c: every reference bubble follows its transaction on the chain.
        const assetHub = NETWORK_PROFILES[profileId].assetHub;
        follower = chain && assetHub ? createReferenceFollower({ chain, onReference: created.onReference, chainId: assetHub.genesis }) : null;
        // M12e: the Diagnostics totals live in main, so a reload does not zero them.
        const diagnostics = window.desktop?.diagnostics;
        stopForward = diagnostics ? forwardCounts(created.submissions, delta => diagnostics.add(delta)) : () => undefined;
        // Spec 0012: attachments on this profile's Bulletin chain (none on a profile without one).
        const bulletin = NETWORK_PROFILES[profileId].bulletin;
        setAttachmentService(
          createAttachmentService({
            bulletin: window.desktop?.bulletin ?? null,
            store: bulletin ? { genesis: bulletin.genesis as `0x${string}`, mirror: null } : null,
            chat: created,
            // Base spec HOP receive works on every profile: it needs only the message's node.
            hop: window.desktop?.hop ?? null,
          }),
        );
        // M15c: attachment keys still inline in message rows (before M15c) move to the sealed `keys` table, once.
        migrateAttachmentKeys()
          .then(moved => {
            if (moved > 0) console.info(`[attachments] moved the keys of ${moved} messages to the keys table`);
          })
          .catch((cause: unknown) => console.warn('[attachments] key migration failed', cause));
        setRuntime({ manager: created, lookup, resolveUsername, transactions });
      })
      .catch((cause: unknown) => {
        console.error('[app] chat manager failed to start', cause);
        if (active) setError('Chat did not start. Restart the app to try again.');
      });
    return () => {
      active = false;
      stopStatus();
      tracker.dispose();
      transactions?.dispose();
      follower?.dispose();
      stopForward();
      manager?.dispose();
      attachmentService()?.dispose();
      setAttachmentService(null);
      setRuntime(null);
    };
  }, [identity, deviceKeys, profileId, username, paired]);

  const signedUp = (result: CreateIdentityResponse) => {
    // Confirmed = in a best block; finality is shown, not awaited (PLAN.md "Best block first").
    if (!result.confirmed) {
      toast(`Signed up as ${result.username}`, {
        description: 'The network has not confirmed it yet; others may not find you for a few minutes.',
      });
    } else {
      toast(`Signed up as ${result.username}`, { description: result.finalized ? 'Confirmed.' : 'Confirmed, finalizing.' });
    }
    // M12i: the chat screen that follows shows "Meet the demo bots" once.
    markDemoIntro();
    setNeedsSignUp(false);
    setStartCount(count => count + 1);
  };

  // M10a: the phone's sign-in is saved; start again as that identity.
  const signedIn = useCallback(() => {
    toast('Signed in with your phone');
    setNeedsSignUp(false);
    setStartCount(count => count + 1);
  }, []);

  /**
   * M10a "Sign out" of a phone sign-in. Act first, then offer Undo (SKILL.md
   * §10): chat stops at once, and only when the Undo time ends is the sign-in
   * forgotten, the chat database wiped and the page reloaded to the first
   * run. A quit inside the Undo time signs nothing out (the safe side). The
   * phone still lists this device until the person removes it there; the
   * device's allowance ends when the phone stops renewing it.
   */
  const signOutWithUndo = async () => {
    const identityApi = window.desktop?.identity;
    if (!identityApi) throw new Error('This app runs only inside Polkadot Chat Desktop.');
    setBoot(null);
    setSigningOut(true);
    let undone = false;
    const commit = setTimeout(() => {
      if (undone) return;
      void identityApi
        .forgetPaired()
        .then(() => appDatabase.delete())
        .then(() => window.location.reload())
        .catch((cause: unknown) => {
          console.error('[app] sign out failed', cause);
          setError(`${plainError(cause, 'The sign-out did not finish.')} Restart the app to try again.`);
        });
    }, RESET_UNDO_MS);
    toast('Signed out', {
      description: 'Your chats on this computer are deleted when this closes. Add this device from your phone to sign in again.',
      duration: RESET_UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          clearTimeout(commit);
          setSigningOut(false);
          setStartCount(count => count + 1);
        },
      },
    });
  };

  /**
   * Act first, then offer Undo (SKILL.md §10): the main process moves the
   * identity aside, the app shows sign-up, and only when the Undo window ends
   * is the database wiped and the app reloaded.
   */
  const resetWithUndo = async () => {
    const identityApi = window.desktop?.identity;
    if (!identityApi) throw new Error('This app runs only inside Polkadot Chat Desktop.');
    await identityApi.reset();
    setBoot(null);
    setNeedsSignUp(true);
    let undone = false;
    const commit = setTimeout(() => {
      if (undone) return;
      void appDatabase.delete().then(() => window.location.reload());
    }, RESET_UNDO_MS);
    toast('Identity reset', {
      description: 'Your username, keys and chats are gone from this computer.',
      duration: RESET_UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          clearTimeout(commit);
          identityApi.resetUndo().then(
            restored => {
              if (restored) {
                setNeedsSignUp(false);
                setStartCount(count => count + 1);
              } else {
                toast('The identity could not be restored', { description: 'The undo time was over. Sign up again to chat.' });
              }
            },
            (cause: unknown) => toast('The identity could not be restored', { description: plainError(cause, 'Sign up again to chat.') }),
          );
        },
      },
    });
  };

  const content = (() => {
    if (error) {
      return (
        <Centered>
          <p role="alert" className="max-w-md text-body-m text-fg-error">
            {error}
          </p>
        </Centered>
      );
    }
    if (signingOut) {
      return (
        <Centered>
          <p className="text-body-m text-fg-tertiary">Signing out…</p>
        </Centered>
      );
    }
    if (needsSignUp && window.desktop) {
      return localSignUp ? (
        <SignUp identityApi={window.desktop.identity} onSignedUp={signedUp} onBack={() => setLocalSignUp(false)} />
      ) : (
        <Pair identityApi={window.desktop.identity} onSignedIn={signedIn} onLocal={() => setLocalSignUp(true)} />
      );
    }
    if (!boot?.identity) {
      return (
        <Centered>
          <p className="text-body-m text-fg-tertiary">Loading…</p>
        </Centered>
      );
    }
    return (
      <Shell
        username={boot.username}
        identity={boot.identity}
        profileId={boot.profileId}
        runtime={runtime}
        assistant={assistant}
        assistantApi={isWeb() ? null : (window.desktop?.assistant ?? null)}
        connection={connection}
        onReset={boot.paired ? signOutWithUndo : resetWithUndo}
      />
    );
  })();

  return (
    <TooltipProvider>
      {content}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
};
