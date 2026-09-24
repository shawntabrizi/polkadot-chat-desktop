/**
 * The username claim of sign-up (moved out of SignUp.tsx in M13, unchanged):
 * letters only, checked with the backend when the user pauses typing, and
 * the ".NN" suffix filled with the first free number. Settings › Agent claims
 * the published agent's username with the same rules and the same field.
 */

import { useEffect, useState } from 'react';

import type { NetworkProfileId } from '../app/network';

import type { DesktopIdentityApi, UsernameAvailability } from '../../shared/desktop-api';

import { plainError } from './format';

/** The mobile app's rule: lowercase letters only, 6 to 29 of them. */
export const USERNAME = /^[a-z]{6,29}$/;
export const MAX_LENGTH = 29;
const CHECK_DELAY_MS = 300;
const CACHE_MS = 60_000;

export type Availability =
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
export const cleanUsername = (raw: string): string => raw.toLowerCase().replace(/[^a-z]/g, '').slice(0, MAX_LENGTH);
export const cleanDigits = (raw: string): string => raw.replace(/\D/g, '').slice(0, 2);

export const useUsernameClaim = (identityApi: DesktopIdentityApi, username: string, profile: NetworkProfileId) => {
  // The number after the dot: the backend's first offer, which the user may edit.
  const [digits, setDigits] = useState('');
  const [availability, setAvailability] = useState<Availability>({ state: 'idle' });
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
          // Digits the new answer still offers stay; otherwise the first offer fills in.
          const first = answer.availableDigits[0];
          setDigits(current =>
            /^\d{2}$/.test(current) && answer.availableDigits.includes(Number(current)) ? current : first === undefined ? '' : twoDigits(first),
          );
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

  const answer = availability.state === 'known' ? availability.answer : null;
  const nameTaken = answer != null && (answer.status === 'TAKEN' || answer.availableDigits.length === 0);
  // The ".NN" suffix shows only once the name is valid, checked and free.
  const showDigits = valid && answer != null && !nameTaken;
  const digitsTaken = showDigits && !(/^\d{2}$/.test(digits) && answer.availableDigits.includes(Number(digits)));
  const invalid = nameTaken || digitsTaken;
  const ready = valid && !nameTaken && !digitsTaken && availability.state !== 'checking';

  const nameLine = ((): { text: string; tone: string } => {
    if (!valid) return { text: 'Minimum 6 characters', tone: 'text-fg-tertiary' };
    switch (availability.state) {
      case 'idle':
      case 'checking':
        return { text: 'Checking…', tone: 'text-fg-tertiary' };
      case 'unknown':
        return { text: `Could not check the name: ${availability.reason}. Try again in a moment.`, tone: 'text-fg-error' };
      case 'known':
        if (nameTaken) return { text: 'Taken. Try another.', tone: 'text-fg-error' };
        if (digitsTaken) return { text: 'Digits taken. Try again.', tone: 'text-fg-error' };
        return { text: "It's yours!", tone: 'text-fg-success' };
    }
  })();

  return { digits, setDigits, availability, valid, nameTaken, showDigits, digitsTaken, invalid, ready, nameLine };
};
