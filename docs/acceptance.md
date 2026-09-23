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

## M2

Run 2026-09-23 on macOS (Apple Silicon), Node v24.13.1. Test peer: the echo bot `pcdpeer.47` on devnet (log `/tmp/pcdpeer.log`).

### `npm run check` (last 12 lines, final code)

```
> tsc --noEmit -p tsconfig.json && vitest run && eslint .


 RUN  v4.1.11 /Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop


 Test Files  25 passed (25)
      Tests  155 passed (155)
   Start at  11:05:57
   Duration  1.03s (transform 1.11s, setup 513ms, import 7.24s, tests 2.35s, environment 1ms)

check exit=0
```

### `npm run e2e:chat -- pcdpeer.47`

Every run of the command is listed, in order. Runs 1–3 are the investigation; the fixes they led to are in docs/decisions.md (M2).

**Run 1 (14:45 UTC): `CHAIN_READ_FAIL best block timed out`.** It registered a new default identity (`pcdeceyxxk.36`). The WS then dropped as stale about 1 ms after every connect (`TimeoutOverflowWarning: Infinity ... set to 1`, `[ws] connected` / `[ws] disconnected` in a loop). Cause: `heartbeatTimeout: Infinity` in `statementStore.ts`. Fixed.

**Run 2 (14:48 UTC): `E2E_OK`, but a false pass.** `REPLY Echo: ` was the bot's answer to the empty request opener, not to the ping. The bot log showed `BOT_SESSION_DECODE_FAILED ... unable to authenticate data` for the ping. Cause: the device encryption key was the identity chat key. Fixed (own device key). The script now waits for the bot's greeting before the ping and prints `REPLY_HAS_NONCE`.

**Run 3 (14:53 UTC): `E2E_TIMEOUT reply`.** The bot now received the ping (`BOT_RECEIVED_TEXT`, `BOT_SENT_TEXT chars 17`), but this app dropped the echo (`dropping an undecodable incoming statement`). Cause: run 1–2's identity was known to the bot with the old device key; bot-core keeps both entries for the one statement account and the SDK unwraps only the first. The identity was moved aside (`.agent-runs/identity-pcde2e-m1layout`, git-ignored), see docs/questions.md.

**Run 4 (14:56 UTC), fresh default identity: `E2E_OK`.**

```

> polkadot-chat-desktop@0.1.0 e2e:chat
> node scripts/e2e-chat.mjs pcdpeer.47

identity register pcdecejakd on devnet
  Creating keys
  Claiming username
  Waiting for the network
  Waiting for the network
  Waiting for the network
  Waiting for the network
  Waiting for the network
identity registered pcdecejakd.11 confirmed=true
SELF 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 pcdecejakd.11
[ws] connecting
[ws] connected
best block #7044445
PEER 0x44195d1bc476ac9c1673ed9b266a929898e98a02d60f141712c5ae8fd819281d key_type=0
REQUEST_SENT
ACCEPTED devices=1
GREETING Echo: 
PING_SENT ping b73b8c
REPLY Echo: ping b73b8c
REPLY_HAS_NONCE yes
E2E_OK
```

Bot log for run 4:

```
{"time":"2026-09-23T14:56:52.610Z","event":"BOT_RECEIVED_OPENER","from":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","requestId":"974d4f9d-c3f5-43bf-9d94-4a5311b5c309","chars":0}
{"time":"2026-09-23T14:56:53.211Z","event":"BOT_SENT_TEXT","to":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","chars":6}
{"time":"2026-09-23T14:56:54.313Z","event":"BOT_RECEIVED_TEXT","from":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","chars":11}
{"time":"2026-09-23T14:56:54.623Z","event":"BOT_SENT_TEXT","to":"dce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653","chars":17}
```

**Run 5 (14:57 UTC), same identity reused: `E2E_OK`.**

