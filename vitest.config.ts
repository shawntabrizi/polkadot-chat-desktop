import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Same settings as .refs/polkadot-chat-web/vite.config.ts: the web client runs
// its tests under node, with fake-indexeddb from vitest.setup.ts.
export default defineConfig({
  plugins: [react()],
  // Fixed stand-ins for the build values electron.vite.config.ts injects (src/shared/appVersion.ts).
  define: {
    __APP_VERSION__: JSON.stringify('9.9.9-test'),
    __APP_COMMIT__: JSON.stringify('abc1234'),
    __BUILD_DATE__: JSON.stringify('2026-01-02'),
  },
  // The renderer's aliases (electron.vite.config.ts), so a spec can render a component (M12 streamingFence.spec.ts).
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src/renderer'),
      cn: resolve(import.meta.dirname, 'src/renderer/lib/cn.ts'),
    },
  },
  test: {
    environment: 'node',
    // scripts/lib: pure helpers of the e2e scripts whose rules need a test (M15b botDescribe).
    include: ['src/main/**/*.spec.ts', 'src/shared/**/*.spec.ts', 'src/renderer/**/*.spec.ts', 'src/renderer/**/*.spec.tsx', 'scripts/lib/**/*.spec.mjs'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
