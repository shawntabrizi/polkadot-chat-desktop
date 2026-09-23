import { useEffect, useState } from 'react';

import { DEFAULT_NETWORK_PROFILE, NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import type { CreateIdentityResponse, DesktopIdentityApi, UsernameAvailability } from '../../shared/desktop-api';

type Props = {
  identityApi: DesktopIdentityApi;
  onSignedUp: (result: CreateIdentityResponse) => void;
};

/** The mobile app's rule: lowercase letters only, 6 to 29 of them. */
const USERNAME = /^[a-z]{6,29}$/;
const MAX_LENGTH = 29;
const CHECK_DELAY_MS = 300;
const CACHE_MS = 60_000;

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

// The IPC layer wraps errors as "Error invoking remote method '…': Error: <message>".
const plainError = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export const SignUp = ({ identityApi, onSignedUp }: Props) => {
  const [username, setUsername] = useState('');
  const [networkPicks, setNetworkPicks] = useState(true);
  const [digits, setDigits] = useState('');
  // True once the user typed digits: a later answer must not overwrite them.
  const [digitsTyped, setDigitsTyped] = useState(false);
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
          const first = answer.availableDigits[0];
          if (first !== undefined) setDigits(current => (digitsTyped && current ? current : twoDigits(first)));
        })
        .catch((cause: unknown) => {
          if (active) setAvailability({ state: 'unknown', reason: plainError(cause) });
        });
    }, CHECK_DELAY_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [identityApi, username, profile, valid, digitsTyped]);

  useEffect(() => identityApi.onProgress(line => setProgress(lines => (lines.at(-1) === line ? lines : [...lines, line]))), [identityApi]);

  const answer = availability.state === 'known' ? availability.answer : null;
  const nameTaken = answer != null && (answer.status === 'TAKEN' || answer.availableDigits.length === 0);
  const digitsWellFormed = /^\d{2}$/.test(digits);
  // Checked against the backend's list when there is one; the backend refuses a taken number itself otherwise.
  const digitsTaken = !networkPicks && answer != null && !(digitsWellFormed && answer.availableDigits.includes(Number(digits)));
  const digitsOk = networkPicks || (digitsWellFormed && !digitsTaken);
  const canSubmit = valid && !nameTaken && digitsOk && availability.state !== 'checking' && !busy;

  const nameLine = (() => {
    switch (availability.state) {
      case 'idle':
        return null;
      case 'checking':
        return 'Checking...';
      case 'unknown':
        return `Could not check the name: ${availability.reason}`;
      case 'known':
        return nameTaken ? 'Taken. Try another.' : "It's yours!";
    }
  })();
  const digitsLine = networkPicks || nameTaken ? null : !digitsWellFormed ? 'Enter two digits.' : digitsTaken ? 'Digits taken. Try again.' : null;

  const submit = () => {
    setBusy(true);
    setError(null);
    setProgress([]);
    identityApi
      .create({ username, digits: networkPicks ? null : digits, profile })
      .then(onSignedUp)
      .catch((cause: unknown) => {
        setError(plainError(cause));
        setBusy(false);
      });
  };

  return (
    <section>
      <h2>Welcome to Polkadot</h2>
      <p>Choose a username to get started.</p>
      <form
        onSubmit={event => {
          event.preventDefault();
          if (canSubmit) submit();
        }}
      >
        <h3>Pick a username</h3>
        <p>
          <input
            aria-label="Username"
            placeholder="Enter username"
            value={username}
            onChange={event => setUsername(cleanUsername(event.target.value))}
            maxLength={MAX_LENGTH}
            disabled={busy}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          <br />
          <small>Minimum 6 characters</small>
        </p>
        <p data-testid="availability">{nameLine}</p>
        <p>
          <label>
            <input type="checkbox" checked={networkPicks} onChange={event => setNetworkPicks(event.target.checked)} disabled={busy} /> Let the
            network pick
          </label>
          <br />
          <label>
            Digits{' '}
            <input
              aria-label="Digits"
              value={digits}
              onChange={event => {
                setDigitsTyped(true);
                setDigits(event.target.value.replace(/\D/g, '').slice(0, 2));
              }}
              inputMode="numeric"
              size={3}
              maxLength={2}
              disabled={busy || networkPicks}
            />
          </label>
          <br />
          <small>
            {valid ? username : 'username'}.{networkPicks ? 'NN' : digits || 'NN'}
          </small>
        </p>
        {digitsLine ? <p data-testid="digits-status">{digitsLine}</p> : null}
        <p>
          <label>
            Network{' '}
            <select value={profile} onChange={event => setProfile(event.target.value as NetworkProfileId)} disabled={busy}>
              {Object.values(NETWORK_PROFILES).map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </p>
        <button type="submit" disabled={!canSubmit}>
          Get username
        </button>
      </form>
      {progress.length > 0 ? (
        <ul data-testid="signup-progress">
          {progress.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
};
