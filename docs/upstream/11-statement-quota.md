# Statement quota: never-expiring DM statements fill a chat identity's allowance for ever

Board mission: M3 Protocol foundations

Evidence for two existing board items:

- "chat-spec · Limits — Publish normative statement size and allowance floors"
- "individuality · Resources — Validate max_count sizing for always-on bots"

This issue gives the evidence and three asks. It does not replace the two items.

## Problem

- The base spec permits `ExpirationTime = u32.max` for chat statements. The shared SDK pins the expiry high word to 0xFFFFFFFF, "matching iOS & Android". Polkadot Desktop and the web client use that allocator. So the reference desktop, the web client and the SDK write never-expiring chat statements. The phones do too, by the SDK's own comment (we did not read the phone code for this).
- The store replaces a statement only with one of strictly greater expiry. So the owner can never free a never-expiring channel statement. The SDK has no remove call.
- A chat identity has a fixed allowance of live statements. Each DM peer holds up to 2 of them for ever (request and response channels).
- The result: after about 25 peers, a chat identity cannot submit anything new. Group posts, a new chat or a bot card fail with `AccountFull`. No reference client handles `AccountFull` in chat.
- **The phones share the same ceiling.** They use the same expiry, so every phone identity fills by the same arithmetic. A person on Paseo People gets 200 statements, so the ceiling is about 100 peer devices (arithmetic; not measured on a phone).

## What we measured (devnet, 2026-09-24)

- **Allowance.** The identity backend's attestation (`Resources.Consumers`) grants `:statement_allowance:<account>` = **50 statements and 512,000 bytes** live per chat identity. Nothing else grants it. (Persons on Paseo People: 200 statements and 1 MiB, from the runtime parameters.)
- **Slots used.** A DM peer holds up to 2 statements, a v2 group 1–3, a bot's heartbeat 1, a directory card 1 (proposal 08).
- **Live failure.** Busy test identities could not post in any group: `AccountFull`. Their DM statements filled the allowance. Each e2e run's new group took a 14-day slot, so our test identities filled one after another. We now claim fresh identities for each run.
- **Per device, not per peer.** With mds, sessions are per device, so a slot is used per peer **device** (our reading of mds.md; not measured separately). A person with a phone and a desktop costs a bot twice. This bears on `max_count` sizing for always-on bots, which talk to many peers.
- **Timing.** The allowance arrives 20–65 s after registration. A submission before that fails with `noAllowance`. pca's 9 s retry was too short. On 2026-09-24 most new identities took 27–49 minutes to be attested (24 claims measured: 1,610–2,956 s).
- **Size.** The node accepts statements up to 1,048,575 bytes, but the allowance (512,000 bytes) is the real limit. An MLS Welcome at 1024 members (255 KB) would use half of it (proposal 06).

Numbers and sources: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/efficiency.md ("Allowance facts", "Quota facts checked against the reference clients")

## What a client can do alone (not enough)

- **Slot garbage collection is impossible.** Our first idea: when an ACKed DM channel is idle, replace its slot with a short-expiry statement so it frees itself. The store refuses a replacement with a lower expiry, so a never-expiring slot cannot be replaced by a short one.
- **A finite expiry for NEW channels only.** The spec permits it. Existing channels stay full. And a finite expiry has its own cost: a message the peer did not fetch in time is gone (the base spec's reason for `u32.max`).
- **A piggybacked ACK** (proposal 10) would halve the slots per peer. It moves the ceiling; it does not remove it.

## The three asks

1. **A finite recommended chat expiry** in the spec, so that acknowledged DM statements free their slot. The base spec's own TODO points the same way: "Channels as resource: reuse channels if messages in it acknowledged" (line 1).
2. **Owner-removable statements** in the Statement Store (a remove call, or an expiry the owner may lower), so a client can free a slot it no longer needs.
3. **A larger allowance for chat identities**, sized from the arithmetic: slots per peer device × expected peer devices, plus groups, a heartbeat for bots and a directory card.

## Cost of the asks

- Ask 1: 0 extra submissions if the expiry is chosen well. More re-sends if it is too short. How short is safe depends on how long a peer may stay offline: **no data**.
- Ask 2: 1 submission per freed slot, only when the account is near full.
- Ask 3: more live statements per identity in every node's store. The store size cost per statement: **not measured**.

## What it gives the user

- A person can keep chatting with new people, and keep posting in groups, after their 25th contact.
- Bots can serve many people without running out of slots.
- A clear error instead of a silent failure when an account is full.

## Clients that do not support it

- A finite expiry is already allowed by the base spec. Old clients keep `u32.max` and keep filling up.
- Owner removal is a store change. A client that does not use it loses nothing.
- A larger allowance needs no client change.

## Open decisions

1. **Recommended expiry.** What expiry should the spec recommend for a chat statement that the peer has acknowledged? Choose a value (for example 14 days, as our groups use).
2. **Removal.** Should the Statement Store let an owner remove a statement or lower its expiry? Yes / no.
3. **Allowance.** Is 50 statements / 512,000 bytes the intended production value for a chat identity? Yes / no; if no, what value?
4. **`AccountFull` in the UI.** Should the spec say that a client shows `AccountFull` to the user? Yes / no.

Status: Finding; no wire change built. Found in polkadot-chat-desktop review e29c34f (M16), allowance probe 8c08e1b, reference-client check 4b21eb9; fresh test identities b5cbe5d. polkadot-chat-agents branch `desktop/rfc-0003` b8b9fc4.

Decision wanted: answer the open decisions, then adopt, adopt with changes, or reject. React 👍/👎 or comment.
