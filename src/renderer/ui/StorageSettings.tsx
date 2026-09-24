// M15c: Settings › Storage. The Bulletin authorization left (read at the
// best block through main), today's uploads against the client's daily
// share, and "Free space" for decrypted copies of received attachments.
// Numbers, not bars: the design system asks for honest figures.

import { useEffect, useState } from 'react';

import { formatSize } from '../domain/chat/attachments';
import { type QuotaView, freeLocalCopies, localCopies, quotaView, readUploadsToday } from '../domain/chat/storageQuota';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { formatDay } from './format';
import { useLiveQuery } from './useLiveQuery';

import type { BulletinQuota } from '../../shared/desktop-api';

/** "Free space" keeps copies newer than this. */
const FREE_CHOICES = [
  { days: 7, label: 'Older than 7 days' },
  { days: 30, label: 'Older than 30 days' },
  { days: 90, label: 'Older than 90 days' },
  { days: 0, label: 'All received copies' },
] as const;

type Quota = { phase: 'loading' } | { phase: 'none' } | { phase: 'off'; reason: string } | { phase: 'ready'; quota: BulletinQuota; at: number };

const Row = ({ label, value, testId }: { label: string; value: string; testId?: string }) => (
  <div className="flex items-baseline justify-between gap-4">
    <dt className="text-body-m text-fg-primary">{label}</dt>
    <dd className="text-body-m text-fg-primary tabular-nums" data-testid={testId}>
      {value}
    </dd>
  </div>
);

const refillDay = (at: number): string => {
  const day = formatDay(at);
  return day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day;
};

export const StorageSettings = ({ attachmentsOn }: { attachmentsOn: boolean }) => {
  const [quota, setQuota] = useState<Quota>({ phase: 'loading' });
  const today = useLiveQuery(() => readUploadsToday(), []);
  const copies = useLiveQuery(localCopies, []);
  const [days, setDays] = useState<number>(30);
  const [freed, setFreed] = useState<string | null>(null);

  // Read once: the effect below must not run again on every render.
  const [api] = useState(() => (attachmentsOn ? (window.desktop?.bulletin ?? null) : null));
  useEffect(() => {
    if (!api) return;
    let live = true;
    api.allowance().then(
      value => {
        if (!live) return;
        setQuota(value ? { phase: 'ready', quota: value, at: Date.now() } : { phase: 'none' });
      },
      (cause: unknown) => {
        if (live) setQuota({ phase: 'off', reason: `The Bulletin chain did not answer (${cause instanceof Error ? cause.message : String(cause)}).` });
      },
    );
    return () => {
      live = false;
    };
  }, [api]);

  const shown: Quota = api ? quota : { phase: 'off', reason: 'This network has no Bulletin chain in the app, so attachments are off.' };
  const grant = shown.phase === 'ready' ? shown.quota : null;
  const view: QuotaView | null = shown.phase === 'ready' && today ? quotaView(shown.quota, today, shown.at) : null;

  const free = () => {
    setFreed(null);
    freeLocalCopies(days).then(
      result => setFreed(result.files === 0 ? 'Nothing to free.' : `Freed ${formatSize(result.bytes)} (${result.files} ${result.files === 1 ? 'file' : 'files'}).`),
      (cause: unknown) => setFreed(cause instanceof Error ? cause.message : 'That did not work.'),
    );
  };

  return (
    <div className="flex flex-col gap-4" data-testid="storage">
      <div className="flex flex-col gap-1">
        <p className="text-label-m text-fg-secondary">Bulletin storage</p>
        <p className="text-body-s text-fg-tertiary">Attachments are stored encrypted on the Bulletin chain for 14 days. Storing costs no fee, only this allowance.</p>
      </div>
      {shown.phase === 'loading' ? <p className="text-body-m text-fg-secondary">Reading the Bulletin chain…</p> : null}
      {shown.phase === 'off' ? <p className="text-body-m text-fg-secondary">{shown.reason}</p> : null}
      {shown.phase === 'none' ? (
        <p className="text-body-m text-fg-secondary" data-testid="quota-none">
          No Bulletin storage yet. The first attachment asks for it.
        </p>
      ) : null}
      {view && grant ? (
        <dl className="flex flex-col gap-1" data-testid="quota">
          <Row label="Space left" value={`${formatSize(view.bytesLeft)} of ${formatSize(grant.bytesTotal)}`} testId="quota-bytes" />
          <Row label="Transactions left" value={`${view.transactionsLeft} of ${grant.transactionsTotal}`} testId="quota-transactions" />
          <Row label="Refills" value={`${refillDay(view.refillsAt)} · block #${view.expiresAtBlock.toLocaleString('en-US')}`} testId="quota-expiry" />
          <Row
            label="Uploads today"
            value={`${view.today.transactions} (${formatSize(view.today.bytes)}) of ${view.budget.transactions} (${formatSize(view.budget.bytes)})`}
            testId="quota-today"
          />
          <p className={view.over ? 'text-body-s text-fg-error' : 'text-body-s text-fg-tertiary'} data-testid="quota-budget-note">
            {view.over
              ? 'Past today’s share. Uploads still go until the allowance runs out, but less is left for the days until it refills.'
              : `Today’s share: what is left, spread over the ${view.daysLeft} ${view.daysLeft === 1 ? 'day' : 'days'} until it refills.`}
          </p>
        </dl>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="text-label-m text-fg-secondary">On this computer</p>
        <dl className="flex flex-col gap-1" data-testid="local-copies">
          <Row label="Received files" value={copies ? `${copies.received.files} · ${formatSize(copies.received.bytes)}` : '…'} testId="copies-received" />
          <Row label="Sent files (kept to resend)" value={copies ? `${copies.sent.files} · ${formatSize(copies.sent.bytes)}` : '…'} testId="copies-sent" />
        </dl>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(days)} onValueChange={value => setDays(Number(value))}>
          <SelectTrigger className="w-56 rounded-nested text-body-m" aria-label="Which copies" data-testid="free-days">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FREE_CHOICES.map(choice => (
              <SelectItem key={choice.days} value={String(choice.days)}>
                {choice.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="secondary" className="rounded-medium text-label-m" onClick={free} data-testid="free-space">
          Free space
        </Button>
      </div>
      <p className="text-body-s text-fg-tertiary" data-testid="free-result">
        {freed ?? 'Deletes the decrypted copies of files people sent you. Each downloads again while it is on the chain. Your own files stay: they are the source of a resend.'}
      </p>
    </div>
  );
};
