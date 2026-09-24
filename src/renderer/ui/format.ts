import { AccountId } from '@polkadot-api/substrate-bindings';

const ss58 = AccountId(0);

export const toSs58 = (bytes: Uint8Array): string => ss58.dec(bytes);

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

export const shortAccount = (ss58Address: string): string => `${ss58Address.slice(0, 6)}…${ss58Address.slice(-6)}`;

export const formatTime = (timestamp: number): string => new Date(timestamp).toLocaleString();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();

const isYesterday = (date: Date, now: Date): boolean => {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return sameDay(date, yesterday);
};

/** Chat list time, as the phone apps show it: "Now", "5m", "3h", "Yesterday", else the date. */
export const formatListTime = (timestamp: number, now: number = Date.now()): string => {
  const age = now - timestamp;
  const date = new Date(timestamp);
  const today = new Date(now);
  if (age < MINUTE) return 'Now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (sameDay(date, today)) return `${Math.floor(age / HOUR)}h`;
  if (isYesterday(date, today)) return 'Yesterday';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
};

/** How long ago, in whole units (M12e pending requests): "just now", "5 min ago", "3 h ago", "3 d ago". */
export const formatAgo = (timestamp: number, now: number = Date.now()): string => {
  const age = Math.max(0, now - timestamp);
  if (age < MINUTE) return 'just now';
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min ago`;
  if (age < 24 * HOUR) return `${Math.floor(age / HOUR)} h ago`;
  return `${Math.floor(age / (24 * HOUR))} d ago`;
};

/** Date separator in a room: "Today", "Yesterday", else the full date. */
export const formatDay = (timestamp: number, now: number = Date.now()): string => {
  const date = new Date(timestamp);
  const today = new Date(now);
  if (sameDay(date, today)) return 'Today';
  if (isYesterday(date, today)) return 'Yesterday';
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
};

/** Time of one message, e.g. "14:05". */
export const formatClock = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** An error's own words. The IPC layer wraps them as "Error invoking remote method '…': Error: <message>". */
export const plainError = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || fallback : fallback;
