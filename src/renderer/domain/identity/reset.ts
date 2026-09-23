/**
 * "Reset identity" (Settings): the main process deletes `identity.json`, then
 * the renderer deletes its whole database (keys, contacts, chats) and reloads
 * into sign-up. The main process goes first: if it refuses (a sign-up is
 * running, a disk error), nothing here is touched, and the app still opens
 * the identity it has.
 */

import type { DesktopIdentityApi } from '../../../shared/desktop-api';

export type ResetDeps = {
  identityApi: Pick<DesktopIdentityApi, 'reset'>;
  database: { delete: () => Promise<void> };
  reload: () => void;
};

export const resetIdentity = async ({ identityApi, database, reload }: ResetDeps): Promise<void> => {
  await identityApi.reset();
  await database.delete();
  reload();
};
