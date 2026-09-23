import { beforeEach, describe, expect, it } from 'vitest';

import { appDatabase, type RequestRow } from '../../app/database';

import { addRequest, findPendingRequest, getRequest, listRequests, setRequestStatus } from './repository';

const row = (requestId: string, overrides: Partial<RequestRow> = {}): RequestRow => ({
  requestId,
  peerAccountId: '0xaa',
  peerUsername: 'alice',
  peerChatPublicKey: new Uint8Array(32),
  direction: 'incoming',
  status: 'pending',
  welcomeMessage: null,
  timestamp: 1,
  senderDevice: null,
  createdAt: 1,
  ...overrides,
});

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});

describe('requests repository', () => {
  // The row is the persistent dedup set: a request the chain re-delivers
  // after a reload must not overwrite a status the user already chose.
  it('adds a request once and reports the duplicate', async () => {
    expect(await addRequest(row('r1'))).toBe(true);
    await setRequestStatus('r1', 'declined');
    expect(await addRequest(row('r1'))).toBe(false);
    expect((await getRequest('r1'))?.status).toBe('declined');
  });

  it('finds the pending request per peer and direction', async () => {
    await addRequest(row('r1', { direction: 'outgoing' }));
    await addRequest(row('r2', { direction: 'incoming', status: 'accepted' }));
    expect((await findPendingRequest('0xaa', 'outgoing'))?.requestId).toBe('r1');
    expect(await findPendingRequest('0xaa', 'incoming')).toBeUndefined();
  });

  it('lists newest first', async () => {
    await addRequest(row('old', { createdAt: 1 }));
    await addRequest(row('new', { createdAt: 2 }));
    expect((await listRequests()).map(r => r.requestId)).toEqual(['new', 'old']);
  });
});
