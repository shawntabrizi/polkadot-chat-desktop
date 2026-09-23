import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Same settings as .refs/polkadot-chat-web/vite.config.ts: the web client runs
// its tests under node, with fake-indexeddb from vitest.setup.ts.
export default defineConfig({
  plugins: [react()],
  // The renderer's aliases (electron.vite.config.ts), so a spec can render a component (M12 streamingFence.spec.ts).
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src/renderer'),
      cn: resolve(import.meta.dirname, 'src/renderer/lib/cn.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/main/**/*.spec.ts', 'src/shared/**/*.spec.ts', 'src/renderer/**/*.spec.ts', 'src/renderer/**/*.spec.tsx'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
