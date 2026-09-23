# Questions for the owner

Write the question, what you did meanwhile, and the date.

## M0 (2026-09-23)

- **electron-vite beta.** The stable `electron-vite@5.0.0` does not accept vite 8, which the web client's `@vitejs/plugin-react@6.1.1` needs. I pinned `electron-vite@6.0.0-beta.1`. Is a beta acceptable, or do you prefer 5.0.0 with vite 7.3.6 and plugin-react 5.2.0?
- **`timeout` is not installed on this machine.** `docs/milestones/M0.check.sh` (and M1–M4) runs `timeout 180 npm run smoke`. macOS has no `timeout` (and no `gtimeout` here), so the smoke step of the check fails with "command not found" even though `npm run smoke` prints `SMOKE_OK`. I did not change the check scripts. Options: `brew install coreutils` and use `gtimeout`, or a bash fallback in the check scripts.

## M1 (2026-09-23)

- **Digits in test usernames.** The backend (and `normalizeUsername`) takes letters only, but the acceptance command uses `pcdtest<4 digits>` and `M1.check.sh` uses `pcdrev$RANDOM`. The script spells the digits as letters (`pcdtest9080` → `pcdtestjaia`) and says so in a `note:` line. Would you rather have the check names be letters only (for example a random letter suffix)?
- **Logout for an owned identity.** Settings still has "Log out" from the paired web client. With the identity owned by this machine, logout now clears the local chat rows and the app re-seeds them at once, so it does nothing visible. Should logout go away, or become "delete this identity from this computer" (which loses the name, as there is no backup in v1)?
- **Settings labels.** Settings still says "Paired", "Phone device" and "Paired at". For a self-owned identity the phone rows show this device's own keys. I did not change Settings in M1 (not in the step list). Change it in a later milestone?

## M2 (2026-09-23)

- **Stale device entries at bot-core.** An identity that chatted with a bot under the M1 key layout (device key = chat key) and later with its own device key is known to bot-core with two devices for one statement account. bot-core wraps its reply for both. The statement-store SDK's `unwrapForOwnDevice` takes only the first entry for our account, so every reply is dropped. The e2e hit this with its first test identity; I moved that identity aside and registered a new one. No real user has the M1 layout (M1 had no chat), so I did nothing more. Should the SDK try every entry addressed to this account (as `unwrapOwn` already does), or should the app send `deviceRemoved` for the old key? That is an upstream question.
- **Owner identity in the dev userData.** `~/Library/Application Support/polkadot-chat-desktop/identity.json` holds `shawntest.76` (created 14:42 UTC today). I did not use it. The GUI check ran the built app, whose userData is `~/Library/Application Support/Electron`, and signed up `pcdguiqrst.08` there. Delete that test identity when you like.
- **e2e flakiness on public nodes.** Three final runs failed at the first storage read (120 s, no metadata), while the same read answered in 12–40 s in probes minutes later and a copy of the script passed. Should the e2e fall back to the next endpoint when the first read times out, or is a slow node an acceptable reviewer retry?

## M3 (2026-09-23)

- **Metadata cache file name.** Step 1a says `<userData>/metadata/<genesis>.bin`. I used `<codeHash>.bin`: polkadot-api hands the cache the runtime code hash, bot-core keys by it, and a genesis key would keep serving old metadata after a runtime upgrade. Keep the code hash?
- **Packaged app and dev share a profile.** The packaged app is named `polkadot-chat-desktop` (package.json `name`), like `npm run dev`, so it opens the identity in `~/Library/Application Support/polkadot-chat-desktop` (your `shawntest.76`). Because the dmg is unsigned and the keychain entry was made by the dev Electron binary, macOS will ask once for keychain access when the packaged app first reads the identity ("Always Allow" ends it). I did not start the packaged app against that profile. Do you want this, or a separate profile for the packaged app (set `productName: "Polkadot Chat"` in package.json; then the installed app starts at sign-up with its own keychain entry)?

## M4 (2026-09-23)

- **Markdown in contact rooms.** Only Assistant replies render as markdown. Bots (`pca`) also write markdown. Should incoming messages from contacts render as markdown too? It is a small change in `Room.tsx`, with the same sanitizer.
- **Streaming granularity.** With `auto/deepseek-v4.1-flash` the proxy sends the answer in few, large content deltas (2 for "proxy ok", after about 8 s of reasoning deltas that are not shown). The app shows "Thinking…" during the reasoning. Should the reasoning be shown (for example, dimmed), or is "Thinking…" enough?

## M5 (2026-09-23)

- **pcdpeer.47 crashed during the screenshots.** At 16:43 UTC, right after it echoed the Berlin Day "hello" and got a 👍 reaction, the bot died with `TypeError: Cannot read properties of null (reading 'extensions')` at `polkadot-chat-agents/lib/outbound-lanes.mjs:179` (`/tmp/pcdpeer.log`). I did not restart it. The final room.png files show a chat with the test identity `pcdtestjaia.98` instead (`PCD_SCREENSHOT_ROOM_WITH`); the live bot room in Berlin Day is kept at `.agent-runs/screens/berlin-day/room-bot-pcdpeer47.png`. The crash looks like a bot-side bug in the outbound lane code; please restart the bot and check that file.
- **Settings shows Lisbon, Malta and Tokyo** (step 8 asks for the five themes). references/shadcn.md says to review in Lisbon, since `text-primary`-style mistakes only show there; the screenshots cover Berlin Day and Night only, as step 11 asks. Do you want Lisbon screenshots too?
- **Reset quit inside the grace period.** If the app quits within 10 s of "Reset identity", the next start restores the identity (the renderer may not have wiped its database). If it quits between 8 s (database wiped) and 10 s, the identity comes back with no chats. Acceptable, or should the renderer confirm the wipe to main (a third IPC call, which M5 did not allow)?
- **Contrast of the step-5 tick colour.** `text-fg-tertiary-inverted` on the inverted bubble is faint in both themes. I kept it for the ticks as step 5 says and used `text-fg-secondary-inverted` for the time. Use secondary for the ticks as well?
