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

## M8 (2026-09-23)

- **The guide bot does not name the label.** `npm run e2e:buttons` received the keyboard and sent the press. The bot answered "Colour of the day" with "Emerald — #50C878" and, in a second run, "Tangerine — #F28500". Step 6 needs a reply that names the label, so the run ends `E2E_TIMEOUT press reply` (exit 4). Should the pca brain name the pressed button, or should the e2e accept any non-status reply after the press? Meanwhile: the e2e is as written.
- **The guide bot's greeting was an error text** in both runs: "Sorry — I couldn't reach my agent just now. Please try again in a moment." This came right after the bots restarted at 15:20; `menu` was answered normally. Please check the pca brain connection at start-up.
- **Over-limit keyboards: truncate or reject?** The desktop keeps 8×4 and cuts labels at 40 characters (step 2). The pca decoder rejects the whole message (docs/spec/vectors-0006.md "Decoder rules"). Which rule goes into spec 0006?
- **`edit` of a buttons message.** The spec says an `edited` MAY replace `rows`, but the base `edit` content carries only text and attachments. The desktop replaces the text and keeps the rows. Does spec 0006 need an `editButtons` kind, or a rows field on `edit`?
- **Spec text vs ruling on unknown actions.** Spec 0006 still says "An unknown `Action` variant MUST render as a disabled button". The coordinator ruled that it is an unsupported message (no length prefix). Should the spec text change, or should `Action` get a length prefix so that old clients can skip new variants?

## M9 (2026-09-23)

- **Spec 0005 still has the evidence rule.** Its Summary and "Compatibility" section say a client MUST NOT send `typing` or `seen` before evidence. The development-mode rule in `docs/spec/README.md` (newer) says to send freely, and M9 says "No gating". I followed the README and M9. Should the 0005 text be updated to point at the README rule?
- **Seen default for people.** Spec 0005 proposes read receipts off for people and on for bots; M9 step 4 says on for everyone. I used on (one switch, Settings → Chat). Is a per-peer default (off for people) wanted before an upstream submission?
- **Seen tick on the tonal themes.** `text-fg-link` is readable on both Berlin bubbles (3.75:1 and 3.20:1), but on Lisbon, Malta and Tokyo `fg-link` equals the outgoing bubble colour. The app offers only the Berlin themes now. If tonal themes come, which token should the seen tick use there?
- **`seen` for an unknown `upTo`.** The spec text says it "is applied to messages with a lower timestamp than the latest known and the rest deferred". Without the row, the receiver cannot know the timestamp of `upTo`, so M9 defers the whole receipt (step 2). Should the spec carry the `upTo` message's timestamp in `SeenContent`, so the receiver can apply it at once?
- **pcdpirate.81 fails on an empty request opener.** In both e2e runs the bot answered our empty opener with "Sorry — I couldn't reach my agent just now…" (bot log `BOT_AI_FAILED`: "No deferred tool marker found in the resumed session"). The question after it was answered normally. It is a pca brain issue, not a protocol one; should pca skip the brain for an empty opener?

## M10 (2026-09-23)

- **Who gets the automatic `/start`?** Before a peer sends `botInfo`, nothing on the wire says it is a bot. I send `/start` only to a peer that sent content on the identity channel (pca bots send their welcome text there; phones do not), once per peer. An older bot that answers only on the device session gets no `/start`. Is this sign good enough, or should the owner pick another (for example: never automatic, a "Start" button in the room instead)?
- **Which network does the Faucet fund?** The button opens the Paseo faucet for Asset Hub (`parachain=1000`), as M10 step 6 says, and the Faucet's line says "Test funds for devnet". The app's devnet profile uses Paseo People endpoints. Are Paseo Asset Hub funds the ones devnet payments and contracts (M11) will use, or does devnet need its own faucet (for example the summit faucet, chain 1500)?
- **Faucet room without a composer.** The Faucet has only its keyboard; typing there would go nowhere, so the room shows "The Faucet has no chat. Use the buttons above." instead of a field. Keep it, or give the Faucet a composer with local commands later?

## M11 (2026-09-23)

