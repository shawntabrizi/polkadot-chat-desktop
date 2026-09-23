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

## M1 — Own identity (2026-09-23)

- Dependencies, pinned: `@scure/sr25519` `2.2.0` and `@polkadot-labs/hdkd-helpers` `0.0.30` (the bot-core pins), `@scure/bip39` `2.4.0` (published 2026-08-28, the newest older than three days), dev `tsx` `4.23.15` (published 2026-09-20 07:22 UTC; npm resolved it on 2026-09-23 14:13 UTC). No pin was refused by `min-release-age=3`.
- `@novasamatech/substrate-slot-sr25519-wasm` is not added. `wallet-keys.mjs` uses it only for Coinage memo secrets; `deriveSr25519PairFromSeed` does not need it.
- `@scure/sr25519@2.2.0` is in `package.json` as the milestone asks, but no file imports it directly. `hdkd-helpers@0.0.30` brings its own nested `@scure/sr25519@1.0.0`, which is what signs. A cross-check against `.refs/bot-core/lib/register.mjs` `deriveIdentityKeys` (5 random mnemonics, run once in a scratch script, not committed) gave the same account, chat key, identifier key, lite entropy and wallet secret.
- People descriptors: copied `productsDevnetPeople.scale` and `paseoPeopleNext.scale` from `.refs/bot-core/.papi/metadata/` into `.papi/metadata/`, wrote `.papi/polkadot-api.json` with those two entries (same genesis and code hash as bot-core), and ran `npx papi generate` (papi CLI 0.22.1). It added `"@polkadot-api/descriptors": "file:.papi/descriptors"` to dependencies. The generated `dist/` is git-ignored by papi, so `"prepare": "papi generate"` rebuilds it on `npm install` (offline: it reads the committed metadata files), as bot-core does. The Bulletin descriptors are not generated (not used).
- eslint ignores `.papi/` (generated code).
- `resourcePath(name)` does not import `electron`, so the Node script can use it. Packaged = `process.versions.electron` set and `process.defaultApp` not set (what `app.isPackaged` reads). Unpackaged runs resolve `../../resources` from the module, which is the repo folder both from `src/main/resources.ts` (tsx) and from the bundled `out/main/index.js`. So `electron.vite.config.ts` needs no change in M1; M3 adds `extraResources` for the packaged app.
- `crypto.ts` keeps Node `crypto` for X25519 (as the codec does). A spec checks that the result equals `@noble/curves` x25519, which the renderer uses.
- `register.ts` ports only what the desktop flow uses: no native bandersnatch binary, no voucher, no saved or refreshed session, no `reregisterIdentity`. `searchUsernames` was ported first and then removed when the spec changed to the availability endpoint (see below).
- Availability (`identity:available`): `POST /api/v1/usernames/available?version=v1` needs a Bearer token on both backends (401 without one, checked 2026-09-23). Before sign-up there is no identity key, so the main process mints a token with a throwaway sr25519 client key (`obtainAnonymousSession`, the same challenge/token handshake as `obtainIdentitySession`; register.mjs `identityClient` does the same without a mnemonic). The token is cached per backend until it is one minute from expiry and minted again once on a 401.
- `identity:available` takes `(username, profile)`, not `(username)`: the sign-up screen has a network select, and each network has its own backend.
- `availableDigits` is 1–99 in the live answers (no 0). The digits field accepts any two digits and shows "Digits taken. Try again." for a value not in the list.
- Digits UI: a "Let the network pick" checkbox, checked by default (step 10b), and a two-digit field that is pre-filled with the first `availableDigits` entry (step 10c). The field is enabled when the box is unchecked. A value the user typed is not overwritten by a later answer.
- The button is enabled when the availability check failed (network error): the backend refuses a taken number itself, and a flaky check should not block sign-up. It is disabled while a check runs, when the name is taken, and when typed digits are not in the list.
- `createIdentity` takes the store as a parameter (`store: { save, load }`). The Electron IPC passes the safeStorage store; the Node script passes a plain-file store. It refuses to run when the store already holds an identity, so a second sign-up cannot overwrite the only copy of a mnemonic.
- `createIdentity` returns `confirmed: boolean` in addition to the three fields of step 7f. When the chain does not show the key within 180 s, the claim stands (the identity is saved) and the UI says the network has not confirmed it yet, instead of an error.
- The main-process People client waits for the finalized block and the runtime metadata before the first read, like bot-core `awaitRuntime`. It does not cache metadata on disk (bot-core does); the first read after a start can take up to a minute on the public nodes.
- `getDeviceKeys()`: when a `device.statementSeed` secret exists but the device row is missing, it rebuilds the row from the stored keys. When the seed exists and the encryption key is missing or has the wrong size, it throws instead of minting.
- `ensureSelfIdentitySeeded` also re-seeds when Dexie holds an identity row of a different account (an older phone pairing), not only when there is no row. It writes the identity's network into the `networkProfile` setting. The App uses the profile from `identity.json`.
- App start-up reads device keys only after seeding, so the first launch mints no throwaway device keys.
- Logout (Settings) clears the Dexie identity rows and runs the start-up again, which re-seeds from the saved identity. See docs/questions.md.
- The Node script (`scripts/identity-register.mjs`) loads the TypeScript sources through `tsx` (`tsImport`), not through `out/main`: `out/main/index.js` is one bundle that starts the app. It spells digits in the given name as letters (`0`→`a` … `9`→`j`) and prints a `note:` line, because the backend takes letters only and the acceptance and check names carry digits (`pcdtest1234`, `pcdrev$RANDOM`). See docs/questions.md.
- The script's plain store writes `.agent-runs/identity-<name>/identity.json` (mode 0600, folder 0700, git-ignored) with the mnemonic in plaintext, as step 11 asks.
- Vitest now also runs `src/main/**/*.spec.ts`.
- Not added: a spec for `SignUp.tsx` or for the availability parser. AGENTS.md allows new files only where a step says "add tests"; steps 3 and 9 name the two specs added. The sign-up screen was checked by hand in Electron instead (docs/acceptance.md).
