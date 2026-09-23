# Acceptance log

One section per milestone. Real command output only.

## M0

Run 2026-09-23 on macOS (Apple Silicon), Node v24.13.1, npm 11.12.1.

### `npm run check` (last 20 lines)

```

> polkadot-chat-desktop@0.1.0 check
> tsc --noEmit -p tsconfig.json && vitest run && eslint .


 RUN  v4.1.11 /Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop


 Test Files  22 passed (22)
      Tests  132 passed (132)
   Start at  10:08:40
   Duration  933ms (transform 774ms, setup 460ms, import 5.75s, tests 1.50s, environment 1ms)

check exit=0
```

### `npm run smoke` (last 20 lines)

```
rendering chunks...
out/main/index.js  1.22 kB

✓ built in 12ms
vite v8.3.0 building ssr environment for production...
transforming...
✓ 2 modules transformed.
rendering chunks...
out/preload/index.js  0.18 kB

✓ built in 5ms
vite v8.3.0 building client environment for production...
transforming...
✓ 1010 modules transformed.
rendering chunks...
out/renderer/index.html                    0.32 kB
out/renderer/assets/index-DwrG3l9y.js  1,705.32 kB

✓ built in 84ms
SMOKE_OK
smoke exit=0
```

### `git status --short`

Run after the commit; see the commit report. The file cannot contain its own post-commit state.

### Not run

- `docs/milestones/M0.check.sh` as a whole: it calls `timeout`, which this machine does not have. See docs/questions.md.

### Extra manual check

A one-off Electron script (not committed) loaded `out/renderer/index.html` with the built preload and read the page after 4 s. Output line:

```
PROBE {"root":20802,"text":"Polkadot Chat Web\nPair with your phone\nNetwork \nDevnet\nPaseo\n\nSubmitted. Scan the code with the Polkadot app and approve this device.\n\nPairing link","desktop":{"version":"44.4.1"}}
```

So the React app mounts (not only `did-finish-load`) and `window.desktop.version` is `44.4.1`.

## M1

Run 2026-09-23 on macOS (Apple Silicon), Node v24.13.1, npm 11.12.1.

Reviewer check run (2026-09-23): `docs/milestones/M1.check.sh` registered `pcdrevchibacbfcc.48`, `ON_CHAIN key_type=0`.

### `npm run check` (last 12 lines)

```
> tsc --noEmit -p tsconfig.json && vitest run && eslint .


 RUN  v4.1.11 /Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop


 Test Files  24 passed (24)
      Tests  147 passed (147)
   Start at  10:31:46
   Duration  1.03s (transform 898ms, setup 458ms, import 7.33s, tests 2.05s, environment 1ms)

check exit=0
```

### `npm run smoke` (last 8 lines)

```
✓ 979 modules transformed.
rendering chunks...
out/renderer/index.html                    0.32 kB
out/renderer/assets/index-B7ZGM2qn.js  1,630.38 kB

✓ built in 80ms
SMOKE_OK
smoke exit=0
```

### `npm run identity:register -- pcdtest6698` (final code, 14:29 UTC)

```

> polkadot-chat-desktop@0.1.0 identity:register
> node scripts/identity-register.mjs pcdtest6698

note: usernames are letters only; using pcdtestggji for pcdtest6698
Creating keys
Claiming username
Waiting for the network.......................
profile devnet
username pcdtestggji.38
accountHex 0x423f651ffe33d58dac5816f5e8198ed693cf24e544b21e52bfc60db766ca640e
identifierKeyHex 0x007169a1cab85f05384185f5054aba372b13405dcb02f68ffab90a0b1313691b3b0000000000000000000000000000000000000000000000000000000000000000
confirmed true
identity file /Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop/.agent-runs/identity-pcdtestggji/identity.json
ON_CHAIN key_type=0
on-chain identifierKey matches: true
npm run identity:register -- $N  1.17s user 0.22s system 0% cpu 2:27.69 total
```

The same command ran once before on this code base (14:18 UTC, before the availability change in `register.ts`; the registration path was the same). It also passed:

```

> polkadot-chat-desktop@0.1.0 identity:register
> node scripts/identity-register.mjs pcdtest9080

note: usernames are letters only; using pcdtestjaia for pcdtest9080
Creating keys
Claiming username
Waiting for the network......
profile devnet
username pcdtestjaia.98
accountHex 0x5efb3590d35d794578c07313720e0ccdb0abff70b9e67927ccda7a00fcc6ed73
identifierKeyHex 0x000c858b0eef02fe28063cc3ff14531e25c8b9e031e3ef69b3fcaee20e1f4397480000000000000000000000000000000000000000000000000000000000000000
confirmed true
identity file /Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop/.agent-runs/identity-pcdtestjaia/identity.json
ON_CHAIN key_type=0
on-chain identifierKey matches: true
npm run identity:register -- $N  0.99s user 0.15s system 1% cpu 57.864 total
```

The identifier keys above are public (they are on chain). The printed identity files hold the test mnemonics; they stay in the git-ignored `.agent-runs/`.

### `git status --short`

Run after the commit; see the commit report. The file cannot contain its own post-commit state.

### Not run

- `docs/milestones/M1.check.sh` as a whole: it needs the commit first and registers one more identity. Its parts were run above.

### Extra manual check (Electron)

A one-off Electron script (not committed) loaded `src/main/ipc.ts` through tsx, set a temporary `userData` folder, opened `out/renderer/index.html` with the built preload, and drove the page. It saved a random, unregistered identity through `store.ts` (safeStorage), reloaded, and read Dexie. The first line runs the lite-person wasm through `node:wasi` inside Electron main. Output:

```
PROBE wasi in electron ok string
PROBE first launch text: "Polkadot Chat Web\nWelcome to Polkadot\n\nChoose a username to get started.\n\nPick a username\n\n\nMinimum 6 characters\n\n Let the network pick\nDigits \nusername.NN\n\nNetwork \nDevnet\nPaseo\n\nGet username"
PROBE typed HiShawn9 -> hishawn "It's yours!" disabled: false
PROBE prefilled digits: 01
PROBE digits 84: "Digits taken. Try again." disabled: true
PROBE digits 85: null disabled: false
PROBE short name disabled: true
PROBE file keys: version,username,accountHex,profile,mnemonicEncrypted plaintext absent: true
PROBE roundtrip ok: true
PROBE second launch text: "Polkadot Chat Web\n\nprobeuser.01\n\nChats\nRequests\nSearch\nSettings\nConnecting…\nChats\n\nNo chats yet. Find someone and send a request."
PROBE dexie identity matches saved account: true
```
