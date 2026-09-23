// getAvatarTone ported from .refs/polkadot-desktop/src/features/chat/ui/helpers/avatar.ts
// on 2026-09-23; changes: the tone list is the design system's ten avatar pairs
// (same order as @novasamatech/tr-ui `avatarTones`), rendered on shadcn Avatar.

import { Sparkles, Users } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';

const TONES = ['amethyst', 'opal', 'turquoise', 'onyx', 'pearl', 'emerald', 'topaz', 'ruby', 'sapphire', 'garnet'] as const;

type Tone = (typeof TONES)[number];

// Whole class names, so Tailwind finds them. Avatar tokens are theme-invariant:
// a contact keeps its colour in every theme.
const TONE_CLASS: Record<Tone, string> = {
  amethyst: 'bg-avatar-bg-amethyst text-avatar-fg-amethyst',
  opal: 'bg-avatar-bg-opal text-avatar-fg-opal',
  turquoise: 'bg-avatar-bg-turquoise text-avatar-fg-turquoise',
  onyx: 'bg-avatar-bg-onyx text-avatar-fg-onyx',
  pearl: 'bg-avatar-bg-pearl text-avatar-fg-pearl',
  emerald: 'bg-avatar-bg-emerald text-avatar-fg-emerald',
  topaz: 'bg-avatar-bg-topaz text-avatar-fg-topaz',
  ruby: 'bg-avatar-bg-ruby text-avatar-fg-ruby',
  sapphire: 'bg-avatar-bg-sapphire text-avatar-fg-sapphire',
  garnet: 'bg-avatar-bg-garnet text-avatar-fg-garnet',
};

/** Stable name → tone, so one contact has one colour everywhere. */
export const getAvatarTone = (name: string): Tone => {
  const hash = name.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return TONES[hash % TONES.length] ?? 'amethyst';
};

type Size = 'xs' | 'sm' | 'md';

/** 28, 32 and 40 px; `xs` is the footer's account block (smaller than a chat row's avatar). */
const SIZE_CLASS: Record<Size, string> = { xs: 'size-7', sm: 'size-8', md: 'size-10' };

export const PeerAvatar = ({ name, size = 'md' }: { name: string; size?: Size }) => (
  <Avatar className={SIZE_CLASS[size]} aria-hidden>
    <AvatarFallback className={cn('text-label-m', TONE_CLASS[getAvatarTone(name)])}>
      {name.charAt(0).toUpperCase()}
    </AvatarFallback>
  </Avatar>
);

export const AssistantAvatar = ({ size = 'md' }: { size?: Size }) => (
  <Avatar className={SIZE_CLASS[size]} aria-hidden>
    <AvatarFallback className="bg-surface-container-inverted text-fg-primary-inverted">
      <Sparkles className={size === 'md' ? 'size-5' : 'size-4'} />
    </AvatarFallback>
  </Avatar>
);

/** A spec 0009 group: the `Users` icon on the name's tone, so each group keeps one colour. */
export const GroupAvatar = ({ name, size = 'md' }: { name: string; size?: Size }) => (
  <Avatar className={SIZE_CLASS[size]} aria-hidden>
    <AvatarFallback className={TONE_CLASS[getAvatarTone(name)]}>
      <Users className={size === 'md' ? 'size-5' : 'size-4'} />
    </AvatarFallback>
  </Avatar>
);
