/**
 * M18 profiles: the picker (a pane like sign-up, shown at launch when there
 * are several profiles and no default) and Settings › Profiles. Each profile
 * is its own identity in its own process; this window only asks main to open,
 * start, rename or remove one.
 */

import { AppWindow, KeyRound, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { DEFAULT_NETWORK_PROFILE, NETWORK_PROFILES, type NetworkProfileId } from '../app/network';
import { UNDO_MS } from '../domain/chat/undo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Toaster } from '@/components/ui/sonner';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import type { DesktopProfilesApi, ProfileRow, ProfilesState } from '../../shared/desktop-api';

import { PeerAvatar } from './Avatar';
import { Logo } from './Logo';
import { plainError } from './format';
import { profileCaption } from './profileCaption';

/** How often the running marks are read again (another window may open or close a profile). */
const POLL_MS = 2000;
const PICKER_VALUE = '__picker__';

const useProfiles = (api: DesktopProfilesApi | null) => {
  const [state, setState] = useState<ProfilesState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    if (!api) return;
    api.state().then(
      next => {
        setState(next);
        setError(null);
      },
      (cause: unknown) => setError(plainError(cause, 'The profiles did not load.')),
    );
  }, [api]);
  useEffect(() => {
    reload();
    const timer = setInterval(reload, POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);
  return { state, setState, error, reload };
};

const failed = (what: string) => (cause: unknown) => toast(what, { description: plainError(cause, 'Try again.') });

const NewWindowButton = ({ row, api }: { row: ProfileRow; api: DesktopProfilesApi }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className="rounded-medium font-normal"
        aria-label={`Open ${row.label} in new window`}
        data-testid="profile-open-new-window"
        onClick={() => void api.openInNewWindow(row.name).catch(failed('The profile did not open'))}
      >
        <AppWindow aria-hidden />
      </Button>
    </TooltipTrigger>
    <TooltipContent>Open in new window</TooltipContent>
  </Tooltip>
);

/**
 * M19 "Add profile from a recovery phrase" (inline, under the picker's
 * buttons): main derives the identity, reads its username on the chosen
 * network, and creates the profile; then this window opens it. The phrase
 * is held in this form only while it is open.
 */
const RestoreForm = ({ api, onDone }: { api: DesktopProfilesApi; onDone: () => void }) => {
  const [phrase, setPhrase] = useState('');
  const [network, setNetwork] = useState<NetworkProfileId>(DEFAULT_NETWORK_PROFILE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const words = phrase.trim().split(/\s+/).filter(Boolean).length;
  const restore = () => {
    setBusy(true);
    setError(null);
    api
      .restore(phrase, network)
      .then(name => api.open(name))
      .catch((cause: unknown) => {
        setError(plainError(cause, 'The profile was not restored.'));
        setBusy(false);
      });
  };
  return (
    <form
      className="flex flex-col gap-3 rounded-nested bg-surface-nested p-4"
      data-testid="profile-restore-form"
      onSubmit={event => {
        event.preventDefault();
        restore();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="restore-phrase" className="text-label-m text-fg-secondary">
          Recovery phrase
        </label>
        <Textarea
          id="restore-phrase"
          value={phrase}
          onChange={event => setPhrase(event.target.value)}
          placeholder="The 12 words, in order"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus
          disabled={busy}
          className="min-h-24 rounded-nested font-mono text-body-m md:text-body-m"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="restore-network" className="text-label-m text-fg-secondary">
          Network
        </label>
        <Select value={network} onValueChange={value => setNetwork(value as NetworkProfileId)} disabled={busy}>
          <SelectTrigger id="restore-network" className="w-64 rounded-nested text-body-m">
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
      {error ? (
        <p role="alert" className="text-body-m text-fg-error">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" className="w-fit rounded-medium text-label-m" disabled={busy || words < 12} data-testid="profile-restore">
          {busy ? 'Restoring…' : 'Restore profile'}
        </Button>
        <Button type="button" variant="ghost" className="rounded-medium text-label-m font-normal" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
};

/**
 * The picker: one row per profile, "Open" here, "Open in new window", and
 * "Add profile" (a new empty profile opens here and shows sign-up). A profile
 * already open in another window shows "Show", which brings that window to
 * the front instead of opening it twice.
 */
export const ProfilePicker = ({ api }: { api: DesktopProfilesApi }) => {
  const { state, error } = useProfiles(api);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const act = (run: () => Promise<void>, what: string) => {
    setBusy(true);
    run().catch((cause: unknown) => {
      failed(what)(cause);
      setBusy(false);
    });
  };
  return (
    <TooltipProvider>
      <main className="flex min-h-screen items-center justify-center p-4">
        <section className="flex w-full max-w-[480px] flex-col gap-6 rounded-container bg-surface-container p-8 shadow-1" data-testid="profile-picker">
          <div className="flex flex-col items-center gap-4 text-center">
            <Logo className="h-12" />
            <div className="flex flex-col gap-2">
              <h1 className="text-display-l text-fg-primary">Choose a profile</h1>
              <p className="text-body-l text-fg-secondary">Each profile is its own identity with its own chats.</p>
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-center text-body-m text-fg-error">
              {error}
            </p>
          ) : null}
          <ul className="-mx-2 flex flex-col" aria-label="Profiles">
            {(state?.profiles ?? []).map(row => (
              <li key={row.name} className="flex items-center gap-3 rounded-nested px-2 py-2 transition-colors hover:bg-selection-container-hover" data-testid="profile-row" data-running={row.running || undefined}>
                <PeerAvatar name={row.username ?? row.label} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label-l text-fg-primary">{row.label}</p>
                  <p className="truncate text-body-s text-fg-tertiary" data-testid="profile-caption">
                    {profileCaption(row)}
                  </p>
                </div>
                {row.running ? (
                  <Button variant="secondary" className="rounded-medium text-label-m" disabled={busy} onClick={() => act(() => api.openInNewWindow(row.name), 'The window did not come to the front')}>
                    Show
                  </Button>
                ) : (
                  <>
                    <NewWindowButton row={row} api={api} />
                    <Button className="rounded-medium text-label-m" disabled={busy} data-testid="profile-open" onClick={() => act(() => api.open(row.name), 'The profile did not open')}>
                      Open
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <Button variant="secondary" className="h-auto w-full rounded-full px-9 py-3.5 text-label-l font-semibold" disabled={busy} data-testid="profile-add" onClick={() => act(api.add, 'The profile was not added')}>
            <Plus aria-hidden />
            Add profile
          </Button>
          {restoring ? (
            <RestoreForm api={api} onDone={() => setRestoring(false)} />
          ) : (
            <Button variant="ghost" className="h-auto w-full rounded-full px-9 py-3.5 text-body-m font-normal" disabled={busy} data-testid="profile-restore-open" onClick={() => setRestoring(true)}>
              <KeyRound aria-hidden />
              Add profile from a recovery phrase
            </Button>
          )}
        </section>
      </main>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
};

type RowMode = { kind: 'idle' } | { kind: 'rename'; value: string } | { kind: 'remove' };

const SettingsRow = ({ row, api, onState, onRemove }: { row: ProfileRow; api: DesktopProfilesApi; onState: (state: ProfilesState) => void; onRemove: (row: ProfileRow) => void }) => {
  const [mode, setMode] = useState<RowMode>({ kind: 'idle' });
  const save = (value: string) => {
    api.rename(row.name, value).then(next => {
      onState(next);
      setMode({ kind: 'idle' });
    }, failed('The name was not saved'));
  };
  return (
    <li className="flex flex-col gap-3 rounded-nested px-2 py-2 transition-colors hover:bg-selection-container-hover" data-testid="settings-profile-row">
      <div className="flex items-center gap-3">
        <PeerAvatar name={row.username ?? row.label} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-label-m text-fg-primary">{row.label}</p>
          <p className="truncate text-caption text-fg-tertiary">{profileCaption(row)}</p>
        </div>
        {mode.kind === 'idle' ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" className="rounded-medium text-label-m font-normal" onClick={() => setMode({ kind: 'rename', value: row.label })}>
              Rename
            </Button>
            {row.current ? null : <NewWindowButton row={row} api={api} />}
            {row.running ? null : (
              <Button variant="ghost" className="rounded-medium text-label-m font-normal text-fg-error" onClick={() => setMode({ kind: 'remove' })} data-testid="profile-remove">
                Remove…
              </Button>
            )}
          </div>
        ) : null}
      </div>
      {mode.kind === 'rename' ? (
        <form
          className="flex items-center gap-2 ps-11"
          onSubmit={event => {
            event.preventDefault();
            save(mode.value);
          }}
        >
          <Input
            value={mode.value}
            onChange={event => setMode({ kind: 'rename', value: event.target.value })}
            maxLength={40}
            aria-label="Profile name"
            autoFocus
            className="h-10 max-w-64 rounded-nested text-body-m md:text-body-m"
          />
          <Button type="submit" className="rounded-medium text-label-m">
            Save
          </Button>
          <Button type="button" variant="ghost" className="rounded-medium text-label-m font-normal" onClick={() => setMode({ kind: 'idle' })}>
            Cancel
          </Button>
        </form>
      ) : null}
      {mode.kind === 'remove' ? (
        <div className="ms-11 flex flex-col gap-3 rounded-nested bg-surface-nested px-4 py-3" data-testid="profile-remove-confirm">
          <p className="text-body-m text-fg-secondary">
            Removing deletes this profile’s keys and chats from this computer. Write down its recovery phrase first (Settings › Security in that
            profile): without it, {row.username ?? 'this identity'} cannot be used again.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="destructive"
              className="w-fit rounded-medium text-label-m text-fg-primary-inverted"
              onClick={() => {
                setMode({ kind: 'idle' });
                onRemove(row);
              }}
            >
              Remove profile
            </Button>
            <Button variant="ghost" className="rounded-medium text-label-m font-normal" onClick={() => setMode({ kind: 'idle' })}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
};

/**
 * Settings › Profiles: the list with rename, open in a new window and
 * remove (Undo for 6 s, then the directory is deleted; an open profile
 * cannot be removed), the profile opened at launch, and the picker.
 */
export const ProfilesSettings = ({ api }: { api: DesktopProfilesApi }) => {
  const { state, setState, error, reload } = useProfiles(api);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const show = (name: string, on: boolean) =>
    setHidden(current => {
      const next = new Set(current);
      if (on) next.delete(name);
      else next.add(name);
      return next;
    });

  const remove = (row: ProfileRow) => {
    show(row.name, false);
    let undone = false;
    const commit = setTimeout(() => {
      if (undone) return;
      api.remove(row.name).then(
        next => {
          setState(next);
          show(row.name, true);
        },
        (cause: unknown) => {
          show(row.name, true);
          failed('The profile was not removed')(cause);
          reload();
        },
      );
    }, UNDO_MS);
    toast('Profile removed', {
      description: `${row.label} and its chats are deleted from this computer when this closes.`,
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          clearTimeout(commit);
          show(row.name, true);
        },
      },
    });
  };

  const rows = (state?.profiles ?? []).filter(row => !hidden.has(row.name));
  return (
    <div className="flex flex-col gap-4" data-testid="settings-profiles">
      <p className="text-body-s text-fg-tertiary">Each profile is its own identity with its own chats, and opens in its own window.</p>
      {error ? (
        <p role="alert" className="text-body-m text-fg-error">
          {error}
        </p>
      ) : null}
      <ul className="-mx-2 flex flex-col" aria-label="Profiles">
        {rows.map(row => (
          <SettingsRow key={row.name} row={row} api={api} onState={setState} onRemove={remove} />
        ))}
      </ul>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="profile-default" className="text-label-m text-fg-secondary">
          At launch
        </label>
        <Select
          value={state?.defaultProfile ?? PICKER_VALUE}
          onValueChange={value => {
            api.setDefault(value === PICKER_VALUE ? null : value).then(setState, failed('The choice was not saved'));
          }}
        >
          <SelectTrigger id="profile-default" className="w-64 rounded-nested text-body-m" data-testid="profile-default-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PICKER_VALUE}>Ask which profile</SelectItem>
            {(state?.profiles ?? []).map(row => (
              <SelectItem key={row.name} value={row.name}>
                Open {row.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-body-s text-fg-tertiary">With one profile the app always opens it.</p>
      </div>
      <Button variant="secondary" className="w-fit rounded-medium text-label-m" onClick={() => void api.openPicker().catch(failed('The picker did not open'))} data-testid="profile-open-another">
        <AppWindow aria-hidden />
        Open another profile
      </Button>
    </div>
  );
};
