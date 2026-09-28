/**
 * M22a: the web build's passphrase screens, in the sign-up card's style
 * (renderer/ui/SignUp.tsx). `create`: choose one at sign-up, typed twice.
 * `unlock`: open the saved account at page start, or forget it.
 */

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Logo } from '@/ui/Logo';

import { MIN_PASSPHRASE_LENGTH, passphraseProblem } from '../vault';

const inputClass = 'h-11 rounded-nested text-body-l md:text-body-l';

type Props =
  | { mode: 'create'; onDone: (passphrase: string | null) => void }
  | { mode: 'unlock'; username: string; onUnlock: (passphrase: string) => Promise<void>; onForget: () => Promise<void> };

export const PassphraseCard = (props: Props) => {
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmForget, setConfirmForget] = useState(false);

  const submit = () => {
    if (props.mode === 'create') {
      const problem = passphraseProblem(passphrase) ?? (passphrase !== again ? 'The two passphrases differ.' : null);
      if (problem) return setError(problem);
      props.onDone(passphrase);
      return;
    }
    setBusy(true);
    setError(null);
    props.onUnlock(passphrase).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'The account did not open.');
      setBusy(false);
    });
  };

  return (
    <main className="fixed inset-0 z-50 flex items-center justify-center bg-surface-main p-4" data-testid={`web-passphrase-${props.mode}`}>
      <form
        className="flex w-full max-w-[440px] flex-col gap-6 rounded-container bg-surface-container p-8 shadow-1"
        onSubmit={event => {
          event.preventDefault();
          if (!busy) submit();
        }}
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <Logo className="h-12" />
          <div className="flex flex-col gap-2">
            <h1 className="text-heading-l text-fg-primary">{props.mode === 'create' ? 'Protect this account' : `Unlock ${props.username}`}</h1>
            <p className="text-body-m text-fg-secondary">
              {props.mode === 'create'
                ? `Choose a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters. It encrypts your keys in this browser. It cannot be recovered; the recovery phrase in Settings is the backup.`
                : 'Enter the passphrase that encrypts your keys in this browser.'}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Input
            type="password"
            aria-label="Passphrase"
            placeholder="Passphrase"
            value={passphrase}
            onChange={event => setPassphrase(event.target.value)}
            autoComplete={props.mode === 'create' ? 'new-password' : 'current-password'}
            autoFocus
            disabled={busy}
            className={inputClass}
            data-testid="web-passphrase"
          />
          {props.mode === 'create' ? (
            <Input
              type="password"
              aria-label="Passphrase again"
              placeholder="Passphrase again"
              value={again}
              onChange={event => setAgain(event.target.value)}
              autoComplete="new-password"
              className={inputClass}
              data-testid="web-passphrase-again"
            />
          ) : null}
          {error ? (
            <p role="alert" className="text-body-s text-fg-error">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Button type="submit" disabled={busy || passphrase.length === 0} className="h-auto w-full rounded-full px-9 py-3.5 text-label-l font-semibold">
            {props.mode === 'create' ? 'Continue' : busy ? 'Unlocking…' : 'Unlock'}
          </Button>
          {props.mode === 'create' ? (
            <Button type="button" variant="ghost" className="rounded-medium text-label-m font-normal" onClick={() => props.onDone(null)}>
              Cancel
            </Button>
          ) : confirmForget ? (
            <div className="flex flex-col gap-2 rounded-nested bg-surface-nested p-3">
              <p className="text-body-s text-fg-warning">This deletes the account from this browser. Without the recovery phrase it is gone for good.</p>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" className="rounded-medium text-label-m" onClick={() => void props.onForget()} data-testid="web-forget-confirm">
                  Delete from this browser
                </Button>
                <Button type="button" variant="ghost" className="rounded-medium text-label-m font-normal" onClick={() => setConfirmForget(false)}>
                  Keep
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="ghost" className="rounded-medium text-label-m font-normal" onClick={() => setConfirmForget(true)}>
              Forgot the passphrase?
            </Button>
          )}
        </div>
      </form>
    </main>
  );
};