- **`docs/spec/kinds.md` still says kind 245 is "reserved (M11)"**, and `docs/spec/README.md` does not list 0007 as implemented. I may not edit `docs/spec/*.md`. Please update both: 245 `transactionReference` implemented in desktop M11 and pca `4812bd7`.
- **Meter price and contract are constants in the app** (`src/shared/meter.ts`, from meter.md: 0.1 PAS per reply, contract `0x30b0…cf21`). If the bot's `BOT_METER_PRICE` changes, the header's "~N replies" is wrong. Should the bot publish its contract and price (for example in `botInfo`, or a `balance:` reference with the price), so the client needs no constants?
- **`AutoMap` is on for devnet Asset Hub.** New accounts are mapped on creation, so `map_account` is never prepended for them. The rule and the check stay (for runtimes without AutoMap). Is that what you want, or should the app skip the mapping check when `Revive.AutoMap` is true?
- **The faucet's 10-minute limit.** `npm run e2e:meter` drips to the e2e identity each run; a second run inside 10 minutes ends `DRIP_REFUSED` (exit 11), not a timeout. Should the e2e accept a recent drip (the account already funded) as a pass?

## M11b (2026-09-23)

- **Header line wording.** M11b step 1 says `label: value unit (~N replies)`; with pcdmeter's label that reads "with Meter: 2.4 PAS (~24 replies)". The roadmap's example is "0.8 PAS with Meter · ~4 replies" (value first, label after). I followed the milestone. Should the spec say which order, or should pcdmeter's label become a noun ("Prepaid")?
- **`docs/spec/README.md` and `kinds.md`** do not yet say that 0008 v2 (`balance` hint) is implemented (desktop M11b, pca `061b470`). I may not edit `docs/spec/*.md`.
- **Stakes left open in Flip.** The contract is global and `refund()` is owner-only after one hour. A stake left by a crashed run (or by anyone) pairs with the next person's stake. `e2e:flip` clears a stranger's stake with one extra stake. Should the bot show "someone is waiting" (the `pending()` view) before a person stakes?
- **The faucet refuses two drips at once.** In the first flip run both identities asked `pcdfaucet.77` within the same second; one answer was "The transfer did not go through". `e2e:flip` now asks again after a pause. A nonce clash in the bot (two transfers from `//Alice` in one block)? That is a pca fix, not a client one.

## M12 (2026-09-23)

- **`docs/spec/kinds.md` and `docs/spec/README.md`** still say 246/247/248 are "M12" and 0009 is a draft. I may not edit `docs/spec/*.md`. Please mark them implemented (desktop M12, pca `desktop/rfc-0003`).
- **Reactions by several members.** The client stores a reaction as `me` or `peer`; in a group two members with the same emoji show as one. Is a per-account reaction list (a schema change for all rooms) wanted in v1?
- **`tx` buttons in groups.** Not pressable in v1 (see docs/decisions.md). Should a bot in a group send `tx` buttons at all, or only in 1:1 chats?

## M12c (2026-09-23)

- **Status 0, then the end state?** Spec 0007 rule 3 says one reference per transaction, status 0 "only if no block includes the transaction within 30 s". I send status 0 at 30 s and the end state (1 or 3) when it comes, as pca's meter does, so a slow transaction costs two references. Should status 0 be the only reference in that case (the peer then follows the chain), or is the pair intended?
- **Acknowledgements are half the cost.** Every batch a client reads is answered with a session response statement, so a back-and-forth costs about one request plus one acknowledgement per message (the e2e run shows 2 acknowledgements next to 2 submissions for one question and its reply). The ratio in Settings leaves them out, as the milestone's arithmetic does, and shows them on their own line. Should the budget count them, and is a protocol change (for example an ACK that rides the next request) on the roadmap?
- **Everyone's typing is now off.** The new setting uses a new key, so users who had the M9 switch on (the default) are off after this update. I read the owner's "cut now" that way. Correct?
- **`seen` rides any content, not only a message.** A reaction, an edit or a button press inside the 5 s window also takes the pending `seen` along (it is a submission anyway). The spec says "a real message". Fine to read it as any content?
- **Polkadot.js Apps and accounts.** It has no page for one account, so the Pocket's "View on Polkadot.js Apps" is disabled with a reason. Should it open something else (for example the chain state page), or is disabled right?
- **The Pocket's Copy button** has the same "Copied" that never resets. It was not in the owner's report; fix it the same way in a later milestone?
- **Step 10 is only in docs/decisions.md.** I could not append it to `docs/milestones/M12c.md` (AGENTS.md forbids edits there and the edit was refused). Please add it there if the milestone file should be complete.

