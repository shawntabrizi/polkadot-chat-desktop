/**
 * M22a: `DesktopApi` in a browser (docs/web.md lists every member as ported,
 * proxied or unavailable). src/web/main.tsx installs it on `window.desktop`
 * before the renderer boots, so the renderer runs unchanged. Members the web
 * cannot offer reject with `NOT_ON_WEB`, or are no-ops for fire-and-forget
 * calls and listeners, so the UI shows its own error or "not on web" state.
 */

import {
  type DesktopAgentApi,
  type DesktopApi,
  type DesktopAppApi,
  type DesktopAssistantApi,
  type DesktopDiagnosticsApi,
  type DesktopFilesApi,
  type DesktopProfilesApi,
  type NotifyOpen,
  NOT_ON_WEB,
} from '../shared/desktop-api';
import { BUILT_IN_DEMO_BOTS } from '../shared/demoBots';
import { safeFileName } from '../shared/fileName';
import { isGroupInviteUrl, openableUrl } from '../shared/openUrl';

import { createDiagnostics } from '../main/diagnostics';

import { createWebChain } from './chain';
import type { WebIdentityApi } from './identity';

const notOnWeb = (): Promise<never> => Promise.reject(new Error(NOT_ON_WEB));
const noListener = (): (() => void) => () => undefined;

const listeners = <T>() => {
  const set = new Set<(value: T) => void>();
  return {
    emit: (value: T) => set.forEach(listener => listener(value)),
    on: (listener: (value: T) => void) => {
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
  };
};

/** Types a browser shows inline without running script (no HTML, no SVG). Anything else downloads. */
const INLINE_MIME = /^(?:image\/(?:png|jpeg|gif|webp|avif)|video\/(?:mp4|webm|ogg)|audio\/[\w.+-]+|application\/pdf|text\/plain)$/;

const download = (bytes: Uint8Array, name: string | null, mime: string): void => {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = safeFileName(name, mime);
  link.rel = 'noopener';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

const createFiles = (): DesktopFilesApi => ({
  open: async (bytes, name, mime) => {
    if (!INLINE_MIME.test(mime)) return download(bytes, name, mime);
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  save: async (bytes, name, mime) => {
    download(bytes, name, mime);
    return true;
  },
});

const createApp = (): DesktopAppApi => {
  const notifyOpen = listeners<NotifyOpen>();
  const openLink = listeners<string>();
  return {
    setBadge: count => {
      const badge = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
      const n = Number.isFinite(count) && count > 0 ? Math.min(Math.floor(count), 9999) : 0;
      void (n > 0 ? badge.setAppBadge?.(n) : badge.clearAppBadge?.())?.catch(() => undefined);
    },
    // The Notification API, when the person allowed it; nothing otherwise (no OS sound, no dock).
    notify: request => {
      if (typeof Notification === 'undefined') return;
      const show = () => {
        const notification = new Notification(request.title.slice(0, 300), { body: request.body.slice(0, 300), silent: !request.sound });
        notification.onclick = () => {
          window.focus();
          notifyOpen.emit({ peerId: request.peerId, ...(request.requestId ? { requestId: request.requestId } : {}) });
          notification.close();
        };
      };
      if (Notification.permission === 'granted') show();
      else if (Notification.permission === 'default') void Notification.requestPermission().then(answer => answer === 'granted' && show());
    },
    onNotifyOpen: notifyOpen.on,
    // No app menu on the web.
    onMenuSettings: noListener,
    openUrl: async url => {
      const target = openableUrl(url);
      if (!target) throw new Error('Only https and polkadotapp links can be opened.');
      if (isGroupInviteUrl(target.href)) return openLink.emit(target.href);
      window.open(target.href, '_blank', 'noopener,noreferrer');
    },
    onOpenLink: openLink.on,
    // No OS link handler: nothing launches the web page with an invite link.
    takeOpenLink: async () => null,
  };
};

const createDiagnosticsApi = (): { api: DesktopDiagnosticsApi; bulletinTransaction: () => void } => {
  const totals = createDiagnostics();
  const changed = listeners<ReturnType<typeof totals.snapshot>>();
  return {
    api: {
      add: delta => {
        const next = totals.add(delta);
        if (next) changed.emit(next);
      },
      get: async () => totals.snapshot(),
      onChanged: changed.on,
    },
    bulletinTransaction: () => changed.emit(totals.bulletinTransaction()),
  };
};

const assistant: DesktopAssistantApi = {
  getSettings: notOnWeb,
  setSettings: notOnWeb,
  send: notOnWeb,
  cancel: notOnWeb,
  onDelta: noListener,
  onDone: noListener,
  onError: noListener,
  onActivity: noListener,
  detect: notOnWeb,
};

const agent: DesktopAgentApi = {
  status: notOnWeb,
  claim: notOnWeb,
  update: notOnWeb,
  setContacts: () => undefined,
  kill: notOnWeb,
  onChanged: noListener,
  onProgress: noListener,
};

/** One browser, one identity: the state lists it as the only, current profile. */
const createProfiles = (identity: WebIdentityApi): DesktopProfilesApi => ({
  state: async () => {
    const summary = await identity.get();
    return {
      current: 'web',
      profiles: [
        {
          name: 'web',
          label: summary?.username ?? 'This browser',
          username: summary?.username ?? null,
          network: summary?.profile ?? null,
          running: true,
          current: true,
          isDefault: true,
        },
      ],
      defaultProfile: 'web',
    };
  },
  open: notOnWeb,
  openInNewWindow: notOnWeb,
  add: notOnWeb,
  rename: notOnWeb,
  remove: notOnWeb,
  setDefault: notOnWeb,
  openPicker: notOnWeb,
  restore: notOnWeb,
});

export const createWebDesktop = (identity: WebIdentityApi): DesktopApi => {
  const diagnostics = createDiagnosticsApi();
  const { chain, bulletin, hop } = createWebChain({
    identity: () => identity.get(),
    mnemonic: identity.mnemonic,
    onBulletinTransaction: diagnostics.bulletinTransaction,
  });
  return {
    platform: 'web',
    version: 'web',
    osVersion: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
    identity,
    chain,
    assistant,
    app: createApp(),
    diagnostics: diagnostics.api,
    demo: { bots: async profile => [...BUILT_IN_DEMO_BOTS[profile]] },
    agent,
    bulletin,
    hop,
    files: createFiles(),
    storage: { atRestKey: identity.atRestKey },
    profiles: createProfiles(identity),
  };
};
