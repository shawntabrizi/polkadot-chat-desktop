// The Polkadot symbol, copied from .refs/polkadot-design-system/assets/logo/
// into public/ (SKILL.md §9). Both files render; index.css shows the one that
// fits the theme, keyed on the theme's own `dark` variant, the one the skill's
// class toggle uses (M5 step 1d keeps that variant out of app classes).

import { cn } from '@/lib/cn';

// Relative to index.html: the packaged app loads it from file://.
const base = import.meta.env.BASE_URL;

export const Logo = ({ className }: { className?: string }) => (
  <div className={cn('w-auto', className)}>
    <img src={`${base}logo-symbol_dark.svg`} alt="Polkadot" className="logo-on-light h-full w-auto" />
    <img src={`${base}logo-symbol_light.svg`} alt="Polkadot" className="logo-on-dark h-full w-auto" />
  </div>
);
