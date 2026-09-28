// M10a first run: "Sign in with Polkadot app". The phone's QR is the main way
// in; a local account (SignUp.tsx) is the fallback. Same card as SignUp.

import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { DEFAULT_NETWORK_PROFILE, NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import { getPeopleConnection } from '../app/statementStore';
import { generateEncryptionPrivateKey, generateStatementAccountSeed, toDeviceKeys } from '../domain/device/keys';
import { createIdentityLookup } from '../domain/identity/lookup';
import { pairedIdentityOf } from '../domain/identity/pairedIdentity';
import { hostMetadata } from '../domain/pairing/host';
import { buildPairingDeeplink } from '../domain/pairing/v2/proposal';
import { type SignInPhase, signInStatus, startSignIn } from '../domain/pairing/signIn';
import type { HandshakeSuccessState } from '../domain/pairing/v2/state';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/cn';

import type { DesktopIdentityApi } from '../../shared/desktop-api';
import { withTimeout } from '../../shared/chainRead';

import { Logo } from './Logo';
import { QrCode } from './QrCode';

type Props = {
  identityApi: DesktopIdentityApi;
  onSignedIn: () => void;
  /** "Create a local account instead": the sign-up screen. */
  onLocal: () => void;
};

const QR_SIZE = 232;
/** The username is only for display; a slow People chain must not hold the sign-in. */
const USERNAME_READ_MS = 15_000;

const STEPS = ['Open the Polkadot app on your phone.', 'Go to Settings, then Linked devices.', 'Tap Add device and scan this code.'];

const TONE: Record<ReturnType<typeof signInStatus>['tone'], string> = {
  neutral: 'text-fg-secondary',
  progress: 'text-fg-primary',
  success: 'text-fg-success',
  error: 'text-fg-error',
};

const StatusIcon = ({ phase }: { phase: SignInPhase }) => {
  const { tone } = signInStatus(phase);
  if (tone === 'error') return <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />;
  if (tone === 'success') return <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />;
  return <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />;
};

export const Pair = ({ identityApi, onSignedIn, onLocal }: Props) => {
  const [profile, setProfile] = useState<NetworkProfileId>(DEFAULT_NETWORK_PROFILE);
  // Bumped by a retry: new device keys, so a new QR and a new topic.
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<SignInPhase>({ tag: 'waiting' });
  const device = useMemo(
    () => toDeviceKeys(generateStatementAccountSeed(), generateEncryptionPrivateKey()),
    // `attempt` and `profile` only force new keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attempt, profile],
  );
  // A pure function of the device keys; `startSignIn` derives the same string.
  const qrPayload = useMemo(
    () => buildPairingDeeplink({ statementAccountPublicKey: device.statementAccountPublicKey, encryptionPublicKey: device.encryptionPublicKey }, hostMetadata()),
    [device],
  );

  useEffect(() => {
    const connection = getPeopleConnection(NETWORK_PROFILES[profile]);
    const usernameOf = async (success: HandshakeSuccessState): Promise<string | null> => {
      try {
        const peer = await withTimeout(createIdentityLookup(connection).getPeerIdentity(success.identityAccountId), USERNAME_READ_MS, 'username read');
        return peer?.username ?? null;
      } catch (cause) {
        console.warn('[pair] username read failed; showing the account instead', cause);
        return null;
      }
    };
    const signIn = startSignIn({
      statementStore: connection.adapter,
      device,
      metadata: hostMetadata(),
      onPhase: setPhase,
      onSuccess: async success => identityApi.savePaired(pairedIdentityOf(success, device, profile, await usernameOf(success))),
    });
    return () => signIn.abort();
  }, [device, profile, identityApi]);

  useEffect(() => {
    if (phase.tag === 'done') onSignedIn();
  }, [phase, onSignedIn]);

  const status = signInStatus(phase);
  const busy = phase.tag === 'allocating' || phase.tag === 'saving' || phase.tag === 'done';
  const ended = status.canRetry;

  return (
    <main className="flex min-h-screen items-center justify-center p-4" data-testid="first-run">
      <div className="flex w-full max-w-[440px] flex-col gap-6 rounded-container bg-surface-container p-8 shadow-1">
        <div className="flex flex-col items-center gap-4 text-center">
          <Logo className="h-12" />
          <div className="flex flex-col gap-2">
            <h1 className="text-display-l text-fg-primary">Welcome to Polkadot</h1>
            <p className="text-body-l text-fg-secondary">Sign in with the Polkadot app on your phone.</p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-4">
          <div
            className={cn('overflow-hidden rounded-nested bg-surface-nested p-2 transition-opacity', (busy || ended) && 'opacity-40')}
            data-testid="pairing-qr"
            data-payload={qrPayload}
          >
            <QrCode value={qrPayload} size={QR_SIZE} alt="Sign-in code for the Polkadot app" />
          </div>
          <ol className="flex w-full flex-col gap-1.5">
            {STEPS.map((step, index) => (
              <li key={step} className="flex items-baseline gap-3 text-body-m text-fg-primary">
                <span className="w-4 shrink-0 text-right text-body-s text-fg-tertiary tabular-nums">{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        <div className="flex flex-col gap-3">
          <div
            role="status"
            aria-live="polite"
            data-testid="pairing-status"
            data-phase={phase.tag}
            className={cn('flex items-start gap-2 rounded-nested bg-surface-nested px-3 py-2 text-body-s', TONE[status.tone])}
          >
            <StatusIcon phase={phase} />
            <p>{status.text}</p>
          </div>
          {ended ? (
            <Button type="button" onClick={() => setAttempt(count => count + 1)} className="h-auto w-full rounded-full px-9 py-3.5 text-label-l font-semibold" data-testid="pairing-retry">
              Show a new code
            </Button>
          ) : null}
          <div className="flex items-end gap-3">
            <div className="flex w-32 flex-col gap-1.5">
              <label htmlFor="pair-network" className="text-label-m text-fg-secondary">
                Network
              </label>
              <Select value={profile} onValueChange={value => setProfile(value as NetworkProfileId)} disabled={busy}>
                <SelectTrigger id="pair-network" className="h-11 w-full rounded-nested text-body-m">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(NETWORK_PROFILES).map(option => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="ghost" className="ml-auto h-11 rounded-medium text-label-m font-normal" onClick={onLocal} disabled={busy} data-testid="create-local">
              Create a local account instead
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
};
