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

## M6 (2026-09-23)

- **Codex is over its spend cap.** `npm run e2e:engines` reaches the Codex CLI, which answers "You hit your spend cap set by the owner of your workspace". The same happens with a plain `codex exec`. Can the cap be raised (or another Codex account logged in) so the run can reach ENGINES_OK?
- **OpenCode's default model is not on the proxy.** `~/.config/opencode/opencode.json` sets `parity-proxy/deepseek-flash`; the LLM proxy has no deployment for `deepseek-flash` (it suggests `auto/deepseek-v4.1-flash`). A plain `opencode run` fails the same way. Should the config's model change, or should the app offer a model field for CLI engines (M6 says model only for the proxy)?
- **Help → README URL.** The repo has no git remote. The menu opens `https://github.com/shawntabrizi/polkadot-chat-desktop#readme`, which I could not verify. What is the right URL?
- **stripToolMarkup misses `<tool_result>` blocks.** Before the tools line was added to the system prompt, Claude (tools off) answered with an invented `<tool_result>…</invoke>` block and a made-up file content; bot-core's `stripToolMarkup` removed only the `</invoke>` and appended its note, so the invented content stayed. The tools line stops this in practice here. The same gap is in `.refs/bot-core` (pca bots). Widen the pattern to `<tool_result>` in both?
- **Native notification banners were not seen** (docs/acceptance.md "Not run"). Please check once in the packaged app that a banner shows and that clicking it opens the room.

## M7 (2026-09-23)

- **RFC-0003 still says kind 20.** The implementation uses 21 (20 is `deviceChatAccepted`), as the coordinator set and as pca does. Should the RFC text in chat-spec change to 21, and should the mobile teams be told before they implement it? Meanwhile: 21 on both sides, with a pinned shared vector.
- **The pca answer is a new message, not an edit.** bot-core's `live-reply.mjs` edits the placeholder into a short "✓ Answered in …" receipt and sends the answer as a new message. Step 6 reveals only an edit that replaces a live frame, so the answer itself appears at once and only the receipt is revealed. Should a new bot message that follows a live frame also be revealed? Meanwhile: as step 6 says.
- **The first pca placeholder is not a live frame.** Its default text is "🤔 One moment — thinking…" (`BOT_THINKING_TEXT`), and it becomes `⏳ …` only at the first progress frame. So the first seconds show a normal bubble. Should pca start with `⏳ `, or should the app also match the thinking text? Meanwhile: only `⏳ ` matches.
- **The chat list shows the raw frame** ("⏳working · 12s · step 2 ▸ Readin…", seen in room.png). Should the list say "Working…" for a live frame? Meanwhile: unchanged (M7 does not ask).
- **Quit inside the Undo time.** If the app quits within 6 s of "Delete for everyone", nothing is sent and the message stays after the restart. Acceptable, or should the pending deletion be persisted?

## M7b (2026-09-23)

- **Reply rows are not searched.** Step 1c says "text and richText rows", so a reply's text does not show under Messages. Should replies be searched too? It is a one-line change in `searchMessages`. Meanwhile: as written.
- **Keep or clear the search after a pick?** I keep the results until Esc (Telegram Desktop), except for Recent picks and a sent request. The phone app leaves the search when a result opens. Which one do you want?
- **Search reliability on devnet.** In three of eight screenshot runs a search failed: twice the searches stayed at "Searching…" for 60 s, and once "Show more" added no rows. All three runs had the window visible; the headless run after the fix passed. A plain `curl` a minute later answered in 0.4 s. The 15 s limit now ends such a search with "Search unavailable". I did not find the backend's rate-limit numbers. Is there a documented limit per IP?
