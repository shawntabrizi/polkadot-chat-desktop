// Switch and Checkbox on the radix-ui primitives, in the design system's
// tokens. Not in components/ui/ (that folder is stock shadcn and read-only
// here); the geometry follows shadcn's switch.tsx and checkbox.tsx.

import { Check } from 'lucide-react';
import { Checkbox as CheckboxPrimitive, Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

export const Switch = ({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) => (
  <SwitchPrimitive.Root
    className={cn(
      'peer inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors',
      'bg-action-tertiary hover:bg-action-tertiary-hover data-[state=checked]:bg-action-primary data-[state=checked]:hover:bg-action-primary-hover',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block size-5 rounded-full bg-surface-container shadow-1 transition-transform data-[state=checked]:translate-x-4" />
  </SwitchPrimitive.Root>
);

export const Checkbox = ({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) => (
  <CheckboxPrimitive.Root
    className={cn(
      'peer flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-small border border-stroke-secondary transition-colors',
      'hover:bg-selection-container-hover data-[state=checked]:border-transparent data-[state=checked]:bg-action-primary data-[state=checked]:text-fg-primary-inverted',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator>
      <Check className="size-3.5" aria-hidden />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
);
