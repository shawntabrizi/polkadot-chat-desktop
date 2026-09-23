/**
 * Stands in for the `next-themes` package, which shadcn's stock Sonner
 * component imports for its theme. This app themes by the `data-theme`
 * attribute (theme/theme.ts), so the bare specifier is aliased here (tsconfig
 * `paths`, vite `resolve.alias`) instead of editing components/ui/sonner.tsx
 * or adding a dependency. Per .refs/polkadot-design-system references/shadcn.md
 * "Sonner": dark exactly when the resolved theme is one of DARK_THEMES.
 */

import { useSyncExternalStore } from 'react';

import { DARK_THEMES, resolveTheme } from '../theme/theme';

type Tone = 'light' | 'dark';

const current = (): Tone => (DARK_THEMES.includes(resolveTheme()) ? 'dark' : 'light');

// Re-read on a theme switch (the attribute) and on an OS flip (system choice).
const subscribe = (onChange: () => void): (() => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', onChange);
  };
};

export const useTheme = (): { theme: Tone } => ({ theme: useSyncExternalStore(subscribe, current, () => 'light') });
