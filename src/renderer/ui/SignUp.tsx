import { useEffect, useState } from 'react';

import { DEFAULT_NETWORK_PROFILE, NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import type { CreateIdentityResponse, DesktopIdentityApi, UsernameAvailability } from '../../shared/desktop-api';

import { Logo } from './Logo';
import { plainError } from './format';

type Props = {
  identityApi: DesktopIdentityApi;
  onSignedUp: (result: CreateIdentityResponse) => void;
};

/** The mobile app's rule: lowercase letters only, 6 to 29 of them. */
const USERNAME = /^[a-z]{6,29}$/;
const MAX_LENGTH = 29;
const CHECK_DELAY_MS = 300;
const CACHE_MS = 60_000;
/** The digits Select's value for "Let the network pick". */
const NETWORK_PICKS = 'auto';

const TERMS_URL = 'https://www.polkadotcommunity.foundation/appterms';
const PRIVACY_URL = 'https://www.polkadotcommunity.foundation/privacy';

type Availability =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'known'; answer: UsernameAvailability }
  | { state: 'unknown'; reason: string };

// Answers per network and name, kept 60 s so retyping a name does not ask again.
const cache = new Map<string, { at: number; answer: UsernameAvailability }>();

const checkCached = async (identityApi: DesktopIdentityApi, username: string, profile: NetworkProfileId): Promise<UsernameAvailability> => {
  const key = `${profile}:${username}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.answer;
  const answer = await identityApi.available(username, profile);
  cache.set(key, { at: Date.now(), answer });
  return answer;
};

const twoDigits = (n: number): string => String(n).padStart(2, '0');

// The mobile app filters the field to letters and lowercases it.
const cleanUsername = (raw: string): string => raw.toLowerCase().replace(/[^a-z]/g, '').slice(0, MAX_LENGTH);

/** A centred card on the page surface: the one screen before any chat exists. */
export const SignUp = ({ identityApi, onSignedUp }: Props) => {
  const [username, setUsername] = useState('');
  // NETWORK_PICKS, or two digits the backend offered for this name.
  const [digits, setDigits] = useState(NETWORK_PICKS);
  const [profile, setProfile] = useState<NetworkProfileId>(DEFAULT_NETWORK_PROFILE);
  const [availability, setAvailability] = useState<Availability>({ state: 'idle' });
  const [progress, setProgress] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = USERNAME.test(username);

  // Check when the user pauses typing; a newer keystroke cancels the older check.
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (!valid) {
        setAvailability({ state: 'idle' });
        return;
      }
      setAvailability({ state: 'checking' });
      checkCached(identityApi, username, profile)
        .then(answer => {
          if (!active) return;
          setAvailability({ state: 'known', answer });
          // A choice the new answer no longer offers goes back to the network's pick.
          setDigits(current => (current !== NETWORK_PICKS && answer.availableDigits.includes(Number(current)) ? current : NETWORK_PICKS));
        })
        .catch((cause: unknown) => {
          if (active) setAvailability({ state: 'unknown', reason: plainError(cause, 'no answer came back') });
        });
    }, CHECK_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [identityApi, username, profile, valid]);

  useEffect(() => identityApi.onProgress(line => setProgress(lines => (lines.at(-1) === line ? lines : [...lines, line]))), [identityApi]);

  const answer = availability.state === 'known' ? availability.answer : null;
  const nameTaken = answer != null && (answer.status === 'TAKEN' || answer.availableDigits.length === 0);
  const offered = answer && !nameTaken ? answer.availableDigits : [];
  const canSubmit = valid && !nameTaken && availability.state !== 'checking' && !busy;

  const nameLine = (() => {
    if (!valid) return { text: 'Minimum 6 characters', tone: 'text-fg-tertiary' };
    switch (availability.state) {
      case 'idle':
      case 'checking':
        return { text: 'Checking…', tone: 'text-fg-tertiary' };
      case 'unknown':
        return { text: `Could not check the name: ${availability.reason}. Try again in a moment.`, tone: 'text-fg-error' };
      case 'known':
        return nameTaken ? { text: 'Taken. Try another.', tone: 'text-fg-error' } : { text: "It's yours!", tone: 'text-fg-success' };
    }
  })();

  const submit = () => {
    setBusy(true);
    setError(null);
    setProgress([]);
    identityApi
      .create({ username, digits: digits === NETWORK_PICKS ? null : digits, profile })
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
            <Input
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
              className="h-11 rounded-nested text-body-l md:text-body-l"
            />
            <p className={`text-body-s ${nameLine.tone}`} data-testid="availability">
              {nameLine.text}
            </p>
          </div>

          <div className="flex gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="signup-digits" className="text-label-m text-fg-secondary">
                Number
              </label>
              <Select value={digits} onValueChange={setDigits} disabled={busy}>
                <SelectTrigger id="signup-digits" className="h-11 w-full rounded-nested text-body-m" data-testid="digits">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NETWORK_PICKS}>Let the network pick</SelectItem>
                  {offered.map(number => (
                    <SelectItem key={number} value={twoDigits(number)}>
                      {username}.{twoDigits(number)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
