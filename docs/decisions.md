# Decisions

One bullet per choice: what, why, date.

## M0 — Electron shell (2026-09-23)

- `electron-vite` is `6.0.0-beta.1` (published 2026-04-12), not the `latest` tag `5.0.0`. 5.0.0 declares `vite ^5 || ^6 || ^7`, but the web client's `@vitejs/plugin-react@6.1.1` needs `vite ^8`. 6.0.0-beta.1 declares `vite ^6 || ^7 || ^8`, so the copied devDependencies stay at the web client's versions. The other option was electron-vite 5.0.0 + vite 7.3.6 + a downgrade of plugin-react to 5.2.0. The beta is the newest electron-vite older than three days. See docs/questions.md.
- `vite` is `8.3.0` (published 2026-09-10): the newest version older than three days inside the `^8.0.0` part of the electron-vite peer range. The web client pins 8.2.2.
- `@types/node` is `26.6.2` (published 2026-09-19): the newest version older than three days. Electron 44 ships an older Node; the newer types did not cause errors.
- `electron` `44.4.1` (published 2026-09-16) resolved as pinned. Its npm package downloads the binary on first run, not in `postinstall`.
- No pin was refused by `min-release-age=3`.
- The preload is built as CommonJS (`out/preload/index.js`). With `"type": "module"`, electron-vite emits ESM `index.mjs`, and a sandboxed preload cannot be an ES module. The main process stays ESM and uses `import.meta.dirname` for paths.
- `window.desktop` is typed as optional (`desktop?: DesktopApi`). The renderer runs without Electron in vitest, so the type makes code handle that case.
- Vitest config is a separate `vitest.config.ts`, a copy of the web client's `vite.config.ts` test block: `environment: 'node'` (the web client does not use jsdom), `fake-indexeddb` from `vitest.setup.ts`, include narrowed to `src/renderer/**/*.spec.ts(x)`.
- One `tsconfig.json` with `lib: ["ES2023", "DOM", "DOM.Iterable"]` and `types: ["node", "vite/client"]` for main, preload and renderer. The eslint `no-restricted-imports` rule, not the type config, keeps Node imports out of `src/renderer`. The other compiler options are copied from the web client.
- eslint also ignores `.agent-runs/` (git-ignored runner logs).
- The renderer shows Electron's "Insecure Content-Security-Policy" warning in dev (unpackaged) runs. The copied `index.html` has no CSP. Not changed in M0 because M0 keeps the copied code unchanged.
- `npm install` reports 8 high-severity audit findings in the dependency tree. Not addressed in M0; no dependency was changed from the plan.
