/**
 * M14 DAO chat: a proposal card from the DAO bot's own messages. No new wire
 * kind (M14 "Do not"): the card is read from what the bot already posts in the
 * group, as pca's `bot-core/lib/dao.mjs` writes it:
 *
 *   proposal  a buttons message whose first line is `Proposal #<id>: <title>`,
 *             with the vote `tx` buttons (their `expiresAt` is the deadline)
 *   tally     `Tally #<id>: yes … (n votes), no … (n votes). …` (a reply)
 *   result    `Voting on #<id> "…" closed: passed|rejected. Yes …, no ….`
 *   executed  `Proposal #<id> executed: …`
 *
 * Only lines from the proposal's own sender count: another member can post
 * the same words, and must not move the card. Our own transactions (the
 * reference rows) say how we voted and whether our stake came back.
 */

import type { HexString } from '../../app/bytes';
import type { MessageRow } from '../../app/database';
import { decodeTxIntent } from '../../../shared/txIntent';

export type ProposalView = {
  id: string;
  title: string;
  /** Unix ms from the vote buttons' `expiresAt`; null when the message has none. */
  deadline: number | null;
  /** "yes 0.2 PAS (2 votes), no 0.1 PAS (1 vote)": the bot's latest count. */
  tally: string | null;
  outcome: 'passed' | 'rejected' | null;
  executed: boolean;
  myVote: 'yes' | 'no' | null;
  /** Our "Withdraw stake" transaction is in a block. */
  withdrawn: boolean;
};

const HEAD = /^Proposal #(\d+): (.+)$/;
const TALLY = /^Tally #(\d+): (.+?)\.(?:\s|$)/;
const RESULT = /^Voting on #(\d+) .*? closed: (passed|rejected)\. Yes (.+?), no (.+?)\.(?:\s|$)/;
const EXECUTED = /^Proposal #(\d+) executed\b/;
const MY_VOTE = /^Vote (yes|no) on proposal #(\d+)\b/;
const MY_WITHDRAW = /^Withdraw stake from #(\d+)\b/;

const textOf = (row: MessageRow): string | null => {
  const { content } = row;
  if (content.type === 'text' || content.type === 'reply' || content.type === 'buttons') return content.text;
  if (content.type === 'richText') return content.text;
  return null;
};

/** The proposal a bot's buttons message opens, or null for any other message. */
export const proposalHead = (row: MessageRow): { id: string; title: string; deadline: number | null } | null => {
  if (row.direction !== 'incoming' || row.content.type !== 'buttons') return null;
  const head = HEAD.exec(row.content.text.split('\n')[0]?.trim() ?? '');
  if (!head) return null;
  let deadline: number | null = null;
  for (const button of row.content.rows.flat()) {
    if (button.action.kind !== 'tx') continue;
    const intent = decodeTxIntent(button.action.intent);
    if (intent) deadline = Math.max(deadline ?? 0, Number(intent.expiresAt));
  }
  return { id: head[1]!, title: head[2]!, deadline };
};

/** Every proposal card in a room's rows, by the proposal message's id. */
export const proposalViews = (rows: readonly MessageRow[]): Map<string, ProposalView> => {
  const views = new Map<string, ProposalView>();
  // sender:id -> the card's message id (a bot's numbers are its own).
  const byKey = new Map<string, string>();
  const keyOf = (sender: HexString | undefined, id: string) => `${sender ?? ''}:${id}`;
  for (const row of rows) {
    const head = proposalHead(row);
    if (!head) continue;
    views.set(row.messageId, { ...head, tally: null, outcome: null, executed: false, myVote: null, withdrawn: false });
    byKey.set(keyOf(row.senderAccountId, head.id), row.messageId);
  }
  if (views.size === 0) return views;
  for (const row of [...rows].sort((a, b) => a.timestamp - b.timestamp)) {
    if (row.direction === 'outgoing' && row.content.type === 'transactionReference') {
      const { note, status } = row.content.reference;
      if (status === 'failed') continue;
      const vote = MY_VOTE.exec(note);
      const back = MY_WITHDRAW.exec(note);
      // Our own references name the proposal number only: the one card with that number wins.
      const card = (id: string) => [...views.values()].find(view => view.id === id);
      if (vote) {
        const view = card(vote[2]!);
        if (view) view.myVote = vote[1] as 'yes' | 'no';
      }
      if (back && status !== 'submitted') {
        const view = card(back[1]!);
        if (view) view.withdrawn = true;
      }
      continue;
    }
    if (row.direction !== 'incoming') continue;
    const text = textOf(row)?.trim();
    if (!text) continue;
    const at = (id: string) => views.get(byKey.get(keyOf(row.senderAccountId, id)) ?? '');
    const tally = TALLY.exec(text);
    if (tally) {
      const view = at(tally[1]!);
      if (view) view.tally = tally[2]!;
      continue;
    }
    const result = RESULT.exec(text);
    if (result) {
      const view = at(result[1]!);
      if (view) {
        view.outcome = result[2] as 'passed' | 'rejected';
        view.tally = `yes ${result[3]}, no ${result[4]}`;
      }
      continue;
    }
    const executed = EXECUTED.exec(text);
    if (executed) {
      const view = at(executed[1]!);
      if (view) view.executed = true;
    }
  }
  return views;
};

/** "1 h 5 min", "4 min 10 s", "12 s": what is left of the vote. */
export const timeLeft = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  if (s >= 60) return `${Math.floor(s / 60)} min ${s % 60} s`;
  return `${s} s`;
};

export type ProposalPhase = 'open' | 'counting' | 'passed' | 'rejected' | 'executed';

export const proposalPhase = (view: ProposalView, now: number): ProposalPhase => {
  if (view.executed) return 'executed';
  if (view.outcome) return view.outcome;
  return view.deadline !== null && now >= view.deadline ? 'counting' : 'open';
};

/** The card's state line: the countdown while the vote is open, then the result. */
export const phaseLine = (view: ProposalView, now: number): string => {
  switch (proposalPhase(view, now)) {
    case 'open':
      return view.deadline === null ? 'Voting is open' : `Voting closes in ${timeLeft(view.deadline - now)}`;
    case 'counting':
      return 'Voting closed. Waiting for the result';
    case 'passed':
      return 'Passed. Anyone can press Execute';
    case 'rejected':
      return 'Rejected. Nothing is paid';
    case 'executed':
      return 'Executed';
  }
};

/** "You voted yes · your stake is back": what this account did, if anything. */
export const mineLine = (view: ProposalView): string | null => {
  const parts = [view.myVote ? `You voted ${view.myVote}` : null, view.withdrawn ? 'your stake is back' : null].filter(Boolean);
  if (parts.length === 0) return null;
  const line = parts.join(' · ');
  return line[0]!.toUpperCase() + line.slice(1);
};
