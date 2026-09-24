/**
 * Settings › Diagnostics totals (M12e step 12). The renderer's submission
 * meter lives as long as one page load; these totals live as long as the app,
 * so a window reload or a theme switch does not zero them. The renderer sends
 * what it counted since its last report; the input is checked here.
 */

import type { DiagnosticsCounts } from '../shared/desktop-api';

const KEYS: readonly (keyof DiagnosticsCounts)[] = ['submissions', 'acknowledgements', 'messages'];
/** Far above anything one report can carry; a larger number is not a count. */
const MAX_STEP = 1_000_000;

const isStep = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_STEP;

/** A well-formed report, or null. */
export const parseDelta = (value: unknown): DiagnosticsCounts | null => {
  if (value == null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (!KEYS.every(key => isStep(record[key]))) return null;
  return { submissions: record.submissions as number, acknowledgements: record.acknowledgements as number, messages: record.messages as number };
};

export const createDiagnostics = () => {
  let totals: DiagnosticsCounts = { submissions: 0, acknowledgements: 0, messages: 0 };
  // Spec 0012: Bulletin transactions (feeless stores and devnet grants) are
  // counted apart; they are chain transactions, not Statement Store statements.
  let bulletinTransactions = 0;
  return {
    /** Adds a report; the new totals, or null when the report was refused or empty. */
    add: (value: unknown): DiagnosticsCounts | null => {
      const delta = parseDelta(value);
      if (!delta || KEYS.every(key => delta[key] === 0)) return null;
      totals = {
        submissions: totals.submissions + delta.submissions,
        acknowledgements: totals.acknowledgements + delta.acknowledgements,
        messages: totals.messages + delta.messages,
      };
      return { ...totals, bulletinTransactions };
    },
    /** One Bulletin transaction was broadcast (main submits them itself). */
    bulletinTransaction: (): DiagnosticsCounts => {
      bulletinTransactions += 1;
      return { ...totals, bulletinTransactions };
    },
    snapshot: (): DiagnosticsCounts => ({ ...totals, bulletinTransactions }),
  };
};
