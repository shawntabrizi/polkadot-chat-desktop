import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      // M13: agent-host.js is the entry of the published agent's utility process.
      lib: { entry: { index: resolve(import.meta.dirname, 'src/main/index.ts'), 'agent-host': resolve(import.meta.dirname, 'src/main/agent/host.ts') } },
    },
  },
  preload: {
    build: {
      // Sandboxed preload scripts cannot be ES modules, so emit CommonJS
      // as out/preload/index.js.
      lib: { entry: resolve(import.meta.dirname, 'src/preload/index.ts'), formats: ['cjs'] },
      rolldownOptions: { output: { entryFileNames: '[name].js' } },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    // Same aliases as tsconfig `paths`. `cn` is the bare specifier the shadcn
    // CLI writes into components/ui; it must resolve to the theme's cn.ts, not
    // to an npm package of that name (.refs/polkadot-design-system SKILL.md §1).
    resolve: {
      alias: {
        '@': resolve(import.meta.dirname, 'src/renderer'),
        cn: resolve(import.meta.dirname, 'src/renderer/lib/cn.ts'),
        // Stock Sonner imports next-themes; lib/next-themes.ts answers from theme.ts.
        'next-themes': resolve(import.meta.dirname, 'src/renderer/lib/next-themes.ts'),
      },
    },
    build: {
      rolldownOptions: {
        input: resolve(import.meta.dirname, 'src/renderer/index.html'),
      },
    },
  },
});
