# Web build (M22a)

The renderer runs in a browser. `src/web/main.tsx` installs a browser
implementation of `DesktopApi` (`src/web/desktop.ts`) on `window.desktop`,
then loads `src/renderer/main.tsx` unchanged.

- `npm run dev:web`: Vite dev server with the `/idb/*` proxy.
- `npm run build:web`: static bundle in `out/web/` (relative paths, any static host).
  M22c build settings: `PCD_WEB_BASE` (Vite `base`, default `./`) and
  `VITE_IDB_PROXY` (see "Identity backend" below). Both unset keep dev and preview as they were.
- `npm run preview:web`: serves `out/web/` with the same proxy, for a local check.

The build config is `vite.web.config.ts`. It reuses the renderer's aliases and
plugins. It also does two things:

- **Web twins.** Two main modules have a browser twin with the same exports:
  `src/main/metadataCache.ts` → `src/web/metadataCache.ts` (IndexedDB) and
  `src/main/identity/litePerson.ts` → `src/web/litePerson.ts` (Web Worker).
  The chain and identity modules that import them are reused as they are.
- **No Node in the bundle.** An import of `node:*` or `electron` fails the build.

## Categories

- **ported**: runs in the page with browser APIs (IndexedDB, WebCrypto,
  fetch, WebSocket, Web Worker) and the same modules as main.
