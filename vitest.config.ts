import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Same settings as .refs/polkadot-chat-web/vite.config.ts: the web client runs
// its tests under node, with fake-indexeddb from vitest.setup.ts.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/renderer/**/*.spec.ts', 'src/renderer/**/*.spec.tsx'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
