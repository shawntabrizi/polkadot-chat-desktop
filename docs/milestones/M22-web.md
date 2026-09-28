# M22: Web client and "Sign in with Polkadot app"

Owner request (2026-09-28): a web version first, with the Polkadot app QR login as the primary way in and local sign-up as the fallback. Android later reuses the same web build.

## Facts this plan rests on

- **One bridge.** The renderer talks to main only through `window.desktop: DesktopApi` (`src/shared/desktop-api.ts`, wired in `src/preload/index.ts`). A web build implements the same interface in the browser. The renderer does not change shape.
- **The chat engine already runs in the renderer** (Novasama SDK, polkadot-api). Parity's `polkadot-chat-web` runs the same SDK in a browser.
- **Pairing is byte-compatible with the phone** (checked 2026-09-28 against polkadot-app-android-v2 ba3e15749): `polkadotapp://pair?handshake=<hex>`, offer and answer SCALE, X25519 + HKDF-SHA256 + ChaCha20-Poly1305, topic and channel khash. Our V2 code in `src/renderer/domain/pairing/` needs no wire change.
- **What the phone gives a linked device:** it allocates the device's statement slot on chain (`set_statement_store_account`, ring proof, 1-day period, renewed hourly by the phone), then answers Success with identity account, root account, identity chat private key, SSO encryption public key, phone device encryption public key, root entropy source. **No seed.** Then it broadcasts `DeviceAdded` (kind 17) to multi-device contacts. History sync runs over WebRTC through a Statement Store session; the phone's initial sync is still a stub.
- **The identity backend sends no CORS headers** (`GET /api/v1/attester` from `Origin: https://example.org` returns 200 without `Access-Control-Allow-Origin`, 2026-09-28). A browser cannot call it from our origin. Affected: local sign-up (registration), username search, username lookup by backend. Not affected: pairing, chat, chain reads.

## Phases

Each phase is one agent in its own worktree, one branch, small commits, `npm run check` green at every commit. The coordinator reviews each phase before the next starts.

### M22a: Web build and platform layer

Goal: the existing renderer runs in a browser from `npm run dev:web` and `npm run build:web`, and the desktop build is unchanged.

1. A web entry (`src/web/`) that installs a browser implementation of `DesktopApi` on `window.desktop` before the renderer boots. Same renderer code, no forks.
2. Inventory every `DesktopApi` member in `docs/web.md` with its web implementation: **ported** (IndexedDB, WebCrypto, fetch, Web Worker), **proxied** (identity backend, see 5), or **unavailable** (returns a typed "not on web" result the UI can show). Expected unavailable: published agent, OS notifications beyond the Notification API, multiple profiles, native dialogs, window state, menu, `polkadotapp://` handler.
3. Secrets: no seed is stored in clear. A local account on web keeps the seed encrypted with a user passphrase (WebCrypto PBKDF2 or Argon2 if already a dependency, AES-GCM), unlocked per session. The attachment at-rest key likewise.
4. Registration proof: run the vendored `summit-bandersnatch-cli.wasm` `lite-person` path in a Web Worker with a minimal WASI shim. If that fails, mark local sign-up unavailable on web and say so.
5. Identity backend: route through a same-origin path (`/idb/*`). Dev: Vite proxy. Production: documented as a required reverse proxy; no hosting in this phase.
6. Chain helpers in main (`src/main/chain/*`: Bulletin, HOP, Asset Hub, faucet, tx tracker) move behind the web `DesktopApi` using polkadot-api in the browser, or are marked unavailable with a reason.
7. Tests: unit tests for the web `DesktopApi` members; a build check that `build:web` emits a static bundle; a headless browser boot if a browser runner is already a dependency, otherwise a documented manual check.
8. Do not: add runtime dependencies without listing them for owner approval; change the wire; change desktop behaviour.

### M10a: Sign in with Polkadot app

Goal: first run shows the phone QR as the primary path in both desktop and web; local sign-up stays as the fallback.

1. First-run screen: QR (from the existing V2 pairing code) with steps "Open Polkadot app → Settings → Linked devices → Add device", live status (waiting, phone approved and allocating, done, failed with reason), and "Create a local account instead".
2. Persist the Success payload as a **paired identity**: identity account, root account, identity chat private key, phone device key, phone statement account (the answer's signer), SSO key, root entropy. Desktop: sealed by `safeStorage`. Web: encrypted as in M22a.3.
3. Run the chat engine as the identity: topics and encryption from the identity chat key; statements signed by this device's own statement account, the one the phone allocated.
4. Allowance state: detect missing or expired allowance on submit and show "Open the Polkadot app on your phone to reconnect this device". No self-service path exists.
5. Seedless states: wallet signing, recovery phrase, published agent, faucet drip, and payments show "Not available when signed in with your phone" instead of failing.
6. Sign out: forget the paired identity locally. (The phone revokes by stopping renewal.)
7. Tests: headless e2e of the desktop half with `domain/pairing/testing/publishPairingResponse.ts` playing the phone. The real scan is an owner step.

### M22b: Multi-device chat and device sync (after M10a)

1. Multi-device messaging per `mds.md`: encrypt to every device of each peer, process `DeviceAdded`/`DeviceRemoved`, count the phone as one of our devices.
2. Device-sync peer: Statement Store session with the phone (2 KB statements), WebRTC data channel, `SyncMessage` Update/Ack for devices, chats, messages. Expect partial data while the phone's initial sync is a stub.

### M22c: Deploy (owner go required)

Static hosting for the web bundle and a reverse proxy for `/idb/*`, or an allowlist request to the backend's operator. Outward-facing, so it waits for the owner.

## Open questions for the owner

1. Hosting for M22c: GitHub Pages on the public repo plus a small proxy, or somewhere else.
2. Ask PCF to add our web origin to the identity backend's CORS allowlist, instead of running a proxy.
3. Local sign-up on web: keep it (seed under a passphrase) or web is phone-login only.