- **proxied**: needs the identity backend through the same-origin `/idb/*` path.
- **unavailable**: rejects with `NOT_ON_WEB` ("Available only inside Polkadot
  Chat Desktop."), or is a no-op for a listener or a fire-and-forget call. The
  UI shows that text: Settings › Assistant, Agent and Profiles, and the
  Assistant room.

Totals: 76 members. 48 ported, 2 proxied, 26 unavailable.

## Members

| Member | Web | How, or why not |
| --- | --- | --- |
| `platform` | ported | `'web'` (the desktop preload says `'desktop'`). The renderer's `isWeb()` reads it. |
| `version` | ported | `'web'` (no Electron version). |
| `osVersion` | ported | `navigator.userAgent`, for the bug-report line. |
| `identity.get` | ported | Public fields of the IndexedDB identity record. |
| `identity.available` | proxied | `service.ts` `checkAvailability` with the `/idb` fetch. |
| `identity.create` | proxied | `service.ts` `createIdentity` with the `/idb` fetch; the proof runs in a Web Worker. Asks for a new passphrase first. |
| `identity.secretsForRenderer` | ported | Derived from the unlocked mnemonic (`keys.ts`), never the mnemonic. |
| `identity.reset` | ported | Moves the record to a backup; the backup goes after 10 s. |
| `identity.resetUndo` | ported | Puts the backup back inside the 10 s. |
| `identity.recoveryPhrase` | ported | `recovery.ts` rule (the typed word) on the unlocked mnemonic. |
| `identity.copySecret` | ported | `secretClipboard.ts` rule with `navigator.clipboard`. The clear after 60 s needs clipboard-read permission; without it the phrase stays and no "cleared" hint shows. |
| `identity.onSecretCleared` | ported | As above. |
| `identity.onProgress` | ported | Sign-up progress lines. |
| `identity.savePaired` | ported | M10a phone sign-in: asks for a new passphrase (as sign-up), then seals the keys in the `paired` row. |
| `identity.pairedSecrets` | ported | The unlocked phone sign-in, for the renderer's Dexie seeding. |
| `identity.forgetPaired` | ported | Sign out: deletes the `paired` row. |
| `chain.getMetadata` / `setMetadata` | ported | IndexedDB, by code hash. |
| `chain.dryRun` / `sign` / `watch` / `track` / `onTxStatus` | ported | `assetHub.ts` `createTxService` over polkadot-api in the page. |
| `chain.contractRead` / `balance` / `onBestBlock` | ported | Same service. M10a: a phone sign-in's `balance` and `onBestBlock` read its identity account through a signer-less connection instead (no mnemonic to build a tx service with). |
| `chain.transferCall` / `transfersOf` | ported | Same service. |
| `chain.faucetDrip` | ported | `faucet.ts` `dripDevnet`: public dev phrases, devnet Asset Hub only (the guard is the desktop's). M10a: a phone sign-in drips to its identity account over the same signer-less connection as `balance`. |
| `assistant.*` (9) | unavailable | The proxy key would sit in the browser, the LLM proxy's CORS is not known, and the CLI engines need a local process. |
| `app.setBadge` | ported | Badging API (`navigator.setAppBadge`) where the browser has it; else nothing. |
| `app.notify` / `onNotifyOpen` | ported | Notification API after the person allows it. No OS sound; `silent` follows the request. |
| `app.onMenuSettings` | unavailable | No app menu. No-op listener. |
| `app.openUrl` | ported | Same `openableUrl` rule; a new tab. An invite link goes to `onOpenLink`. |
| `app.onOpenLink` | ported | Invite links opened inside the page. |
| `app.takeOpenLink` | unavailable | No OS `polkadot-chat://` / `polkadotapp://` handler launches the page. Always null. |
| `diagnostics.add` / `get` / `onChanged` | ported | `main/diagnostics.ts` in the page. Totals live for one page load (the desktop keeps them across reloads). |
| `demo.bots` | ported | The built-in list only. The `PCD_DEMO_MANIFEST_URL` fetch is not ported (no environment in a browser). |
| `agent.*` (7) | unavailable | The published agent runs bot-core in a utility process with its own keys. `setContacts` is a no-op. |
| `bulletin.store` / `onProgress` / `allowance` | ported | `bulletin.ts` service, signed by the identity's Bulletin key from the unlocked mnemonic. |
| `bulletin.fetch` | ported | Same. Bitswap goes over the chain RPC. The mirror and the IPFS gateway need CORS from those hosts: not verified. |
| `hop.fetch` / `ack` / `send` / `onProgress` | ported | `hop.ts` over the browser WebSocket; chain fallback through the Bulletin service. |
| `files.open` | ported | Raster images, video, audio, PDF and plain text open in a new tab as a typed blob. Anything else downloads, so an HTML or SVG attachment never runs script on our origin. |
| `files.save` | ported | A download with the safe file name. Always `true` (the browser has no cancel signal). |
| `storage.atRestKey` | ported | Random 32 bytes, sealed under the passphrase key with the identity. |
| `profiles.state` | ported | One row: this browser, current and default, so the renderer boots the app, not the picker. |
| `profiles.open` / `openInNewWindow` / `add` / `rename` / `remove` / `setDefault` / `openPicker` / `restore` (8) | unavailable | One identity per browser: no processes or windows per profile. Restore from a phrase is a new-profile flow on the desktop; see Open questions. |

## What is stored where

All in this browser, per origin.

| Store | What | Protection |
| --- | --- | --- |
| IndexedDB `polkadot-chat-web-platform`, table `records`, row `identity` | username, account id, network (clear); the mnemonic and the at-rest key (sealed); the salt and the PBKDF2 iteration count | AES-256-GCM under a key from PBKDF2-SHA256 (600,000 iterations, 16-byte random salt) of the passphrase. Each value has its own IV and its field name as AAD. |
| same, row `paired` (M10a) | a phone sign-in: username, account id, network, pairing time (clear); the identity chat key, this device's statement and encryption keys, the phone's keys, root account and entropy, and the at-rest key (sealed) | as the `identity` row. A browser holds one of the two rows, never both. |
| same, row `identity.bak` | the same record during the 10 s reset Undo | as above; dropped at the next page start |
| same, table `metadata` | public runtime metadata by code hash | none needed |
| IndexedDB `polkadot-chat-web` | the renderer's chat database (as on the desktop) | as on the desktop: the `keys` table is sealed with the at-rest key |
| memory only | the passphrase key (non-extractable `CryptoKey`), the mnemonic, the at-rest key | gone at reload; the page asks for the passphrase again |
| `localStorage` | the renderer's own settings (theme and the like, as on the desktop) | none; no secrets |

The passphrase is asked when "Get username" is pressed, before any backend
call, so a cancel claims nothing. It cannot be recovered. "Forgot the
passphrase?" on the unlock screen deletes the account and its chats from the
browser; the recovery phrase is the only way back (restore on the desktop).

A page closed during the 10 s reset Undo drops the backup (the desktop puts it
back at the next start): on the web, the renderer's reload after its Undo time
is itself a page start, and it must not bring the identity back.

## Identity backend: `/idb/*`

The backend returns no `Access-Control-Allow-Origin` for foreign origins
(checked 2026-09-28), so the page cannot call it directly. `src/web/backend.ts`
rewrites each backend URL to the page's own origin:

| Path | Target |
| --- | --- |
| `/idb/devnet/*` | `https://polkadot-app.api.polkadotcommunity.foundation/*` |
| `/idb/paseo/*` | `https://identity-backend-next.parity-testnet.parity.io/*` |

Any other host is refused before a request leaves. Dev and preview: the Vite
proxy in `vite.web.config.ts`. **A deployment must run the same reverse
proxy**, or the backend's operator must allow our origin.

M22c: `VITE_IDB_PROXY` sets the prefix at build time.

| `VITE_IDB_PROXY` | Backend calls go to | Local sign-up and username search |
| --- | --- | --- |
| unset | `/idb/<profile>/*` on the page's origin (dev, preview) | work through the Vite proxy |
| a URL, e.g. `https://idb.example.org` | `<URL>/<profile>/*` | work, if that proxy answers with CORS for the page |
| `off` | nowhere | show "Not available on this site: use the desktop app or sign in with your phone." (`NO_IDENTITY_BACKEND`) |

The web `identity.backendFetch` is that fetch, or `null` for `off`. The
username search (`Search.tsx`) uses it too; before M22c it called the backend
directly, which CORS refuses even in dev.

## Hosting: GitHub Pages (M22c)

`.github/workflows/pages.yml` builds on every push to `main` and by hand
(`workflow_dispatch`): Node 24, `npm ci` (its `prepare` runs `papi generate`
from the committed `.papi/metadata`, no chain connection), then
`PCD_WEB_BASE=/polkadot-chat-desktop/ VITE_IDB_PROXY=off npm run build:web`,
`actions/upload-pages-artifact` and `actions/deploy-pages`. The site is
`https://shawntabrizi.github.io/polkadot-chat-desktop/`.

- **Base.** An absolute base, so assets, the proof worker and the wasm load
  from `/polkadot-chat-desktop/assets/` whatever the page URL is. The logo uses
  `import.meta.env.BASE_URL`.
- **Routing.** None: the renderer has no path routes (one `index.html`; state
  lives in the page and IndexedDB). So no `404.html` fallback and no hash
  routing. An Actions deploy does not run Jekyll, so no `.nojekyll`.
- **No proxy.** Pages serves files only, and no identity backend sends CORS
  headers for `https://shawntabrizi.github.io` (checked 2026-09-28).

On Pages:

| Works | Does not work |
| --- | --- |
| The phone QR sign-in (M10a) and chat after it: Statement Store and People chain over WebSocket (QR checked in a local Pages-like boot; a real scan not tested) | Local sign-up (`identity.available`, `identity.create`) |
| Contact lookup and exact-name reads on the People chain (`lookup.ts`, `Resources.UsernameOwnerOf`): no backend | Username search in the left pane (a backend endpoint): shows the text above |
| Chain services, Bulletin, HOP: as in the member table | Anything already unavailable on the web (Assistant, agent, profiles) |

The exact-name resolver (`createUsernameResolver`) needs no backend, but
today only the demo bots use it; the search pane does not fall back to it.

To add a proxy later: build with `VITE_IDB_PROXY=<proxy URL>`. No code change.

## Registration proof in the browser

`src/web/wasi.ts` hosts the eight WASI preview1 imports the vendored
`resources/summit-bandersnatch-cli.wasm` needs (args, environ, `random_get`,
`fd_write` to stdout/stderr, `proc_exit`, `sched_yield`). The wasm (5.1 MB)
is a static asset; `src/web/litePerson.worker.ts` runs it off the main thread.
`src/web/wasi.spec.ts` requires the same proof as node:wasi. Local sign-up is
therefore available on the web.

## Checks

- Unit tests: `src/web/*.spec.ts` (vault, backend proxy, identity, the web
  `DesktopApi`, the WASI shim) and `src/renderer/app/platform.spec.ts`.
- No browser runner (Playwright, Puppeteer) is a dependency. The M22a boot
  check used Electron (already a dependency) as a headless browser with a
  throwaway profile: see docs/acceptance.md.
- Manual check: `npm run build:web && npm run preview:web`, open the printed
  URL, check the sign-up screen and the browser console; type a name and see
  "It's yours!" or a taken answer (the `/idb` proxy works).
