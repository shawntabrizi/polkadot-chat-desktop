import type { HandshakeMetadata } from './v2/proposal';

/** What the phone shows on its "allow this device?" screen. */
export const HOST_METADATA: HandshakeMetadata = {
  hostName: 'Polkadot Chat Web',
  platformType: 'web',
  platformVersion: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
};
