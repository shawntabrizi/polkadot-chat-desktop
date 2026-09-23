# polkadot-chat-desktop

A native desktop chat app on Polkadot's encrypted messaging rails. It is an
Electron shell around the `polkadot-chat-web` React client. It talks to Polkadot
app users and bots over the People-chain Statement Store, with no chat server of
its own. See `PLAN.md` for the scope and the milestones.

## Install

`npm install`. The `postinstall` script runs `node_modules/electron/install.js`
when `node_modules/electron/dist` is missing or empty (a fresh checkout, such as
a git worktree, can be left without the Electron binary, and `electron-vite dev`
then fails with "Electron uninstall"). It does nothing when the binary is there.
`prepare` then regenerates the People-chain descriptors (`papi generate`).

## Scripts

- `npm run dev` — start the app with the Vite dev server.
- `npm run build` — build main, preload and renderer into `out/`.
- `npm run check` — type check, unit tests, lint.
- `npm run smoke` — build, start the app hidden, print `SMOKE_OK` when the renderer loads.
- `npm run package` — build and package an unsigned macOS Apple Silicon `.dmg` into `dist/`.
- `npm run smoke:packaged` — run the packaged app with `--smoke` against a throwaway profile.
- `npm run identity:register -- <name> [--profile devnet|paseo]` — create and register an identity without Electron (test use; stores it unencrypted under `.agent-runs/`).

`PCD_USER_DATA_DIR=<folder>` runs the app with another profile (identity,
IndexedDB, window state, metadata cache), for tests.

Reference code: `.refs/` (git-ignored symlinks; see PLAN.md)
