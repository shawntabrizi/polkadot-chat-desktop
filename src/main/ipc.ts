/**
 * Every IPC handler of the main process. Inputs from the renderer are checked
 * here: the renderer loads remote chain data, so it is not trusted with more
 * than it asks for.
 */

import { ipcMain } from 'electron';

import {
  type CreateIdentityRequest,
  type CreateIdentityResponse,
  IPC,
  type IdentitySummary,
  type RendererSecrets,
  type UsernameAvailability,
} from '../shared/desktop-api';
import { isNetworkProfileId } from '../shared/network';

import { deriveIdentityKeys } from './identity/keys';
import { checkAvailability, createIdentity } from './identity/service';
import { loadIdentity, saveIdentity } from './identity/store';

// The mobile app's rule: lowercase letters only, 6 to 29 of them.
const USERNAME = /^[a-z]{6,29}$/;
const DIGITS = /^\d{2}$/;

let creating = false;

const parseCreateRequest = (value: unknown): CreateIdentityRequest => {
  const request = value as Partial<CreateIdentityRequest> | null;
  if (typeof request?.username !== 'string' || !USERNAME.test(request.username)) {
    throw new Error('The username must be 6 to 29 lowercase letters.');
  }
  if (request.digits !== null && (typeof request.digits !== 'string' || !DIGITS.test(request.digits))) {
    throw new Error('The number must be two digits, 00 to 99.');
  }
  if (!isNetworkProfileId(request.profile)) throw new Error('Unknown network.');
  return { username: request.username, digits: request.digits, profile: request.profile };
};

export const registerIpc = (): void => {
  ipcMain.handle(IPC.identityGet, (): IdentitySummary | null => {
    const identity = loadIdentity();
    return identity ? { username: identity.username, accountHex: identity.accountHex, profile: identity.profile } : null;
  });

  ipcMain.handle(IPC.identityAvailable, (_event, username: unknown, profile: unknown): Promise<UsernameAvailability> => {
    if (typeof username !== 'string' || !USERNAME.test(username)) throw new Error('The username must be 6 to 29 lowercase letters.');
    if (!isNetworkProfileId(profile)) throw new Error('Unknown network.');
    return checkAvailability(username, profile);
  });

  ipcMain.handle(IPC.identityCreate, async (event, value: unknown): Promise<CreateIdentityResponse> => {
    const request = parseCreateRequest(value);
    if (creating) throw new Error('A sign-up is already running.');
    creating = true;
    try {
      return await createIdentity({
        ...request,
        store: { save: saveIdentity, load: loadIdentity },
        onProgress: line => {
          if (!event.sender.isDestroyed()) event.sender.send(IPC.identityProgress, line);
        },
      });
    } finally {
      creating = false;
    }
  });

  // The only channel that carries secrets. It exists so the renderer can seed
  // its Dexie device and identity rows (single device: the identity wallet is
  // the statement account). It sends derived keys, never the mnemonic.
  ipcMain.handle(IPC.identitySecretsForRenderer, (): RendererSecrets => {
    const identity = loadIdentity();
    if (!identity) throw new Error('This computer has no identity yet.');
    const keys = deriveIdentityKeys(identity.mnemonic);
    return { statementSeed: keys.walletSecret64, chatPrivateKey: keys.chatPrivateKey };
  });
};