## M12d (2026-09-24)

- **What machine was the recording on?** On this Mac the old code shows no long task at normal CPU speed; the stalls show at 4x and 6x CPU throttling (5 and 68 long tasks). After the change there are none at 1x, 4x or 6x. If the owner's machine is fast, the choppiness in the recording came mostly from the restarted reveal and the re-rendered room; please say if a stall remains on the owner's machine.

## M12e (2026-09-24)

- **A late accept after Withdraw is not seen.** Withdraw closes the channel that listens for the accept, so if the peer accepts later, this device never learns it and the peer's messages have no session to arrive on; a new chat needs a new request from either side. The roadmap says "if the peer accepts later, the chat comes back as a fresh request". Keeping a listener open after a withdraw would cost the acknowledgements the owner wanted to stop. Is "not seen" acceptable, or should a withdrawn request keep listening (at the cost of one acknowledgement per statement the peer sends)?
- **Delete keeps the contact.** After Delete chat, the contact row and its session stay, so the peer's next message brings the chat back (as the milestone asks). The person stays in the contact list that the "New group" view and the members panel use. Should Delete also remove the contact (and its session), so only a new request brings them back?
- **A blocked peer's messages are still acknowledged.** The drop happens after the SDK session has read and acknowledged the batch, so the blocked peer sees its messages as delivered. Hiding that would need the session to stop listening to that peer (a transport change). Is the acknowledgement acceptable for a local block? The roadmap's synced deny list (mds) is not in this milestone.
- **Archive and a new message.** An archived chat stays archived when a message arrives (its unread still reaches the badge). Telegram brings an unmuted archived chat back. Which one?
- **Pinned chats sit under the Assistant and the Faucet.** The two local rows stay first, as before. Should pinned chats go above them?
- **Forward to the Assistant** is not offered (the Assistant's rows are not sent through the chat manager, and a forward into it would start an engine turn). Wanted?

## Morning review (coordinator, 2026-09-24 night)

- **QUOTA, top item.** Live: identities that chatted with ~25 peers cannot post in any v2 group (`AccountFull`; 50-statement allowance, DM statements never expire). Decide: client-side slot GC (replace ACKed idle DM slots with short-expiry statements, lazily near the limit) and/or an upstream ask for a finite DM expiry and a larger allowance. See docs/review/M16.md.


- **pcdmeter seed in a transcript.** Owner ruling 2026-09-24: testnet dev and bot account seeds are not a concern; no rotation needed.
- **Failed turns are charged** by pcdmeter ("Sorry — I couldn't reach my agent" cost 0.1 PAS). Queued for the pca fix round: charge only when the brain produced an answer.
- **Groups v2 defaults** (see `docs/review/0011-groups-v2.md`): level 1 now, cap 256, history on request. Overrule if you disagree.
- **M12e defaults**: delete keeps the contact; withdraw stops listening; blocked peers still see "delivered" (store ACK).

## M12f (2026-09-24)

- **Spec 0008 text.** The Recipient rule says "latest `version` wins". With v3 the bot resends the same version with a new `pending`, so the client must let an equal version replace the stored one (vectors-0008c says this; I cannot edit `docs/spec/*.md`). Please change the spec text to "a `version` ≥ the stored one replaces it".
- **A short dip after a charge.** The charge can show in a best block a few seconds before the statement with the charge's reference and the botInfo with pending 0 arrives. In that window the header shows `new balance − old pending` (too low, never below 0). A fix would need the bot to tell the charged amount ahead of the block, or the client to hide the number while a charge is known to be in flight. Is the short dip acceptable?
- **Forward to the Assistant does not open the Assistant.** The toast says "Sent to the Assistant" and the reply streams in its room. Should the forward also open the Assistant room, so the answer is seen at once?

## M12g (2026-09-24)

- **Spec 0007 text.** Please add the two note conventions to spec 0007 (I cannot edit `docs/spec/*.md`): a request's payment starts its `note` with `req:<request messageId>`, then a space and the words; a direct send's note is `Sent <amount> PAS[ · <words>]`. pca bots that answer a request would need the same rule.
- **The incoming send's amount is the note's.** "bob.02 sent you 1 PAS" reads the amount from the note (the peer's claim), as every reference shows its note. Only a request's "Paid" is checked on the chain. Should the incoming send bubble also wait for the chain check (one more `transfersOf` per incoming send)?
- **The existential-deposit rule now applies to every signed intent**, bot buttons too: a Meter top-up that would leave less than 0.01 PAS is refused before the chain's test. I think this is right (no transaction of this app should reap the account). Agree?
- **A second payment of the same request.** Pay turns "Paid" and disabled once our own reference is in a block, so this client cannot pay twice. A second device of the payer, or a phone, could. The requester then shows "Paid" once; the second transfer is a plain reference bubble. Is that enough for v1?
- **The tx button's label repeats the amount.** "Pay 0.5 PAS" plus the spec 0007 caption "0.5 PAS". The milestone names the label "Pay 1 PAS" and the rules ask for the amount beside the label. Keep both, or label the request button "Pay"?
- **M12g code landed in other commits.** The M12i agent worked in the same working tree at the same time. I had staged only M12g hunks; its two commits took my staged index with them: b9b0c88 ("M12i: …") holds my hunks in `ipc.ts`, `preload/index.ts`, `desktop-api.ts`, `Shell.tsx`, `package.json`, `screenshots.mjs`, `decisions.md`, `questions.md`, and 88043de ("review M12i: …") holds the rest of the M12g code. Both were on origin/main already, so I did not rewrite them; the `M12g:` commit holds the acceptance section and this note. Two agents in one working tree cannot keep their commits apart: please give each agent its own worktree.

## M12i (2026-09-24)

- **Tags.** I tagged pirate and guide `assistant`, meter `payments`, flip `game`, and faucet, echo and colour `utility`. The milestone gives the taglines but not the tags. Change any?
- **The step shows once.** The mark is cleared when "Meet the demo bots" opens, so quitting during the step does not bring it back. Settings › Demo has the same button. Is once right, or should it come back until the person presses Start or Skip?
- **Two wordings for one pending request.** The demo row says "Sent" for 15 s and then "No answer yet"; the chat list row (M12e) says "No answer yet · sent just now" from the first second. Should the chat list also say "Sent" for the first seconds?
- **Remove demo chats keeps the contacts** (M12e delete). A later "Start chat" then sends "Hi!" as a message, not a request. Should "Remove" also forget the contacts, so the next start is a fresh request?

## M12h (2026-09-24)

- **room-buttons without the spinner.** The callback press would send a `buttonPress` to the fixture bot's made-up device, so the shot shows the keyboard and the url strip only. Is the spinner state still wanted in the set? It would need a live peer again (a fourth live flow).
- **An incoming send that the chain does not show.** After the chain read, a send whose transfer is not in that extrinsic reads "bob.02 sent you 0.1 PAS · not found on the chain". Is that wording right, or should the bubble say less (for example only "not confirmed")?
- **The flip's second stake failed once** with `Revive.StorageDepositLimitExhausted` after its dry-run passed (run 2 in docs/acceptance.md "## M12h"). It left our stake waiting; the script now settles such a round first. My guess, not proved: the second player's dry-run ran on a node that did not have our stake yet, so its storage deposit limit fit the "first staker" path. A pca/contract item?
- **room-tx-done alone takes about 18 s**, 14 s of them the first Asset Hub connection for the header's Meter balance. Other fixture shots take about 3.5 s. Keep the balance in that shot (it proves the hint), or take it from room-meter only?
- **Spec 0006 text.** Over-limit keyboards are now rejected (M8 review). Please state "reject" in spec 0006 (I cannot edit `docs/spec/*.md`).
## M13 (2026-09-24)

- **The agent's seed reaches bot-core through its environment.** The mnemonic is stored with `safeStorage` like the person's, but bot-core reads its key only from `BOT_SEED_HEX`, so the main process puts the mini-secret into the utility process's environment at each start. Another process of the same macOS user can read a process's environment. bot-core also keeps its own random device X25519 key and its session keys in `<userData>/agent/bot-core/session-state.json` (mode 0600 in a 0700 folder), as pca does on the VPS. Is that acceptable for v1, or should pca take the seed on stdin / a pipe and encrypt its state file (a pca change)?
- **Seen with a slow engine costs a second submission.** bot-core holds a seen 5 s for a reply to ride on (SEEN_INTERVAL_MS, not configurable). The fake engine answers at once, so e2e:agent measures one submission per reply; with the real proxy an answer took about 10 s and the seen went alone first (2 submissions for that reply, run in acceptance). efficiency.md allows this ("else 1 per read session"), but "one submission per reply" does not hold for real engines. Should bots hold the seen until the turn ends (a pca change), or drop the seen for agents entirely?
- **`noAllowance` from a fresh agent identity.** In one real-proxy run the new agent's fourth or fifth statement (a bot-core ingress heartbeat, then the answer and the seen) was refused with `statement_submit rejected: noAllowance`, and the answer never went out. Other runs of the same flow were fine. I do not know the devnet allowance rule for a new lite person (a count? a period?). Does bot-core's ingress heartbeat submit statements that count against the same allowance, and should a desktop agent turn it off?
- **The M12h agent's app was driven by my first e2e:tools run.** `screenshots.mjs` and my first e2e script used a fixed debugging port; the M12h agent's app was listening on 9337 in its own worktree, and my script typed "Which colour? Give me buttons." into its Assistant room and pressed Send (about 00:17 local). The M13 e2e scripts now pick a free port per launch and check it is free. `screenshots.mjs` (rewritten by M12h meanwhile) still uses fixed ports 9335–9338 unless `PCD_SCREENSHOT_PORT` is set; two agents running it at once can drive each other's apps. I ran it with `PCD_SCREENSHOT_PORT=9451`. Should it pick free ports? Please tell the M12h agent, in case a stray Assistant message shows in its run.
- **Tool argument leniency is not in spec 0006.** The tool path accepts bare-string buttons and a flat row (the proxy's default model sends them). The fenced path accepts the flat row (spec) but not bare strings. Should spec 0006's leniency section name the tool path and bare-string buttons?
- **A directive with no text.** The agent sends "Choose one:" as the buttons message's text when the model wrote none; the Assistant room shows the keyboard under an empty text. Wanted, or a different word?
- **Packaging not checked.** bot-core runs from `node_modules` inside the app (utility process, ESM, its own wasm dependency). `npm run package` and the packaged app were not run for M13 (not in the acceptance list); an asar path problem is possible.
- **/about names the engine** ("I answer with auto/deepseek-v4.1-flash while that app runs"). Fine to show the model name to strangers?
- **Attachments (spec 0012):** phone interop for 1:1 images works only through HOP today. Reviewer recommends both paths (0012 + HOP fallback). Decide (docs/review/0012-attachments.md). Also: who authorizes Bulletin storage for non-persons beyond devnet.

## M16 (2026-09-24)

- **vectors-0011.md (b) prints its AAD one byte long.** It reads `677270` + `01` × 33 + `00000000` (41 bytes). `b"grp" : A : u32 1 : 00` is 40 bytes (`677270` + `01` × 32 + `0100000000`), and only the 40-byte AAD reproduces the sealed `GroupData` of (b), which pca pins; (c) and (j) print 40 bytes. Every other byte of (a)–(j) matches here. The spec pins the 40-byte value with a comment; please correct the vectors file (not edited here: docs/spec is read-only for this agent).
- **Ruling 8 (bot announces `botInfo` in its first carrier) is not in pca 0fa12a2.** The desktop takes a `botInfo` inside a carrier (it describes the sender, as in v1) whenever one comes; nothing waits for it.
- **Epoch keys sit on the `groups` row** as the milestone says, although `database.ts` keeps every other secret in `secrets`. Move them to their own table next to `secrets`?
- **`deviceAdded` in a carrier** (0011 Multi-device, Testing list) is not built in M16: a member's posting accounts come from its contact devices when an admin writes a state. Build it with M16b, or earlier?
- **Welcome from any contact.** A `welcome` for an unknown group is taken from any contact that is not blocked (as a v1 roster was). Should a person's client ask first ("X added you to Y")?
- **Accounts full of DM statements cannot post in any v2 group** (live: pcde2e, pcdeceb). DM statements never expire, so an identity that has talked to many peers is permanently full and every group statement is refused with `AccountFull`. This needs the upstream quota answer (0011 Unresolved 3) or a DM expiry below u32.max. The e2e uses pcdbenchfinb as the admin for now.
