/**
 * Chat request rows. A request is written once when it is sent or first
 * seen on the discovery topics, then only its status moves. The row doubles as
 * the persistent dedup set: a request id that exists is never re-added, so a
 * stale statement on chain cannot resurface after a reload.
 */

import type { HexString } from '../../app/bytes';
import { type RequestDirection, type RequestRow, type RequestStatus, db } from '../../app/database';

/** Newest first. */
export const listRequests = async (): Promise<RequestRow[]> =>
  (await db.requests.toArray()).sort((a, b) => b.createdAt - a.createdAt);

export const getRequest = (requestId: string): Promise<RequestRow | undefined> => db.requests.get(requestId);

/** Insert only: an existing id is left untouched and `false` is returned. */
export const addRequest = async (row: RequestRow): Promise<boolean> => {
  try {
    await db.requests.add(row);
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === 'ConstraintError') return false;
    throw error;
  }
};

export const setRequestStatus = (requestId: string, status: RequestStatus): Promise<number> =>
  db.requests.update(requestId, { status });

export const findPendingRequest = (peerAccountId: HexString, direction: RequestDirection): Promise<RequestRow | undefined> =>
  db.requests
    .where('peerAccountId')
    .equals(peerAccountId)
    .filter(row => row.direction === direction && row.status === 'pending')
    .first();
