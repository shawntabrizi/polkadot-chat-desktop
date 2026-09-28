import { beforeEach, describe, expect, it } from 'vitest';

import { BUILT_IN_DEMO_BOTS } from '../shared/demoBots';
import { NOT_ON_WEB } from '../shared/desktop-api';

import { webDatabase } from './database';
import { createWebDesktop } from './desktop';
import { createWebIdentity } from './identity';
import { readMetadata, writeMetadata } from './metadataCache';

// M22a: members the web cannot offer must fail with the one "not on web"
// text the UI shows (docs/web.md), and the ported ones must answer.

const desktop = () =>
  createWebDesktop(
    createWebIdentity({
      db: webDatabase(),
      askNewPassphrase: async () => null,
      backendFetch: fetch,
      clipboard: { writeText: async () => undefined, readText: async () => '', clear: () => undefined },
    }),
  );

beforeEach(async () => {
  await webDatabase().records.clear();
});

describe('web DesktopApi', () => {
  it('says it is the web build', () => {
    expect(desktop().platform).toBe('web');
  });

  it('rejects the desktop-only members with NOT_ON_WEB', async () => {
    const api = desktop();
    const calls: Promise<unknown>[] = [
      api.assistant.getSettings(),
      api.assistant.send({ conversationId: 'c', messages: [{ role: 'user', content: 'hi' }] }),
      api.assistant.detect(),
      api.agent.status(),
      api.agent.claim({ username: 'agentname', digits: null, profile: 'devnet' }),
      api.profiles.add(),
      api.profiles.open('x'),
      api.profiles.openInNewWindow('x'),
      api.profiles.restore('a b c', 'devnet'),
    ];
    for (const call of calls) await expect(call).rejects.toThrow(NOT_ON_WEB);
  });

  it('keeps fire-and-forget and listener members harmless', () => {
    const api = desktop();
    expect(() => api.agent.setContacts([])).not.toThrow();
    expect(typeof api.app.onMenuSettings(() => undefined)).toBe('function');
    expect(typeof api.agent.onChanged(() => undefined)).toBe('function');
  });

  it('lists this browser as the one current profile, so the renderer boots the app, not the picker', async () => {
    const state = await desktop().profiles.state();
    expect(state.current).not.toBeNull();
    expect(state.profiles).toHaveLength(1);
  });

  it('serves the built-in demo bots and counts diagnostics', async () => {
    const api = desktop();
    expect(await api.demo.bots('devnet')).toEqual([...BUILT_IN_DEMO_BOTS.devnet]);
    api.diagnostics.add({ submissions: 2, acknowledgements: 1, messages: 1 });
    expect(await api.diagnostics.get()).toMatchObject({ submissions: 2, acknowledgements: 1, messages: 1 });
  });

  it('opens only https, polkadotapp and invite links', async () => {
    await expect(desktop().app.openUrl('javascript:alert(1)')).rejects.toThrow('Only https and polkadotapp');
  });

  it('refuses the faucet on any chain but devnet Asset Hub before it opens anything', async () => {
    await expect(desktop().chain.faucetDrip(`0x${'00'.repeat(32)}`)).rejects.toThrow('devnet Asset Hub only');
  });

  it('caches runtime metadata by code hash in IndexedDB', async () => {
    const hash = `0x${'cd'.repeat(32)}`;
    writeMetadata(hash, Uint8Array.of(1, 2, 3));
    await expect.poll(() => readMetadata(hash)).toEqual(Uint8Array.of(1, 2, 3));
    expect(await readMetadata('not-a-hash')).toBeNull();
  });
});
