import { describe, expect, it } from 'vitest';

import { commandQuery, commandText, filterCommands, moveSelection } from './commandMenu';

const COMMANDS = [
  { name: 'staking', description: 'Staking basics' },
  { name: 'governance', description: 'How OpenGov works' },
  { name: 'start', description: 'Start over' },
  { name: 'restake', description: 'Restake rewards' },
];

describe('commandQuery (when the menu is open)', () => {
  it('opens on a slash at the start and follows the word typed after it', () => {
    expect(commandQuery('/')).toBe('');
    expect(commandQuery('/sta')).toBe('sta');
  });

  it('stays closed for text that is not a command, and closes once a space is typed', () => {
    expect(commandQuery('')).toBeNull();
    expect(commandQuery('hi /sta')).toBeNull();
    expect(commandQuery(' /sta')).toBeNull();
    expect(commandQuery('/staking ')).toBeNull();
    expect(commandQuery('/staking 10')).toBeNull();
    expect(commandQuery('/sta\nx')).toBeNull();
  });
});

describe('filterCommands', () => {
  it('shows every command for a bare slash, in the bot order', () => {
    expect(filterCommands(COMMANDS, '').map(c => c.name)).toEqual(['staking', 'governance', 'start', 'restake']);
  });

  it('puts names that start with the query first, then names that contain it', () => {
    expect(filterCommands(COMMANDS, 'sta').map(c => c.name)).toEqual(['staking', 'start', 'restake']);
  });

  it('ignores case and returns nothing when no name matches', () => {
    expect(filterCommands(COMMANDS, 'GOV').map(c => c.name)).toEqual(['governance']);
    expect(filterCommands(COMMANDS, 'zzz')).toEqual([]);
  });
});

describe('moveSelection', () => {
  it('moves down and up and wraps at both ends', () => {
    expect(moveSelection(3, 0, 1)).toBe(1);
    expect(moveSelection(3, 2, 1)).toBe(0);
    expect(moveSelection(3, 0, -1)).toBe(2);
    expect(moveSelection(0, 0, 1)).toBe(0);
  });
});

describe('commandText', () => {
  it('inserts the command with its slash and a space for the arguments', () => {
    expect(commandText({ name: 'staking', description: '' })).toBe('/staking ');
    // After the pick the menu is closed: the draft has a space.
    expect(commandQuery(commandText({ name: 'staking', description: '' }))).toBeNull();
  });
});
