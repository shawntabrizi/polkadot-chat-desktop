// Spec 0007 in the room: the signing strip under a `tx` button's bubble, and
// the reference bubble. The strip is inline, never a modal (design system
// §10); amounts and the fee are shown plainly and the hash only behind Copy
// (§11: never a raw hash as a label). Sign is the strip's primary action at
// `rounded-medium` (a component's action, not the view's pill).

import { Check, CheckCheck, CircleAlert, Copy, LoaderCircle } from 'lucide-react';
import { useState } from 'react';

import type { TxReference, TxStatus } from '../domain/chat/content';
import { referenceLine } from '../domain/chat/content';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';

import type { TxDryRun } from '../../shared/desktop-api';
import { type TxIntent, formatUnits } from '../../shared/txIntent';

/** Where the strip is: testing, ready to sign, refused, signing. */
export type StripPhase =
  | { phase: 'checking' }
  | { phase: 'ready'; dryRun: TxDryRun }
  | { phase: 'refused'; reason: string; dryRun: TxDryRun | null }
  | { phase: 'signing'; dryRun: TxDryRun };

type StripProps = {
  intent: TxIntent;
  state: StripPhase;
  /** The chat identity's username: the account that signs. */
  signerName: string;
  /** "Balance after: 1.1 PAS", when the app knows the contract (the Meter). */
  outcome: string | null;
  onSign: () => void;
  onCancel: () => void;
};

const Row = ({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) => (
  <div className="flex items-baseline justify-between gap-4" data-testid={testId}>
    <span className="text-body-s text-fg-secondary">{label}</span>
    <span className="min-w-0 truncate text-end text-body-s text-fg-primary">{children}</span>
  </div>
);

const amountText = (intent: TxIntent): string | null =>
  intent.display.amount ? `${intent.display.amount}${intent.display.asset ? ` ${intent.display.asset}` : ''}` : null;

export const TxStrip = ({ intent, state, signerName, outcome, onSign, onCancel }: StripProps) => {
  const dryRun = state.phase === 'checking' ? null : state.dryRun;
  const fee = dryRun?.fee ? `≈ ${formatUnits(BigInt(dryRun.fee))} PAS` : state.phase === 'checking' ? 'Checking…' : '—';
  // The amount is always stated: the intent's own words, else the value the calls move.
  const amount = amountText(intent) ?? (dryRun && BigInt(dryRun.value) > 0n ? `${formatUnits(BigInt(dryRun.value))} PAS` : dryRun ? 'No transfer' : '…');
  return (
    <div className="flex w-full max-w-sm flex-col gap-2 rounded-nested bg-surface-container p-3 shadow-1" role="group" aria-label="Sign a transaction" data-testid="tx-strip" data-phase={state.phase}>
      <div className="flex flex-col gap-0.5">
        <p className="text-label-m text-fg-primary">{intent.display.title}</p>
        {intent.display.description ? <p className="text-body-s text-fg-secondary">{intent.display.description}</p> : null}
      </div>
      <div className="flex flex-col gap-1">
        <Row label="Amount" testId="tx-amount">
          {amount}
        </Row>
        <Row label="Fee" testId="tx-fee">
          {fee}
        </Row>
        <Row label="Signs as">{signerName}</Row>
        {dryRun?.mapsAccount ? <Row label="First contract use">Links your account to contracts, once</Row> : null}
      </div>
      <p
        className={cn('text-body-s', state.phase === 'refused' ? 'text-fg-error' : 'text-fg-secondary')}
        role={state.phase === 'refused' ? 'alert' : 'status'}
        data-testid="tx-outcome"
      >
        {state.phase === 'checking'
          ? 'Testing it on the network…'
          : state.phase === 'refused'
            ? state.reason
            : state.phase === 'signing'
              ? 'Signing and sending…'
              : (outcome ?? 'The test run passed.')}
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" className="cursor-pointer rounded-medium font-normal" onClick={onCancel} disabled={state.phase === 'signing'}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="cursor-pointer rounded-medium disabled:cursor-not-allowed"
          onClick={onSign}
          disabled={state.phase !== 'ready'}
          data-testid="tx-sign"
        >
          {state.phase === 'signing' ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : null}
          Sign
        </Button>
      </div>
    </div>
  );
};

/** The icon of a transaction state: on the reference bubble and on the pressed button. */
export const TxStatusIcon = ({ status, className }: { status: TxStatus; className?: string }) => {
  switch (status) {
    case 'submitted':
      return <LoaderCircle className={cn('size-3.5 animate-spin', className)} aria-label="Submitted" />;
    case 'inBlock':
      return <Check className={cn('size-3.5', className)} aria-label="In block" />;
    case 'finalized':
      return <CheckCheck className={cn('size-3.5', className)} aria-label="Finalized" />;
    case 'failed':
      return <CircleAlert className={cn('size-3.5 text-fg-error', className)} aria-label="Failed" />;
  }
};

/**
 * The body of a reference bubble: "Top up of 1 PAS · in block #123", the
 * state icon (finality is a later tick, not a wait), and Copy for the hash.
 */
export const ReferenceBody = ({ reference, own }: { reference: TxReference; own: boolean }) => {
  const [copied, setCopied] = useState(false);
  const muted = own ? 'text-fg-secondary-inverted' : 'text-fg-secondary';
  return (
    <div className="flex items-center gap-2" data-testid="tx-reference" data-status={reference.status}>
      <TxStatusIcon status={reference.status} className={reference.status === 'failed' ? undefined : muted} />
      <p className={cn('min-w-0 text-body-m', reference.status === 'failed' && 'text-fg-error')}>{referenceLine(reference)}</p>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn('size-7 shrink-0 cursor-pointer rounded-full font-normal', muted)}
            aria-label={copied ? 'Hash copied' : 'Copy transaction hash'}
            data-testid="tx-copy-hash"
            onClick={() => {
              void navigator.clipboard.writeText(reference.hash).then(() => setCopied(true));
            }}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{copied ? 'Copied' : 'Copy transaction hash'}</TooltipContent>
      </Tooltip>
    </div>
  );
};
