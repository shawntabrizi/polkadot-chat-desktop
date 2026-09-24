/**
 * M12c step 10. Why: "View on …" must open the page of this very
 * transaction or account on the chain it lives on, and a chain an explorer
 * does not know must give a reason, never a dead link.
 */

import { describe, expect, it } from 'vitest';

import { openableUrl } from './openUrl';
import { EXPLORERS, EXPLORER_CAPTIONS, accountLink, transactionLink } from './explorers';

const ASSET_HUB = '0xd6eec26135305a8ad257a20d003357284c8aa03d0bdb2b357ab0a22371e11ef2';
const DRIP = '0xa7cc3ec67cb09c846a33ec1ccf7a511f631873b9dcc505a993c9fcdc86af6dc5';

describe('explorer links', () => {
  it('Subscan: the extrinsic page on Paseo Asset Hub (checked: block #13622982 holds this drip there)', () => {
    expect(transactionLink('subscan', ASSET_HUB.toUpperCase().replace('0X', '0x'), DRIP, 13622982)).toEqual({
      url: `https://assethub-paseo.subscan.io/extrinsic/${DRIP}`,
    });
  });

  it('Polkadot.js Apps: the block that holds it, on an encoded RPC endpoint; the hash when the block is not known', () => {
    const inBlock = transactionLink('polkadotjs', ASSET_HUB, DRIP, 13622982);
    expect(inBlock).toEqual({ url: 'https://polkadot.js.org/apps/?rpc=wss%3A%2F%2Fasset-hub-paseo-rpc.n.dwellir.com#/explorer/query/13622982' });
    expect(transactionLink('polkadotjs', ASSET_HUB, DRIP, null)).toEqual({
      url: `https://polkadot.js.org/apps/?rpc=wss%3A%2F%2Fasset-hub-paseo-rpc.n.dwellir.com#/explorer/query/${DRIP}`,
    });
  });

  it('opens only through the https check the main process applies', () => {
    for (const link of [transactionLink('subscan', ASSET_HUB, DRIP, 1), transactionLink('polkadotjs', ASSET_HUB, DRIP, 1), accountLink('subscan', ASSET_HUB, '5Grw')]) {
      expect('url' in link && openableUrl(link.url)).toBeTruthy();
    }
  });

  it('gives a reason instead of a link for a chain it does not know, and for an account on Polkadot.js Apps', () => {
    expect(transactionLink('subscan', `0x${'00'.repeat(32)}`, DRIP, 1)).toHaveProperty('unavailable');
    expect(accountLink('polkadotjs', ASSET_HUB, '5Grw')).toHaveProperty('unavailable');
    expect(accountLink('subscan', ASSET_HUB, '5Grw')).toEqual({ url: 'https://assethub-paseo.subscan.io/account/5Grw' });
  });
});

// M12e step 11: Polkadot.js Apps failed to decode Paseo Asset Hub's runtime
// (2026-09-24); the picker warns before a person chooses it, and only there.
describe('explorer captions', () => {
  it('warns on Polkadot.js Apps only', () => {
    expect(EXPLORER_CAPTIONS.polkadotjs).toBe('May not decode newer runtimes');
    expect(EXPLORERS.filter(id => EXPLORER_CAPTIONS[id] !== undefined)).toEqual(['polkadotjs']);
  });
});
