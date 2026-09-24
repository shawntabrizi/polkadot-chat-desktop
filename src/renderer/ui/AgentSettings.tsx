/**
 * M13 Settings › Agent: "Publish my agent". The Assistant gets its own
 * username (claimed like sign-up: the availability check and the ".NN"
 * suffix), and while the toggle is on and this app runs, anyone the audience
 * lets in can chat with it from their own Polkadot app. The keys stay in the
 * main process; this screen shows the username, the guard rails, the kill
 * switch and the last 100 events. No modal: everything is inline.
 */

import { Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { NetworkProfileId } from '../app/network';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import type { AgentAudience, AgentLogEntry, AgentStatus, DesktopAgentApi, DesktopIdentityApi } from '../../shared/desktop-api';

import { Switch } from './controls';
import { plainError } from './format';
import { MAX_LENGTH, cleanDigits, cleanUsername, useUsernameClaim } from './usernameClaim';

const STATE_LINE: Record<AgentStatus['state'], string> = {
  stopped: 'Not published. Nobody can reach it.',
  starting: 'Starting…',
  running: 'Published. It answers while this app runs.',
  failed: 'Stopped: the agent process ended. Turn it off and on to try again.',
};

const AUDIENCE_LABELS: Record<AgentAudience, string> = { contacts: 'My contacts only', anyone: 'Anyone' };

const LOG_TONE: Record<AgentLogEntry['kind'], string> = {
  info: 'text-fg-secondary',
  in: 'text-fg-primary',
  out: 'text-fg-primary',
  refused: 'text-fg-warning',
  error: 'text-fg-error',
};

const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The claim form: shown until the agent has a username. */
const ClaimForm = ({ api, identityApi, profileId }: { api: DesktopAgentApi; identityApi: DesktopIdentityApi; profileId: NetworkProfileId }) => {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { digits, setDigits, nameTaken, showDigits, digitsTaken, invalid, ready, nameLine } = useUsernameClaim(identityApi, username, profileId);

  useEffect(() => api.onProgress(line => setProgress(lines => (lines.at(-1) === line ? lines : [...lines, line]))), [api]);

  const submit = () => {
    setBusy(true);
    setError(null);
    setProgress([]);
    api.claim({ username, digits, profile: profileId }).catch((cause: unknown) => {
      setError(`${plainError(cause, 'The username was not claimed.')} Try again.`);
      setBusy(false);
    });
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={event => {
        event.preventDefault();
        if (ready && !busy) submit();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="agent-username" className="text-label-m text-fg-secondary">
          Agent username
        </label>
        {/* The sign-up field: the name, then ".NN" inside the same border. */}
        <div
          data-invalid={invalid || undefined}
          className={`flex h-10 w-80 max-w-full items-center rounded-nested border px-3 transition-colors focus-within:outline-2 focus-within:outline-offset-2 ${
            invalid ? 'border-stroke-error focus-within:outline-focus-error' : 'border-stroke-primary focus-within:outline-focus-ring'
          } ${busy ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <input
            data-slot="signup-field"
            id="agent-username"
            aria-label="Agent username"
            placeholder="e.g. shawnbot"
            value={username}
            onChange={event => setUsername(cleanUsername(event.target.value))}
            maxLength={MAX_LENGTH}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={nameTaken || undefined}
            data-testid="agent-username-input"
            className="h-full min-w-0 flex-1 cursor-text bg-transparent text-body-m text-fg-primary placeholder:text-fg-tertiary disabled:cursor-not-allowed"
          />
          {showDigits ? (
            <>
              <span className="text-body-m font-mono text-fg-tertiary" aria-hidden="true">
                .
              </span>
              <input
                data-slot="signup-field"
                aria-label="Number"
                value={digits}
                onChange={event => setDigits(cleanDigits(event.target.value))}
                maxLength={2}
                inputMode="numeric"
                disabled={busy}
                autoComplete="off"
                aria-invalid={digitsTaken || undefined}
                className="h-full w-7 min-w-7 cursor-text bg-transparent text-body-m font-mono text-fg-primary disabled:cursor-not-allowed"
              />
            </>
          ) : null}
        </div>
        <p className={`text-body-s ${nameLine.tone}`} data-testid="agent-availability">
          {nameLine.text}
        </p>
      </div>
      {busy ? (
        <ol className="flex flex-col gap-1 rounded-nested bg-surface-nested px-4 py-3" aria-live="polite" data-testid="agent-progress">
          {progress.length === 0 ? <li className="text-body-s text-fg-secondary">Starting…</li> : null}
          {progress.map((line, index) => (
            <li key={index} className={index === progress.length - 1 ? 'text-body-s text-fg-primary' : 'text-body-s text-fg-tertiary'}>
              {line}
            </li>
          ))}
        </ol>
      ) : (
        <Button type="submit" disabled={!ready} className="w-fit rounded-medium text-label-m" data-testid="agent-publish">
          Publish my agent
        </Button>
      )}
      {error ? (
        <p role="alert" className="text-body-m text-fg-error">
          {error}
        </p>
      ) : null}
    </form>
  );
};

/** The published agent: toggle, username, guard rails, kill switch, log. */
const AgentPanel = ({ api, status }: { api: DesktopAgentApi; status: AgentStatus & { identity: NonNullable<AgentStatus['identity']> } }) => {
  const [copied, setCopied] = useState(false);
  const [dailyCap, setDailyCap] = useState(String(status.dailyCap));
  const [cooldown, setCooldown] = useState(String(status.cooldownSeconds));
  const [message, setMessage] = useState<{ text: string; tone: 'plain' | 'error' } | null>(null);

  const change = (update: Parameters<DesktopAgentApi['update']>[0]) => {
    setMessage(null);
    api.update(update).catch((cause: unknown) => setMessage({ text: `${plainError(cause, 'The change was not saved.')} Fix it and try again.`, tone: 'error' }));
  };
  const saveLimits = () => {
    const cap = Number(dailyCap);
    const seconds = Number(cooldown);
    if (!Number.isInteger(cap) || !Number.isInteger(seconds)) {
      setMessage({ text: 'Enter whole numbers.', tone: 'error' });
      return;
    }
    change({ dailyCap: cap, cooldownSeconds: seconds });
    setMessage({ text: 'Saved.', tone: 'plain' });
  };

  const newestFirst = [...status.log].reverse();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="agent-enabled" className="flex cursor-pointer flex-col gap-0.5">
          <span className="text-body-m text-fg-primary">Publish my agent</span>
          <span className={status.state === 'failed' ? 'text-body-s text-fg-error' : 'text-body-s text-fg-tertiary'} data-testid="agent-state">
            {status.enabled && status.state === 'stopped' ? 'Starting…' : STATE_LINE[status.state]}
          </span>
        </label>
        <Switch id="agent-enabled" checked={status.enabled} onCheckedChange={on => change({ enabled: on })} data-testid="agent-switch" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-label-l text-fg-primary" data-testid="agent-username">
            {status.identity.username}
          </p>
          <p className="text-body-s text-fg-tertiary">Share this name: people find your agent by it. It has its own keys, apart from yours.</p>
        </div>
        <Button
          variant="secondary"
          className="w-fit rounded-medium text-label-m"
          onClick={() => void navigator.clipboard.writeText(status.identity.username).then(() => setCopied(true))}
          data-testid="agent-copy"
        >
          <Copy aria-hidden />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="agent-audience" className="text-label-m text-fg-secondary">
          Who can chat with it
        </label>
        <Select value={status.audience} onValueChange={value => change({ audience: value as AgentAudience })}>
          <SelectTrigger id="agent-audience" className="w-64 rounded-nested text-body-m" data-testid="agent-audience">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(AUDIENCE_LABELS) as AgentAudience[]).map(audience => (
              <SelectItem key={audience} value={audience}>
                {AUDIENCE_LABELS[audience]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-body-s text-fg-tertiary">
          {status.audience === 'contacts' ? 'Requests from anyone else are refused before the agent accepts them.' : 'Any Polkadot user can start a chat with it.'}
        </p>
      </div>

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={event => {
          event.preventDefault();
          saveLimits();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="agent-cap" className="text-label-m text-fg-secondary">
            Replies per day
          </label>
          <Input id="agent-cap" inputMode="numeric" value={dailyCap} onChange={event => setDailyCap(event.target.value)} className="h-10 w-32 rounded-nested text-body-m md:text-body-m" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="agent-cooldown" className="text-label-m text-fg-secondary">
            Seconds between replies to one person
          </label>
          <Input id="agent-cooldown" inputMode="numeric" value={cooldown} onChange={event => setCooldown(event.target.value)} className="h-10 w-32 rounded-nested text-body-m md:text-body-m" />
        </div>
        <Button type="submit" variant="secondary" className="w-fit rounded-medium text-label-m">
          Save
        </Button>
      </form>
      <p className="text-body-s text-fg-secondary" data-testid="agent-usage">
        {status.repliesLeft} of {status.dailyCap} replies left today · {status.stats.replies} replies and {status.stats.submissions} network submissions since the app started
      </p>
      {message ? <p className={message.tone === 'error' ? 'text-body-m text-fg-error' : 'text-body-m text-fg-secondary'}>{message.text}</p> : null}

      {status.enabled ? (
        <div className="flex flex-col gap-1.5">
          <Button variant="destructive" className="w-fit rounded-medium text-label-m text-fg-primary-inverted" onClick={() => void api.kill()} data-testid="agent-kill">
            Stop now
          </Button>
          <p className="text-body-s text-fg-tertiary">Turns publishing off at once, stops what it is answering, and accepts no new chats.</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <p className="text-label-m text-fg-secondary">Log</p>
        {newestFirst.length === 0 ? (
          <p className="text-body-s text-fg-tertiary">Nothing yet.</p>
        ) : (
          <ol className="flex max-h-72 flex-col gap-0.5 overflow-y-auto rounded-nested bg-surface-nested px-3 py-2" data-testid="agent-log">
            {newestFirst.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="flex gap-3 text-body-s">
                <span className="shrink-0 font-mono text-fg-tertiary">{clock(entry.at)}</span>
                <span className={`min-w-0 ${LOG_TONE[entry.kind]}`}>{entry.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
};

export const AgentSettings = ({ api, identityApi, profileId }: { api: DesktopAgentApi; identityApi: DesktopIdentityApi; profileId: NetworkProfileId }) => {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const stop = api.onChanged(next => setStatus(next));
    api.status().then(
      next => {
        if (live) setStatus(next);
      },
      (cause: unknown) => setError(`${plainError(cause, 'The agent settings did not load.')} Reopen Settings to try again.`),
    );
    return () => {
      live = false;
      stop();
    };
  }, [api]);

  if (!status) return <p className={error ? 'text-body-m text-fg-error' : 'text-body-m text-fg-tertiary'}>{error ?? 'Loading…'}</p>;
  return (
    <div className="flex flex-col gap-4" data-testid="agent-settings">
      <p className="text-body-m text-fg-secondary">
        Give the Assistant its own username, so a phone user or any peer can chat with it while this app runs. It answers with the engine chosen under
        Assistant, with its tools off.
      </p>
      {status.identity ? <AgentPanel api={api} status={{ ...status, identity: status.identity }} /> : <ClaimForm api={api} identityApi={identityApi} profileId={profileId} />}
    </div>
  );
};
