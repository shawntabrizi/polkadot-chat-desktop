# Roadmap after v1 (2026-09-23)

Goal: an agent-native, Telegram-quality chat client on Polkadot's encrypted rails. Agents are peers, bots feel like services, an agent can run locally or be published as an on-chain identity.

| # | Milestone | Protocol work | Proof |
|---|---|---|---|
| M7 | Delete for everyone; live bot progress as thinking; typing reveal | RFC-0003 (exists) implemented in desktop + pca | e2e delete round trip; bot logs the deletion |
| M8 | Buttons (moved ahead of typing/seen on 2026-09-23: it is the agent-native differentiator) | spec 0006 drafted; action kinds `command`, `callback`, `url`, reserved `tx` | press a button in the app, the guide bot reacts |
| M9 | Typing and seen | spec 0005 drafted | typing dots while the pirate bot works; seen ticks |
| M10 | Bot manifest by DotNS name; contract bot MVP | app convention; `tx` action kind used for contract calls | a contract appears as a chat with read and call buttons |
| M11 | Publish the local agent as an on-chain peer | none | a phone user chats with the desktop's agent |

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
