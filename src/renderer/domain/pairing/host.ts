import { isWeb, userAgent } from '../../app/platform';

import type { HandshakeMetadata } from './v2/proposal';

/** What the phone shows on its "allow this device?" screen and in Linked devices (free text there). */
export const hostMetadata = (): HandshakeMetadata => ({
  hostName: isWeb() ? 'Polkadot Chat Web' : 'Polkadot Chat Desktop',
  platformType: isWeb() ? 'web' : 'desktop',
  platformVersion: userAgent(),
});
