// Ported from polkadot-desktop src/domains/chat/p2p/peerRoster.ts.

/**
 * The peer's device list, as a live handle the session reads through.
 *
 * `createMultiDeviceSession` takes a `PeerRoster` rather than a snapshot: the
 * outgoing envelope is built against `current()` on every submit, and the
 * incoming topic set is re-derived when `subscribe` fires. That is what lets a
 * `deviceAdded` / `deviceRemoved` apply to a running session instead of
 * tearing it down and stranding its delivery waiters.
 */

import type { DeviceTarget, PeerRoster } from '@novasamatech/statement-store';

import { bytesEqual } from '../../app/bytes';

export type PeerRosterHandle = PeerRoster & {
  /** Publish a new device list to the session. Ignored when nothing changed. */
  set: (devices: DeviceTarget[]) => void;
};

const sameRoster = (a: DeviceTarget[], b: DeviceTarget[]): boolean =>
  a.length === b.length &&
  a.every((device, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      bytesEqual(device.statementAccountId, other.statementAccountId) &&
      bytesEqual(device.encryptionPublicKey, other.encryptionPublicKey)
    );
  });

export const createPeerRoster = (initial: DeviceTarget[]): PeerRosterHandle => {
  let devices = initial;
  const listeners = new Set<(devices: DeviceTarget[]) => void>();

  return {
    current: () => devices,
    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    set(next) {
      // A no-op update would re-open the store subscription for nothing.
      if (sameRoster(devices, next)) return;
      devices = next;
      for (const listener of listeners) listener(next);
    },
  };
};
