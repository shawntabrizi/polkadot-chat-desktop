// Spec 0007 in the room: the signing strip under a `tx` button's bubble, and
// the reference bubble. The strip is inline, never a modal (design system
// §10); amounts and the fee are shown plainly. The hash is an identifier:
// short, in mono, as secondary text beside the bubble's actions, never the
// label of a button (§11). Sign is the strip's primary action at
// `rounded-medium` (a component's action, not the view's pill).

import { Check, CheckCheck, CircleAlert, Copy, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { TxReference, TxStatus } from '../domain/chat/content';
import { referenceLine } from '../domain/chat/content';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';

import type { TxDryRun } from '../../shared/desktop-api';
import { transactionLink } from '../../shared/explorers';
import { type TxIntent, formatUnits } from '../../shared/txIntent';

import { createCopyFlag, shortHash } from './copyFlag';
import { ExplorerButton, useExplorer } from './ExplorerButton';

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

/** Caps, not charges: the most the calls may take; the fee line is what it costs. */
export const capsLine = (caps: NonNullable<TxDryRun['caps']>): string => `Caps: deposit up to ${formatUnits(BigInt(caps.deposit))} PAS, gas ×${caps.gasFactor}`;

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
        {dryRun?.caps ? (
          <p className="text-body-s text-fg-secondary" data-testid="tx-caps">
            {capsLine(dryRun.caps)}
          </p>
        ) : null}
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

/** `copied` is true for 1.5 s after each `copy` (owner-reported bug: it never reset). */
export const useCopied = (): [boolean, (text: string) => void] => {
  const [copied, setCopied] = useState(false);
  const [flag] = useState(() => createCopyFlag(setCopied));
  useEffect(() => () => flag.dispose(), [flag]);
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(flag.copied, (cause: unknown) => console.warn('[tx] copy failed', cause));
  };
  return [copied, copy];
};

/**
 * The body of a reference bubble: "Top up of 1 PAS · in block #123" with
 * the state icon (finality is a later tick, not a wait), then a small row of
 * local actions (client chrome, not spec 0006 buttons): the short hash in
 * mono with the full one in its tooltip, "Copy hash", "View on <explorer>".
 * `line`: a payment's own words (M12g), in place of the note's line.
 */
export const ReferenceBody = ({ reference, own, line = null }: { reference: TxReference; own: boolean; line?: string | null }) => {
  const [copied, copy] = useCopied();
  const explorer = useExplorer();
  const muted = own ? 'text-fg-secondary-inverted' : 'text-fg-secondary';
  return (
    <div className="flex flex-col gap-1" data-testid="tx-reference" data-status={reference.status}>
      <div className="flex items-center gap-2">
        <TxStatusIcon status={reference.status} className={reference.status === 'failed' ? undefined : muted} />
        <p className={cn('min-w-0 text-body-m', reference.status === 'failed' && 'text-fg-error')}>{line ?? referenceLine(reference)}</p>
      </div>
      <div className={cn('-mx-2 flex flex-wrap items-center gap-x-1', muted)} data-testid="tx-actions">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="px-2 font-mono text-caption" tabIndex={0} data-testid="tx-hash">
              {shortHash(reference.hash)}
            </span>
          </TooltipTrigger>
          <TooltipContent className="font-mono break-all">{reference.hash}</TooltipContent>
        </Tooltip>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('h-7 cursor-pointer rounded-medium px-2 text-label-s font-normal', muted)}
          data-testid="tx-copy-hash"
          onClick={() => copy(reference.hash)}
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? 'Copied' : 'Copy hash'}
        </Button>
        <ExplorerButton
          explorer={explorer}
          link={transactionLink(explorer, reference.chainId, reference.hash, reference.block)}
          className={muted}
          testId="tx-explorer"
        />
      </div>
    </div>
  );
};
