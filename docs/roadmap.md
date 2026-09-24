# Roadmap after v1 (2026-09-23)

Goal: an agent-native, Telegram-quality chat client on Polkadot's encrypted rails. Agents are peers, bots feel like services, an agent can run locally or be published as an on-chain identity.

| # | Milestone | Protocol work | Proof |
|---|---|---|---|
| M7 | Delete for everyone; live bot progress as thinking; typing reveal | RFC-0003 (exists) implemented in desktop + pca | e2e delete round trip; bot logs the deletion |
| M8 | Buttons (moved ahead of typing/seen on 2026-09-23: it is the agent-native differentiator) | spec 0006 drafted; action kinds `command`, `callback`, `url`, reserved `tx` | press a button in the app, the guide bot reacts |
| M9 | Typing and seen | spec 0005 drafted | typing dots while the pirate bot works; seen ticks |
| M10 | Bot info (spec 0008), Faucet chat, composer command menu | kind 244 | the guide bot shows a badge, description, `/` menu; Faucet chat funds a devnet account |
| M11 | `tx` action + transactionReference (spec 0007); contract chats: pay-as-you-go agent, then coin flip (block randomness is acceptable on devnet per the owner; no commit-reveal) | tag 3 payload, kind 245 | prepay a bot and watch the balance drain; two people flip a coin in chat |
| M12 | Groups (spec 0009, fan-out groups: a group id + roster carried on each member's pairwise session; sender fans out; no group key in v1; MLS later) | kinds 246 `groupInfo`, 247 `groupMessage` header | a three-person room with a bot; DAO, staked polls, N-of-M multisig become possible |
| M12c | Submission budget (owner ruling 2026-09-23: cut now, no legacy): typing not sent by default, bots never send it, local "working" for bots; seen rides the next message; one reference per tx; meter charges batched; submissions-per-message diagnostic; devnet propagation probe | 0005, 0007 revised; `efficiency.md` | e2e shows 1 submission per message; probe table |
| M13 | Publish the local agent as an on-chain peer | none | a phone user chats with the desktop's agent |

Decisions (owner, 2026-09-23): the running specification lives in this repo under `docs/spec/`, written as upstream-shaped RFCs as we go, and is sent to `paritytech/chat-spec` only when the owner decides; nothing is pushed to chat-spec meanwhile. `pca` work goes on branches in `polkadot-chat-agents` with the goal of merging later; nothing may break the phone apps, so every extension follows the compatibility rule in `docs/spec/README.md` (receive always, send only after evidence). Provisional kinds 240+ (`docs/spec/kinds.md`); RFC-0003 takes 21 (20 is taken by DeviceChatAccepted).

## Backlog from the landscape review (2026-09-23)

Source: `polkadot-brain/references/blockchain-chat-landscape.md` (XMTP, Farcaster, Towns, Session, Status, DarkFi).

Protocol (into `docs/spec/`):
- **0006 buttons**: add an optional `input` field on a button (Farcaster Frames v1 text input) so a bot can ask for one value without a form.
- **0007 tx action**: model on EIP-5792 `wallet_sendCalls`: a batch of calls plus display metadata (description, amount, asset, kind), `dryRunRequired: true`, chain id; Polkadot payloads are extrinsic call data or a Revive call. Add a **`transactionReference`** kind (XMTP has one): a first-class bubble "landed in block N / failed" with the hash, sent by whoever submitted.
- **Bot manifest (0007b)**: name, description, commands, capabilities, "bot" marker; published under the DotNS name. Serves what XMTP's agent-metadata proposal wants, without a wire kind old clients would choke on.
- **Block list on the protocol**: today decline is local. Add a synced deny list (mds) so a block holds on every device (XIP-42 shape). No wire message to the blocked peer.
- **Ephemeral-kind rule for agents**: bots must never reply to typing/seen/receipt kinds (XMTP's loop lesson). Put it in 0005 and in pca.

Product:
- **Person vs bot badge**: personhood is the stack's edge over fee-gated networks; show it. A verified-person mark from the People-chain record, a bot mark from the manifest.
- **Bot directory**: search results from the manifest registry (DotNS), like Base App's agent listing.
- **Allowance awareness for agents**: bots are lite persons with a statement allowance; show remaining allowance in the Assistant/bot settings and warn before it runs out.
- **Tip / pay quick action on a bot message** (Towns): reuse coinage send with a preset amount.
- **Disappearing messages** (Session/Status): client-enforced TTL on top of RFC-0003 tombstones.
- **Metadata privacy note** (DarkFi): session topics are pairwise hashes on a public store; write down what an observer can infer and what Tor/mixnet transport would add. Research item, not a milestone.
- **Packaging bot-core as an SDK** for third-party agents (XMTP Agent SDK shape): event-driven, middleware, content-type filters. After M11.

## Decisions 2026-09-23 (owner)

- **Identity:** the desktop-owned identity is a temporary measure while the phone app produces accounts with the legacy key type. The target is **"Sign in with Polkadot app"**: the desktop pairs as a device of the phone identity (the V2 pairing flow already in `src/renderer/domain/pairing`), one identity per person. Keep sign-up as a fallback for machines without a phone. Milestone: **M10a Sign in with Polkadot app**, gated on a phone build that writes X25519 keys.
- **Payments for testing:** add a default **Faucet** chat: a built-in contact with a "Get test funds" button (and a `url` button to the public Paseo faucet with the address prefilled where supported), so contract and payment features can be tried on devnet without manual funding. Long-term onboarding for payments is a separate design. Goes into M10 as step 0.
- **Compatibility (revised 2026-09-23):** all apps are in development; extension kinds are sent without gating, unsupported bubbles on old clients are accepted for now, and nothing is pushed to master of existing projects. Retired options kept for the upstream submission: the evidence rule and a capability bitmap in the reserved bytes of the RFC-0004 identifier-key container.

## Balances in the UI (owner ask, 2026-09-23) → M11b

- **Own balance, always visible**: a chip next to the username in the left-pane footer ("12.3 PAS", devnet Asset Hub, best block, refreshed on each block and after a signed tx); click opens a small Pocket panel: per-chain balances, the address with Copy, and a "Get test funds" shortcut to the Faucet chat.
- **Balance in context of the peer** (the part other apps mostly lack): under a bot's name show what is *yours with this bot* — the meter balance ("0.8 PAS with Meter · ~4 replies"), an escrow stake ("your stake 1 PAS · pot 2 PAS" for coin flip), a subscription state. Source: the contract read at best block, declared by the bot's info document (a `balance` hint: contract, calldata template, unit) so the client can render it without bot-specific code.
- **Peer's own wallet balance**: public on chain but not shown by default (it reads as surveillance); available behind "Show account" for people; for a bot/contract, show the contract's total holdings ("pot", "treasury") when the bot declares it.
- Convention elsewhere: Base App and Farcaster keep the personal balance in a wallet tab and show amounts only in transaction bubbles; Towns shows tips and membership prices; Telegram shows Stars/TON only at payment time; the Polkadot phone app has the Pocket tab and "You sent 5 CASH" bubbles. Nobody shows "your balance with this counterparty" — that is the agent-native addition.

## Embedded bots (owner ruling, 2026-09-23)

A bot that ships with the app is embedded in the app: a local contact whose logic runs in the main process, never a separate identity or process the owner has to keep running. Embedded today: Assistant (LLM engines), Faucet (devnet drip signed from the public dev account). On-chain bots (`pca`) are separate identities for anyone on the network; the desktop's own agent becomes one in M13. Embedded bots may later be exposed on chain by that same mechanism, but they never depend on it.

## Structured directives (added 2026-09-23 after the owner saw partial buttons JSON during streaming)

Models produce client directives (buttons, tx intents, bot-info updates) today as a fenced text block that the host parses. Not planned before this: in M13, engines that support tool calling (the proxy engine; any API-backed pca brain) get a `buttons`/`tx` tool generated from the same schema as the parser, so the directive arrives as one validated object and never streams as text. The fenced block stays the fallback for text-only engines (Claude Code, Codex, OpenCode CLIs) and is never required. Wire format unchanged.

## Chat management (owner ask, 2026-09-24) → M12e

Today a room offers mute, block, report, decline (incoming request) and leave (group). Missing, all local to the client unless marked:
1. **Delete chat**: removes the room, its messages and a pending outgoing request from this device. The peer keeps their copy (as Telegram). If the peer accepts later, the chat comes back as a fresh request.
2. **Withdraw a pending request** (the same action on a pending row): stop resubmitting; the statement expires in the store. Show "No answer yet · sent 3 d ago" on pending rows.
3. **Archive** a chat (hidden list, unread still counted).
4. **Pin** chats to the top (max 5).
5. **Mark as unread / mark as read**.
6. **Clear history** (keeps the contact and the session).
7. **Nickname** for a contact (local label; the username stays visible).
8. **Forward** a message to another chat (a copy, "Forwarded from" shown).
9. **Blocked list** in Settings with unblock.
Later: chat folders and an unread filter; export chat; per-chat notification sounds.

## Meter pending debit in the header (owner report, 2026-09-24) → M12f (both repos)

Spec 0008 v3: `pending` on the balance hint, resent with each metered reply in the reply's batch. pca: meter sends it; vector `vectors-0008c.md`. Desktop: decode, header shows `balance − pending` and "0.3 owed", re-read after a charge reference. Also pca: the persisted pending debit (carry from M12c).
