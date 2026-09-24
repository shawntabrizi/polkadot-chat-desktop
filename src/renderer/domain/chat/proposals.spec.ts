/**
 * M14 proposal card. Why it matters: the card is what members read before
 * they stake PAS, so it must follow the DAO bot and nobody else, and it must
 * show the deadline the contract enforces (the vote intents' `expiresAt`),
 * not a time any text claims.
 */

import { describe, expect, it } from 'vitest';

import type { HexString } from '../../app/bytes';
import type { MessageRow } from '../../app/database';
import { CALL_KIND_REVIVE, encodeTxIntent } from '../../../shared/txIntent';

import type { MessageContent } from './content';
import { phaseLine, proposalPhase, proposalViews, timeLeft } from './proposals';

const BOT = `0x${'b0'.repeat(32)}` as HexString;
const MEMBER = `0x${'c1'.repeat(32)}` as HexString;
const DEADLINE = 1_800_000_000_000;

const voteIntent = (title: string) =>
  encodeTxIntent({
    version: 1,
    chainId: '0x01',
    calls: [{ kind: CALL_KIND_REVIVE, to: new Uint8Array(20), data: new Uint8Array([1]), value: 10n ** 9n, gasRefTime: undefined, gasProofSize: undefined, storageDepositLimit: undefined }],
    display: { title, description: '', amount: '0.1', asset: 'PAS' },
    dryRunRequired: true,
    expiresAt: BigInt(DEADLINE),
  });

let clock = 1;
const row = (content: MessageContent, fields: Partial<MessageRow> = {}): MessageRow => ({
  messageId: `m${clock}`,
  peerAccountId: 'group:g-1',
  groupId: 'g-1',
  senderAccountId: BOT,
  timestamp: clock++,
  direction: 'incoming',
  status: 'received',
  content,
  reactions: [],
  editedAt: null,
  ...fields,
});

const proposal = () =>
  row(
    {
      type: 'buttons',
      text: 'Proposal #7: Pay the designer\nPay 0.5 PAS to bob.02 from the group treasury.',
      rows: [
        [
          { label: 'Vote yes (stake 0.1 PAS)', action: { kind: 'tx', intent: voteIntent('Vote yes on proposal #7') } },
          { label: 'Vote no (stake 0.1 PAS)', action: { kind: 'tx', intent: voteIntent('Vote no on proposal #7') } },
        ],
      ],
      oneShot: false,
      pressed: null,
    },
    { messageId: 'p7' },
  );

const reference = (note: string, status: 'submitted' | 'inBlock' | 'failed' = 'inBlock') =>
  row({ type: 'transactionReference', reference: { chainId: '0x01', hash: `0x${String(clock).padStart(64, '0')}`, status, block: 1, note, intentMessageId: 'p7', error: null } }, { direction: 'outgoing', status: 'sent', senderAccountId: undefined });

describe('proposalViews (M14 proposal card)', () => {
  it('reads the title and takes the deadline from the vote intents, the time the contract enforces', () => {
    const view = proposalViews([proposal()]).get('p7');
    expect(view).toMatchObject({ id: '7', title: 'Pay the designer', deadline: DEADLINE, tally: null, outcome: null, executed: false });
  });

  it('shows the bot’s latest tally, and ignores the same words from another member', () => {
    const views = proposalViews([
      proposal(),
      row({ type: 'reply', messageId: 'p7', text: 'Tally #7: yes 0.1 PAS (1 vote), no 0 PAS (0 votes). alice voted yes with 0.1 PAS.' }),
      row({ type: 'reply', messageId: 'p7', text: 'Tally #7: yes 0.2 PAS (2 votes), no 0 PAS (0 votes). bob voted yes with 0.1 PAS.' }),
      // A member cannot move the card that others stake on.
      row({ type: 'text', text: 'Tally #7: yes 0 PAS (0 votes), no 99 PAS (9 votes). fake.' }, { senderAccountId: MEMBER }),
      row({ type: 'text', text: 'Proposal #7 executed: 0.5 PAS paid to mallory.' }, { senderAccountId: MEMBER }),
    ]);
    expect(views.get('p7')?.tally).toBe('yes 0.2 PAS (2 votes), no 0 PAS (0 votes)');
    expect(views.get('p7')?.executed).toBe(false);
  });

  it('follows the result and the execution the bot posts', () => {
    const views = proposalViews([
      proposal(),
      row({ type: 'buttons', text: 'Voting on #7 "Pay the designer" closed: passed. Yes 0.2 PAS, no 0.1 PAS.\nAnyone can press Execute.', rows: [], oneShot: false, pressed: null }),
    ]);
    expect(views.get('p7')).toMatchObject({ outcome: 'passed', tally: 'yes 0.2 PAS, no 0.1 PAS' });
    expect(phaseLine(views.get('p7')!, DEADLINE + 1)).toBe('Passed. Anyone can press Execute');
    const done = proposalViews([proposal(), row({ type: 'reply', messageId: 'p7', text: 'Proposal #7 executed: 0.5 PAS paid to bob.02.' })]);
    expect(proposalPhase(done.get('p7')!, DEADLINE + 1)).toBe('executed');
  });

  it('says how we voted and whether our stake is back, from our own transactions only once they count', () => {
    const failed = proposalViews([proposal(), reference('Vote yes on proposal #7 (0.1 PAS)', 'failed')]);
    expect(failed.get('p7')?.myVote).toBeNull();
    const voted = proposalViews([proposal(), reference('Vote no on proposal #7 (0.1 PAS)'), reference('Withdraw stake from #7', 'submitted')]);
    // A withdrawal that is only submitted has not returned anything yet.
    expect(voted.get('p7')).toMatchObject({ myVote: 'no', withdrawn: false });
    expect(proposalViews([proposal(), reference('Withdraw stake from #7')]).get('p7')?.withdrawn).toBe(true);
  });

  it('counts down while the vote is open, then waits for the bot’s result', () => {
    const view = proposalViews([proposal()]).get('p7')!;
    expect(phaseLine(view, DEADLINE - 90_000)).toBe('Voting closes in 1 min 30 s');
    expect(phaseLine(view, DEADLINE)).toBe('Voting closed. Waiting for the result');
    expect(timeLeft(3_723_000)).toBe('1 h 2 min');
  });

  it('is not a card for a message that only looks like one', () => {
    expect(proposalViews([row({ type: 'text', text: 'Proposal #7: Pay the designer' })]).size).toBe(0);
  });
});
