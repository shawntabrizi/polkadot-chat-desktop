import { AccountId } from '@polkadot-api/substrate-bindings';
import { describe, expect, it } from 'vitest';

import { bytesToHex } from '../app/bytes';
import type { SearchResult } from '../domain/identity/search';

import { assembleSections, botMatches, chatMatches, globalQuery, moveHighlight, snippetOf } from './searchSections';

const ss58 = AccountId(0).dec;
const account = (fill: number) => new Uint8Array(32).fill(fill);
const global = (fill: number, username: string): SearchResult => ({ candidateAccountId: ss58(account(fill)), accountId: account(fill), username });

// Fixture: one contact (pcdpeer.47), the network directory that also returns
// that contact and one stranger, and one message that mentions the query.
const contact = { key: bytesToHex(account(1)), peer: bytesToHex(account(1)), name: 'pcdpeer.47' };
const directory = [global(1, 'pcdpeer.47'), global(2, 'pcdpirate.81')];
const message = { messageId: 'm1', text: 'Try pcdguide for questions' };

describe('assembleSections', () => {
  it('keeps the section order and drops a global hit that is already a contact', () => {
    const sections = assembleSections([contact], [], directory, [message]);
    expect(sections.chats.map(hit => hit.name)).toEqual(['pcdpeer.47']);
    // The same person twice would read as two people; the contact row wins.
    expect(sections.global.map(hit => hit.username)).toEqual(['pcdpirate.81']);
    expect(sections.messages.map(hit => hit.messageId)).toEqual(['m1']);
  });

  it('gives one keyboard order across the sections: chats, then global, then messages', () => {
    const { order } = assembleSections([contact], [], directory, [message]);
    expect(order).toEqual([`chat:${contact.key}`, `global:${directory[1]?.candidateAccountId}`, 'message:m1']);
  });

  it('is empty in every section when nothing matches (the "No results" case)', () => {
    const sections = assembleSections([], [], [], []);
    expect(sections.order).toEqual([]);
    expect([sections.chats, sections.bots, sections.global, sections.messages].every(rows => rows.length === 0)).toBe(true);
  });
});

describe('the Bots section (M10 step 5)', () => {
  const guide = { key: bytesToHex(account(3)), peer: bytesToHex(account(3)), name: 'pcdguide.70' };
  const faucet = { key: 'local:faucet', peer: 'local:faucet', name: 'Faucet' };

  it('sits after Chats and contacts and before Global in the keyboard order', () => {
    const { order } = assembleSections([contact], [guide, faucet], directory, [message]);
    expect(order).toEqual([`chat:${contact.key}`, `bot:${guide.key}`, 'bot:local:faucet', `global:${directory[1]?.candidateAccountId}`, 'message:m1']);
  });

  it('shows a bot once: under Bots, not also under Chats or Global', () => {
    const sections = assembleSections([contact, guide], [guide], [...directory, global(3, 'pcdguide.70')], []);
    expect(sections.chats.map(hit => hit.name)).toEqual(['pcdpeer.47']);
    expect(sections.bots.map(hit => hit.name)).toEqual(['pcdguide.70']);
    expect(sections.global.map(hit => hit.username)).toEqual(['pcdpirate.81']);
  });

  it('finds a bot by its username, its own name or its description', () => {
    const bot = { username: 'Faucet', name: 'Faucet', description: 'Test funds for devnet' };
    expect(botMatches(bot, 'fauc')).toBe(true);
    expect(botMatches(bot, 'TEST FUNDS')).toBe(true);
    expect(botMatches({ username: 'pcdguide.70', name: 'Guide', description: '' }, 'guide')).toBe(true);
    expect(botMatches(bot, 'pirate')).toBe(false);
  });
});

describe('moveHighlight', () => {
  const order = ['chat:a', 'global:b', 'message:c'];

  it('walks down and up across sections and stops at the ends', () => {
    expect(moveHighlight(order, null, 1)).toBe('chat:a');
    expect(moveHighlight(order, 'chat:a', 1)).toBe('global:b');
    expect(moveHighlight(order, 'global:b', 1)).toBe('message:c');
    expect(moveHighlight(order, 'message:c', 1)).toBe('message:c');
    expect(moveHighlight(order, 'message:c', -1)).toBe('global:b');
    expect(moveHighlight(order, 'chat:a', -1)).toBe('chat:a');
  });

  it('starts from the last row on ↑, and from the top when the highlighted row went away', () => {
    expect(moveHighlight(order, null, -1)).toBe('message:c');
    // A global page arrived and the old key is gone: start again.
    expect(moveHighlight(order, 'global:gone', 1)).toBe('chat:a');
    expect(moveHighlight([], null, 1)).toBeNull();
  });
});

describe('query rules', () => {
  it('matches chats by substring ignoring case, and the Assistant by its name', () => {
    expect(chatMatches('pcdpeer.47', ' PEER ')).toBe(true);
    expect(chatMatches('Assistant', 'assist')).toBe(true);
    expect(chatMatches('pcdpeer.47', 'pirate')).toBe(false);
  });

  it('asks the network only from three letters on', () => {
    expect(globalQuery('pc')).toBeNull();
    expect(globalQuery(' PCD ')).toBe('pcd');
  });
});

describe('snippetOf', () => {
  it('cuts one line around the first match and keeps the typed case of the text', () => {
    expect(snippetOf('Try  PCDguide\nfor questions', 'pcd')).toEqual({ before: 'Try ', match: 'PCD', after: 'guide for questions' });
    const long = snippetOf(`${'x'.repeat(40)} needle end`, 'needle');
    expect(long.before.startsWith('…')).toBe(true);
    expect(long.match).toBe('needle');
  });
});
