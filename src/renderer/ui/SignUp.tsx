import { useEffect, useState } from 'react';

import { DEFAULT_NETWORK_PROFILE, NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import type { CreateIdentityResponse, DesktopIdentityApi } from '../../shared/desktop-api';

import { Logo } from './Logo';
import { plainError } from './format';
import { MAX_LENGTH, cleanDigits, cleanUsername, useUsernameClaim } from './usernameClaim';

type Props = {
  identityApi: DesktopIdentityApi;
  onSignedUp: (result: CreateIdentityResponse) => void;
};

const TERMS_URL = 'https://www.polkadotcommunity.foundation/appterms';
const PRIVACY_URL = 'https://www.polkadotcommunity.foundation/privacy';

/** A centred card on the page surface: the one screen before any chat exists. */
export const SignUp = ({ identityApi, onSignedUp }: Props) => {
  const [username, setUsername] = useState('');
  const [profile, setProfile] = useState<NetworkProfileId>(DEFAULT_NETWORK_PROFILE);
  const [progress, setProgress] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { digits, setDigits, nameTaken, showDigits, digitsTaken, invalid, ready, nameLine } = useUsernameClaim(identityApi, username, profile);

  useEffect(() => identityApi.onProgress(line => setProgress(lines => (lines.at(-1) === line ? lines : [...lines, line]))), [identityApi]);

  const canSubmit = ready && !busy;

  const submit = () => {
    setBusy(true);
    setError(null);
    setProgress([]);
    identityApi
      .create({ username, digits, profile })
      .then(onSignedUp)
      .catch((cause: unknown) => {
        setError(`${plainError(cause, 'The username was not created.')} Try again.`);
        setBusy(false);
      });
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form
        className="flex w-full max-w-[440px] flex-col gap-6 rounded-container bg-surface-container p-8 shadow-1"
        onSubmit={event => {
          event.preventDefault();
          if (canSubmit) submit();
        }}
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <Logo className="h-12" />
          <div className="flex flex-col gap-2">
            <h1 className="text-display-l text-fg-primary">Welcome to Polkadot</h1>
            <p className="text-body-l text-fg-secondary">Choose a username to get started.</p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="signup-username" className="text-label-m text-fg-secondary">
              Username
            </label>
            {/* One bordered field, like the phone: the name, then ".NN" inside the same border.
                The field draws the focus outline; data-slot on the two inputs stands the
                global per-element outline down (base.css), so only one indicator shows. */}
            <div
              data-invalid={invalid || undefined}
              className={`flex h-11 items-center rounded-nested border px-3 transition-colors focus-within:outline-2 focus-within:outline-offset-2 ${
                invalid ? 'border-stroke-error focus-within:outline-focus-error' : 'border-stroke-primary focus-within:outline-focus-ring'
              } ${busy ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <input
                data-slot="signup-field"
                id="signup-username"
                aria-label="Username"
                placeholder="Enter username"
                value={username}
                onChange={event => setUsername(cleanUsername(event.target.value))}
                maxLength={MAX_LENGTH}
                disabled={busy}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                aria-invalid={nameTaken || undefined}
                className="h-full min-w-0 flex-1 cursor-text bg-transparent text-body-l text-fg-primary placeholder:text-fg-tertiary disabled:cursor-not-allowed"
              />
              {showDigits ? (
                <>
                  <span className="text-body-l font-mono text-fg-tertiary" aria-hidden="true">
                    .
                  </span>
                  <input
                    data-slot="signup-field"
                    aria-label="Number"
                    data-testid="digits"
                    value={digits}
                    onChange={event => setDigits(cleanDigits(event.target.value))}
                    maxLength={2}
                    inputMode="numeric"
                    disabled={busy}
                    autoComplete="off"
                    aria-invalid={digitsTaken || undefined}
                    className="h-full w-7 min-w-7 cursor-text bg-transparent text-body-l font-mono text-fg-primary disabled:cursor-not-allowed"
                  />
                </>
              ) : null}
            </div>
            <p className={`text-body-s ${nameLine.tone}`} data-testid="availability">
              {nameLine.text}
            </p>
          </div>

          <div className="flex gap-3">
            <div className="flex w-32 flex-col gap-1.5">
              <label htmlFor="signup-network" className="text-label-m text-fg-secondary">
                Network
              </label>
              <Select value={profile} onValueChange={value => setProfile(value as NetworkProfileId)} disabled={busy}>
                <SelectTrigger id="signup-network" className="h-11 w-full rounded-nested text-body-m">
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
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-center text-body-s text-fg-secondary">
            By continuing you agree to our{' '}
            <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className="text-fg-link transition-colors hover:text-fg-link-hover">
              Terms
            </a>{' '}
            and{' '}
            <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="text-fg-link transition-colors hover:text-fg-link-hover">
              Privacy Policy
            </a>
          </p>
          {busy ? (
            <ol className="flex flex-col gap-1 rounded-nested bg-surface-nested px-4 py-3" data-testid="signup-progress" aria-live="polite">
              {progress.length === 0 ? <li className="text-body-s text-fg-secondary">Starting…</li> : null}
              {progress.map((line, index) => (
                <li key={index} className={index === progress.length - 1 ? 'text-body-s text-fg-primary' : 'text-body-s text-fg-tertiary'}>
                  {line}
                </li>
              ))}
            </ol>
          ) : (
            <Button type="submit" disabled={!canSubmit} className="h-auto w-full rounded-full px-9 py-3.5 text-label-l font-semibold">
              Get username
            </Button>
          )}
          {error ? (
            <p role="alert" className="text-center text-body-s text-fg-error">
              {error}
            </p>
          ) : null}
        </div>
      </form>
    </main>
  );
};
