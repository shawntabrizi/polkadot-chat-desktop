/**
 * M22a: the web build. The renderer's Vite settings (electron.vite.config.ts
 * `renderer`), rooted at src/web, whose entry installs the browser
 * `DesktopApi` before it loads the renderer. `npm run dev:web`,
 * `npm run build:web` (static bundle in out/web), `npm run preview:web`.
 */

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Plugin, type ProxyOptions, defineConfig } from 'vite';

import { NETWORK_PROFILES } from './src/shared/network';

const root = import.meta.dirname;
const gitCommit = (): string => {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev';
  } catch {
    return 'dev';
  }
};
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string };

/**
 * Main modules with a web twin: same exports, browser storage or a Web
 * Worker in place of node:fs and node:wasi. The chain and identity modules
 * that import them are reused unchanged.
 */
const WEB_TWINS: Record<string, string> = {
  [resolve(root, 'src/main/metadataCache.ts')]: resolve(root, 'src/web/metadataCache.ts'),
  [resolve(root, 'src/main/identity/litePerson.ts')]: resolve(root, 'src/web/litePerson.ts'),
};

const RENDERER_ENTRY = resolve(root, 'src/renderer/main.tsx');
const RENDERER_CSS = resolve(root, 'src/renderer/index.css');
const WEB_CSS = resolve(root, 'src/web/index.css');

const webTwins = (): Plugin => ({
  name: 'pcd-web-twins',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    // Fail the build, not the page: nothing Node or Electron may reach the bundle.
    if (/^(?:node:|electron$)/.test(source)) this.error(`${source} is imported by ${importer ?? 'the entry'}; the web build has no Node (docs/web.md).`);
    const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
    // The renderer's stylesheet, as its entry imports it, becomes src/web/index.css (which imports it
    // and adds the renderer to Tailwind's sources): one stylesheet, every renderer class in it.
    if (resolved?.id === RENDERER_CSS && importer === RENDERER_ENTRY) return WEB_CSS;
    const twin = resolved ? WEB_TWINS[resolved.id] : undefined;
    return twin ?? null;
  },
});

/**
 * The identity backend sends no CORS headers (checked 2026-09-28), so the
 * page calls `/idb/<profile>/…` on its own origin (src/web/backend.ts) and
 * this proxy forwards it. A deployment needs the same reverse proxy.
 */
const IDB_PREFIX = '/idb';
const idbProxy: Record<string, ProxyOptions> = Object.fromEntries(
  Object.values(NETWORK_PROFILES).map(profile => [
    `${IDB_PREFIX}/${profile.id}`,
    { target: profile.identityBackend, changeOrigin: true, rewrite: (path: string) => path.slice(`${IDB_PREFIX}/${profile.id}`.length) || '/' },
  ]),
);

/**
 * M22c: where the backend calls go (src/web/backend.ts). Unset: `/idb`, the
 * dev and preview proxy above. `off`: no proxy (GitHub Pages); sign-up and
 * username search show `NO_IDENTITY_BACKEND`. Any other value: a proxy's URL
 * prefix, `<prefix>/<profile>/<backend path>`.
 */
const idbProxyTarget = (value = process.env.VITE_IDB_PROXY): string | null => {
  if (value === undefined || value === '') return IDB_PREFIX;
  if (value === 'off') return null;
  return value.replace(/\/+$/, '');
};

export default defineConfig({
  root: resolve(root, 'src/web'),
  // M22c: `./` (relative, any static host and any path) unless PCD_WEB_BASE names one,
  // as the Pages workflow does (`/polkadot-chat-desktop/`).
  base: process.env.PCD_WEB_BASE || './',
  plugins: [webTwins(), react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_COMMIT__: JSON.stringify(gitCommit()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    __IDB_PROXY__: JSON.stringify(idbProxyTarget()),
  },
  resolve: {
    alias: {
      '@': resolve(root, 'src/renderer'),
      cn: resolve(root, 'src/renderer/lib/cn.ts'),
      'next-themes': resolve(root, 'src/renderer/lib/next-themes.ts'),
    },
  },
  // The renderer's static files (fonts, icons) are shared.
  publicDir: resolve(root, 'src/renderer/public'),
  worker: { format: 'es' },
  server: { proxy: idbProxy },
  preview: { proxy: idbProxy },
  build: {
    outDir: resolve(root, 'out/web'),
    emptyOutDir: true,
  },
});
