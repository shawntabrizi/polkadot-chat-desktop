// Spec 0008 badge after a peer's name (M10 step 2): a small Lucide icon in
// fg-secondary with a tooltip, never a pill (.refs/polkadot-design-system
// SKILL.md §8 inline icon size, §10).

import { Bot, Sparkles } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** What the badge says for a `botInfo.kind`: 1 is an AI agent; 0, 2 and any later kind show as a bot. */
export const badgeLabel = (kind: number): string => (kind === 1 ? 'AI agent' : kind === 2 ? 'Service' : 'Bot');

export const BotBadge = ({ kind }: { kind: number }) => {
  const label = badgeLabel(kind);
  const Icon = kind === 1 ? Sparkles : Bot;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0" aria-label={label} role="img" data-testid="bot-badge" data-kind={kind}>
          <Icon className="size-3.5 text-fg-secondary" aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};
