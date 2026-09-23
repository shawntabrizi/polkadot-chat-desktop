import { beforeEach, describe, expect, it } from 'vitest';

import { appDatabase, db } from '../../app/database';

import { draftPreview, getDraft, saveDraft } from './drafts';

beforeEach(async () => {
  await appDatabase.delete({ disableAutoOpen: false });
});

describe('drafts', () => {
  // The text a user left in a room must be there when they come back.
  it('keeps one draft per room and deletes it when emptied', async () => {
    await saveDraft('0xaa', 'half a thought', 10);
    await saveDraft('local:assistant', 'ask later', 11);
    expect(await getDraft('0xaa')).toBe('half a thought');
    await saveDraft('0xaa', '   ', 12);
    expect(await db.drafts.get('0xaa')).toBeUndefined();
    expect(await getDraft('local:assistant')).toBe('ask later');
  });

  // A draft older than the room's last message is stale for the preview (mobile rule).
  it('shows "Draft: …" only while no newer message exists', () => {
    const draft = { peerId: '0xaa' as const, text: 'see  you\nsoon', updatedAt: 100 };
    expect(draftPreview(draft, 50)).toBe('Draft: see you soon');
    expect(draftPreview(draft, undefined)).toBe('Draft: see you soon');
    expect(draftPreview(draft, 150)).toBeNull();
    expect(draftPreview(undefined, 50)).toBeNull();
  });
});
