/**
 * M22a web entry: installs the browser `DesktopApi` on `window.desktop`,
 * opens a saved account with its passphrase, then boots the renderer
 * (src/renderer/main.tsx) unchanged.
 */

import { StrictMode } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import './index.css';


import { createBackendFetch } from './backend';
import { webDatabase } from './database';
import { createWebDesktop } from './desktop';
import { createWebIdentity } from './identity';
import { PassphraseCard } from './ui/PassphraseCard';

/** A passphrase screen above the page (the renderer keeps running under it). */
const askNewPassphrase = (): Promise<string | null> =>
  new Promise(resolve => {
    const host = document.createElement('div');
    document.body.append(host);
    const root: Root = createRoot(host);
    root.render(
      <StrictMode>
        <PassphraseCard
          mode="create"
          onDone={passphrase => {
            root.unmount();
            host.remove();
            resolve(passphrase);
          }}
        />
      </StrictMode>,
    );
  });

const identity = createWebIdentity({
  db: webDatabase(),
  askNewPassphrase,
  backendFetch: createBackendFetch(),
  clipboard: {
    writeText: text => navigator.clipboard.writeText(text),
    readText: () => navigator.clipboard.readText(),
    clear: () => void navigator.clipboard.writeText('').catch(() => undefined),
  },
});
window.desktop = createWebDesktop(identity);

const bootRenderer = () => import('../renderer/main');

/** A saved account opens only with its passphrase; the renderer boots after. */
const unlockThenBoot = async (): Promise<void> => {
  await identity.dropLeftoverBackup();
  const summary = await identity.get();
  if (!summary || !(await identity.locked())) {
    await bootRenderer();
    return;
  }
  const mount = document.getElementById('root');
  if (!mount) throw new Error('missing #root');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await new Promise<void>(resolve => {
    root.render(
      <StrictMode>
        <PassphraseCard
          mode="unlock"
          username={summary.username}
          onUnlock={async passphrase => {
            await identity.unlock(passphrase);
            resolve();
          }}
          onForget={async () => {
            await identity.forget();
            // The chats of the forgotten account go too, as a desktop reset wipes them (renderer/ui/App.tsx).
            const { appDatabase } = await import('../renderer/app/database');
            await appDatabase.delete();
            resolve();
          }}
        />
      </StrictMode>,
    );
  });
  root.unmount();
  host.remove();
  await bootRenderer();
};

void unlockThenBoot().catch((cause: unknown) => console.error('[web] start failed', cause));
