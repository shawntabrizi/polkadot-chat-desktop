// M12g in the room: the amount row of "Send PAS" and "Request PAS", and the
// requester's own request bubble. The row is inline in the composer area,
// never a modal (design system §10), with stock Input and Button; the
// signing strip of a send is the same TxStrip a bot's `tx` button opens.

import { CircleAlert, CircleCheck, Clock, X } from 'lucide-react';
import { useState } from 'react';

import { MAX_PAYMENT_NOTE, type PaymentRequest, type RequestState, pas, parsePas } from '../domain/chain/payments';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

export type PaymentKind = 'send' | 'request';

type AmountRowProps = {
  kind: PaymentKind;
  peerName: string;
  /** The row's action is running (building the intent, sending the request). */
  busy: boolean;
  onSubmit: (amount: bigint, note: string) => void;
  onCancel: () => void;
};

/**
 * "Send PAS to bob.02": amount (PAS, at most 4 decimals), an optional note
 * (at most 120 characters), and one action: "Review" opens the signing
 * strip; "Send request" sends the request message.
 */
export const AmountRow = ({ kind, peerName, busy, onSubmit, onCancel }: AmountRowProps) => {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const parsed = parsePas(amount);
  const invalid = amount.trim() !== '' && parsed === null;
  const submit = () => {
    if (parsed !== null && !busy) onSubmit(parsed, note);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      // The row only: the room stays open.
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-nested bg-surface-nested p-3" role="group" aria-label={kind === 'send' ? 'Send PAS' : 'Request PAS'} data-testid="payment-row" data-kind={kind}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-label-m text-fg-primary">{kind === 'send' ? `Send PAS to ${peerName}` : `Request PAS from ${peerName}`}</p>
        <Button variant="ghost" size="icon-xs" className="rounded-full font-normal" aria-label="Cancel" onClick={onCancel}>
          <X className="size-4 text-fg-secondary" />
        </Button>
      </div>
      <div className="flex items-start gap-2">
        <div className="relative w-36 shrink-0">
          <Input
            autoFocus
            value={amount}
            inputMode="decimal"
            placeholder="0.00"
            aria-label="Amount in PAS"
            aria-invalid={invalid}
            onChange={event => setAmount(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-9 rounded-medium pe-12 font-mono text-body-m md:text-body-m"
            data-testid="payment-amount"
          />
          <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-body-s text-fg-secondary">PAS</span>
        </div>
        <Input
          value={note}
          maxLength={MAX_PAYMENT_NOTE}
          placeholder="Note (optional)"
          aria-label="Note"
          onChange={event => setNote(event.target.value)}
          onKeyDown={onKeyDown}
          className="h-9 min-w-0 flex-1 rounded-medium text-body-m md:text-body-m"
          data-testid="payment-note"
        />
        <Button type="button" className="h-9 shrink-0 cursor-pointer rounded-medium text-label-m disabled:cursor-not-allowed" disabled={parsed === null || busy} onClick={submit} data-testid="payment-submit">
          {kind === 'send' ? 'Review' : 'Send request'}
        </Button>
      </div>
      {invalid ? (
        <p className="text-body-s text-fg-error" role="alert">
          Type an amount above 0 with at most 4 decimals.
        </p>
      ) : null}
    </div>
  );
};

const STATE_TEXT: Record<RequestState, string> = {
  pending: 'Waiting for payment',
  paid: 'Paid',
  expired: 'Expired',
  declined: 'Declined',
};

/**
 * The requester's own request: "You requested 0.2 PAS", the note, and the
 * state. "Paid" names the block the chain confirmed; while a payment is
 * checked on the chain the state says so.
 */
export const RequestBody = ({ request, state, checking, block }: { request: PaymentRequest; state: RequestState; checking: boolean; block: number | null }) => {
  const Icon = state === 'paid' ? CircleCheck : state === 'pending' ? Clock : CircleAlert;
  const line = state === 'paid' && block !== null ? `Paid · in block #${block}` : state === 'pending' && checking ? 'Checking the payment on the network…' : STATE_TEXT[state];
  return (
    <div className="flex flex-col gap-1" data-testid="payment-request" data-state={state}>
      <p className="text-body-m">
        You requested <span className="font-mono">{pas(request.amount)}</span> PAS
      </p>
      {request.note ? <p className="text-body-s text-fg-secondary-inverted">{request.note}</p> : null}
      <p className={cn('flex items-center gap-1.5 text-label-s', state === 'paid' ? 'text-fg-primary-inverted' : 'text-fg-secondary-inverted')} data-testid="payment-request-state">
        <Icon className="size-3.5" aria-hidden />
        {line}
      </p>
    </div>
  );
};
