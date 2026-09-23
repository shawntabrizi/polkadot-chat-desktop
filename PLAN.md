# Polkadot Chat Desktop — build plan

A native desktop chat app on Polkadot's encrypted messaging rails, with AI agents
as first-class chat peers. It owns its identity (no phone pairing), talks to any
Polkadot app user or bot over the People-chain Statement Store, and runs an AI
assistant inside the app. Same wire protocol as the Android and iOS apps, Polkadot
Desktop, and the `pca` bots. No chat server of our own.

Status: v1 scope written 2026-09-23. Working name `polkadot-chat-desktop`.

## Goals (v1)

1. **Own identity.** On first launch the user signs up: types a username,
   picks the two digits or lets the network pick, sees whether it is free, and
   the app claims it on the People chain the way `pca create` does. Keys are
   minted on this machine and stored encrypted by the OS, so the next launch
   opens straight into chats. No mobile app anywhere in the flow.
2. **Chat with anyone.** Find people by username, send and accept chat requests,
   live 1:1 chat with phone users and bots: text, replies, reactions, edits.
3. **AI assistant in the app.** A built-in assistant contact answered by an LLM
   through the Parity LLM proxy, streamed, rendered as markdown.
4. **Installable.** A signed-or-unsigned `.dmg` for macOS (Apple Silicon) that
   starts, restores identity and chats after a restart.

## Non-goals (v1)

- Multi-device: the desktop identity is single-device. No pairing of a phone to it.
- Groups, calls, files, payments, push notifications.
- Windows and Linux packaging (the code must not block them; only the packaging
  target is macOS in v1).
- Agents that act on-chain as separate peers (that is v2, built on
  `.refs/bot-core`).
- Identity backup to Google Drive, as the mobile app does (v2). v1 stores the
  credentials only on this machine; a lost machine is a lost identity.

## Architecture

```
src/main/        Electron main process (Node). Owns secrets, identity
                 registration, the LLM proxy client, and the app window.
  identity/      keys from a mnemonic, username registration (ported from
                 .refs/bot-core/lib/register.mjs), encrypted storage
  assistant/     LLM proxy client (OpenAI-compatible chat completions)
  ipc.ts         every IPC channel in one file, typed
src/preload/     contextBridge: exposes `window.desktop` (typed in src/shared)
src/renderer/    React app. Starts as a copy of .refs/polkadot-chat-web/src.
  app/           network profiles, Dexie database, store singletons
  domain/        device keys, identity, requests, chat sessions, markdown
  ui/            screens: Onboarding, Chats, Room, Requests, Search, Settings, Assistant
src/shared/      types shared by main, preload and renderer (IPC contracts)
resources/       summit-bandersnatch-cli.wasm (copied from .refs/bot-core/vendor)
scripts/         agent.sh (runs one milestone), check.sh (reviewer checks),
                 per-milestone smoke and e2e scripts
docs/milestones/ M0..M4 specs, each with a `.check.sh` the reviewer runs
docs/            acceptance.md, decisions.md, questions.md
```

Rules that shape the code:

- The renderer keeps the `polkadot-chat-web` rules: one `StatementStoreAdapter`,
  all transport through the `@novasamatech` SDK sessions, Dexie for persistence,
  secrets in the `secrets` table only. Read `.refs/polkadot-chat-web/AGENTS.md`
  and `docs/decisions.md` there before touching `src/renderer/domain`.
- Secrets that must survive a wiped IndexedDB (the identity mnemonic) live in
  the main process, encrypted with Electron `safeStorage`, under
  `app.getPath('userData')/identity.json`. The renderer never sees the mnemonic.
- No `@polkadot/api`, no `@polkadot/util-crypto`. Use `polkadot-api`,
  `@polkadot-api/substrate-bindings`, `@noble/*`, `@scure/*`, `scale-ts`,
  the `@novasamatech/*` SDKs. Pin exact versions in package.json.
- Node-only code (`node:wasi`, `node:fs`, `electron`) lives in `src/main` only.
  `src/renderer` must build for the browser. Enforce with an eslint
  `no-restricted-imports` rule (M0 adds it).
- **Best block first, finality as a signal.** Every chain read and every wait
  uses the best (latest) block, never the finalized block: username lookups,
  identifier-key lookups, sign-up confirmation, message delivery, contract
  calls. Finality is shown, not awaited: a state such as `sent → in block →
  finalized` with a visible indicator, and a reorg is handled by re-reading,
  never by blocking the user. Statement Store traffic has no finality at all.
  (Rule from Shawn, 2026-09-23.)
- `npm run check` = `tsc --noEmit -p tsconfig.json && vitest run && eslint .`.
  It must be green at the end of every milestone.

## Stack (pinned)

| Package | Version | Why |
|---|---|---|
| electron | 44.4.1 | what Polkadot Desktop ships |
| electron-vite | latest at M0 (record in decisions.md) | one config for main, preload, renderer |
| vite | the version electron-vite's peer range allows (record it) | |
| react, react-dom | 19.2.8 | same as polkadot-chat-web |
| typescript | 6.0.3 | typescript-eslint 8.69.0 needs <6.1 |
| vitest | 4.1.11 | |
| eslint, typescript-eslint | 10.9.1, 8.69.0 | |
| @novasamatech/statement-store, host-chat, host-papp, scale | 0.10.2 | same as polkadot-chat-web |
| polkadot-api | 3.1.0 | |
| dexie | 4.4.5 | |
| electron-builder | 26.15.3 | M3 packaging |

The build machine's `~/.npmrc` sets `min-release-age=3`: a version published in
the last three days does not resolve. If `npm install` refuses a pin, choose the
newest version older than three days and record it in `docs/decisions.md`.

## Network profiles

Same two profiles as `polkadot-chat-web/src/renderer/app/network.ts`. Default
`devnet`: People chain `wss://people-paseo.rotko.net` (+ two fallbacks), identity
backend `https://polkadot-app.api.polkadotcommunity.foundation`. The test peer,
the bot `pcdpeer.47`, lives on `devnet`.

## Milestones

| # | Name | Proof |
|---|---|---|
| M0 | Electron shell around the web client | `npm run check` green; `npm run smoke` prints `SMOKE_OK` |
| M1 | Own identity: create a username without a phone | `npm run identity:register -- <name>` registers on devnet; the People chain holds the account with an X25519 key |
| M2 | Live chat with a bot and a person | `npm run e2e:chat -- pcdpeer.47` exchanges a request and a message round trip |
| M3 | Persistence, restart, macOS package | `npm run package` builds a `.dmg`; the packaged app passes `--smoke` and restores identity |
| M4 | AI assistant contact via the LLM proxy | `npm run e2e:assistant` streams a reply through the proxy; the Assistant screen renders markdown |

Each milestone is one file in `docs/milestones/`. Its `.check.sh` is what the
reviewer runs. A milestone is done when the check passes and the work is
committed with a message that starts with `M<n>:`.

## Review protocol

1. The implementation agent works one milestone, commits, and stops.
2. The reviewer runs `scripts/check.sh M<n>`, reads the diff, and writes
   findings to `docs/review/M<n>.md` (`PASS` or a numbered fix list).
3. On a fix list, the agent runs again with `docs/review/M<n>.md` as input,
   fixes only those items, commits `M<n>: review fixes`, and stops.
4. The next milestone starts only after a `PASS`.
