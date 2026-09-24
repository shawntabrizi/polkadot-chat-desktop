// M14 DAO chat: the state block of a proposal card, inside the DAO bot's
// proposal bubble between its text and its vote buttons. Everything in it is
// read from the bot's messages and our own references (domain/chat/proposals.ts);
// nothing here sends. A container in the bubble, not a modal (design system §10).

import { Check, Clock, Hourglass, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { type ProposalView, mineLine, phaseLine, proposalPhase } from '../domain/chat/proposals';
import { cn } from '@/lib/cn';

/** Now, ticking every second while `live`; the countdown stops when no vote is open. */
export const useNow = (live: boolean): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return now;
};

export const ProposalStatus = ({ view, now }: { view: ProposalView; now: number }) => {
  const phase = proposalPhase(view, now);
  const Icon = phase === 'executed' || phase === 'passed' ? Check : phase === 'rejected' ? X : phase === 'counting' ? Hourglass : Clock;
  const mine = mineLine(view);
  return (
    <div className="flex flex-col gap-1 rounded-nested bg-surface-container px-3 py-2" data-testid="proposal-card" data-phase={phase}>
      <p className="text-body-s text-fg-primary" data-testid="proposal-tally">
        {view.tally ? `Tally: ${view.tally}` : 'No votes yet'}
      </p>
      <p className={cn('flex items-center gap-1.5 text-body-s', phase === 'executed' ? 'text-fg-success' : 'text-fg-secondary')} data-testid="proposal-phase">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {phaseLine(view, now)}
      </p>
      {mine ? (
        <p className="text-body-s text-fg-secondary" data-testid="proposal-mine">
          {mine}
        </p>
      ) : null}
    </div>
  );
};
