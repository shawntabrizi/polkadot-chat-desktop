// Known answers from polkadot-desktop src/domains/chat/p2p/requests/service.spec.ts,
// which are the iOS vectors (ChatRequest+PaginationTopic.swift, ChatRequestFactory.swift).

import { describe, expect, it } from 'vitest';

import { bytesToHex } from '../../app/bytes';

import { computeAllPeerTopic, computeChannelTopic, computePaginationTopic, getCurrentDay } from './topics';

const EPOCH_SECS = 1_763_164_800;
const FIXED_ACCOUNT_ID = new Uint8Array(32).fill(0xcd);
const FIXED_SESSION_ID = new Uint8Array(32).fill(0x11);
const FIXED_SHARED_SECRET = new Uint8Array(32).fill(0x22);

describe('getCurrentDay', () => {
  it('counts days from the shared epoch', () => {
    expect(getCurrentDay(EPOCH_SECS * 1000)?.day).toBe(0n);
    expect(getCurrentDay((EPOCH_SECS + 86_399) * 1000)?.day).toBe(0n);
    expect(getCurrentDay((EPOCH_SECS + 86_400) * 1000)?.day).toBe(1n);
  });

  it('is null before the epoch: no day topic exists for that time', () => {
    expect(getCurrentDay((EPOCH_SECS - 1) * 1000)).toBeNull();
  });

  it('reports the seconds until the next day', () => {
    expect(getCurrentDay(EPOCH_SECS * 1000)?.remainedTillNext).toBe(86_400);
    expect(getCurrentDay((EPOCH_SECS + 3_600) * 1000)?.remainedTillNext).toBe(82_800);
  });
});

// A topic that differs from the phone's by one byte is a request nobody reads.
describe('discovery topics match the iOS vectors', () => {
  it('allPeerStatementsTopic', () => {
    expect(bytesToHex(computeAllPeerTopic(FIXED_ACCOUNT_ID))).toBe(
      '0x28b70dc78c624968822216bee923a5048583f84909a51bba05851649a8deda38',
    );
  });

  it('paginationTopic for days 0, 1 and 100', () => {
    expect(bytesToHex(computePaginationTopic(FIXED_ACCOUNT_ID, 0n))).toBe(
      '0xe8a7a80a0824f569d5757207f29de4fd7dde9b03ba7aa9cf214c1ec7eb34e9df',
    );
    expect(bytesToHex(computePaginationTopic(FIXED_ACCOUNT_ID, 1n))).toBe(
      '0x5ffebc38db45ecca594cdf72255134bfa58fb5169728c228ec7035593152ff8a',
    );
    expect(bytesToHex(computePaginationTopic(FIXED_ACCOUNT_ID, 100n))).toBe(
      '0x124408ff61e31cd8adbcdcc6ca5a23b14d3d446b4529d28c5ca5b8c021e980b7',
    );
  });

  it('channelTopic', () => {
    expect(bytesToHex(computeChannelTopic(FIXED_SESSION_ID, FIXED_SHARED_SECRET))).toBe(
      '0x655629fba2e8b947fa439627b817a7eaed233ed5a0e37b54fd49699ec8243004',
    );
  });

  it('keeps recipients apart', () => {
    expect(computeAllPeerTopic(new Uint8Array(32).fill(1))).not.toEqual(computeAllPeerTopic(new Uint8Array(32).fill(2)));
    expect(computeChannelTopic(FIXED_SESSION_ID, new Uint8Array(32).fill(1))).not.toEqual(
      computeChannelTopic(FIXED_SESSION_ID, new Uint8Array(32).fill(2)),
    );
  });
});
