/**
 * The primary shortcut modifier: ⌘ on macOS, Ctrl elsewhere (M6 step 4).
 * One helper, so no shortcut checks `metaKey` or `ctrlKey` on its own.
 */

import { userAgent } from './platform';

export const isMac = (agent: string = userAgent()): boolean => /Mac|iPhone|iPad/.test(agent);

type ModifierEvent = { metaKey: boolean; ctrlKey: boolean };

export const isPrimaryModifier = (event: ModifierEvent, mac: boolean = isMac()): boolean => (mac ? event.metaKey : event.ctrlKey);

/** The label of the primary modifier for Settings and tooltips. */
export const primaryModifierLabel = (mac: boolean = isMac()): string => (mac ? '⌘' : 'Ctrl+');