```

> polkadot-chat-desktop@0.1.0 e2e:chat
> node scripts/e2e-chat.mjs pcdpeer.47

identity reuse pcdecejakd.11 (/Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop/.agent-runs/identity-pcde2e/identity.json)
SELF 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 pcdecejakd.11
[ws] connecting
[ws] connected
best block #7044457
PEER 0x44195d1bc476ac9c1673ed9b266a929898e98a02d60f141712c5ae8fd819281d key_type=0
REQUEST_SENT
ACCEPTED devices=1
GREETING Echo: 
PING_SENT ping d802be
REPLY Echo: ping d802be
REPLY_HAS_NONCE yes
E2E_OK
```

After run 5 one more domain change landed (`lookup.ts`, found in the GUI check below; the e2e read path does not use it). Then:

**Runs 6–8 (15:06, 15:08, 15:11 UTC), final code: `CHAIN_READ_FAIL identifier lookup timed out after 120000ms`.** The WS stayed connected, the best block arrived, and the first storage read (which waits for the runtime metadata) did not answer within 120 s. No `BOT_` event was logged (no request was sent). Run 8:

```

> polkadot-chat-desktop@0.1.0 e2e:chat
> node scripts/e2e-chat.mjs pcdpeer.47

identity reuse pcdecejakd.11 (/Users/shawntabrizi/Documents/GitHub/polkadot-chat-desktop/.agent-runs/identity-pcde2e/identity.json)
SELF 0xdce64f1a9918e03187650ca7c10ceeaf2efbe98afe028c50aaa1ca05355a4653 pcdecejakd.11
[ws] connecting
[ws] connected
best block #7044758
CHAIN_READ_FAIL identifier lookup timed out after 120000ms
e2e exit=1
```

Investigation: the same read through the app's connection in a scratch script answered in 12–19 s at 15:14–15:16 UTC, from each of the three devnet endpoints (12 s, 26 s, 40 s). A copy of `scripts/e2e-chat.mjs` with one extra log line, run at 15:16 UTC with the final code, passed (`REQUEST_SENT` / `ACCEPTED devices=1` / `GREETING Echo: ` / `PING_SENT ping e293ae` / `REPLY Echo: ping e293ae` / `REPLY_HAS_NONCE yes` / `E2E_OK`; bot log `BOT_RECEIVED_TEXT` 15:16:24.113Z, `BOT_SENT_TEXT chars 17` 15:16:24.459Z). I found no cause in this repo for runs 6–8; slow public nodes at that time are the likely cause. The command was not run again after run 8 (the run limit for this milestone).

### GUI (step 4)

cmux computer use was not available (onboarding not finished), so the built app was driven through the Chrome DevTools protocol: `npx electron out/main/index.js --remote-debugging-port=9333`, DOM clicks and input events. That run uses the `Electron` userData folder, not the `npm run dev` one, so it signed up its own identity; the owner's dev identity (`shawntest.76`) was not used.

1. Sign-up screen: `pcdguiqrst` → "It's yours!" → Get username → "Signed up as pcdguiqrst.08.", tabs shown, "Connected".
2. Search `pcdpeer` → `pcdpeer.47 5DbzeXqY… Send request` (the backend answered 402; the search solved the proof of compute).
3. Send request → first attempt: "pcdpeer.47 has no chat key on the People chain yet." Cause: `lookup.ts` passed an SS58 address where host-papp wants hex. Fixed, rebuilt, restarted: the identity was restored with no sign-up.
4. Send request again → row turns "(contact)" within 8 s. Chats: `pcdpeer.47 … 1 device · 1 unread`, preview `Echo: `.
5. Room: "Chat accepted", "Echo: ". Sent "hello from the desktop gui" → `✓✓`, then "Echo: hello from the desktop gui" (bot log `BOT_RECEIVED_TEXT chars 26`, `BOT_SENT_TEXT chars 32` at 15:05:32Z).

Not checked in the GUI: an incoming request from a person (needs a second client), reactions, edits.

### `git status --short`

Empty after the commit (checked before the report).
