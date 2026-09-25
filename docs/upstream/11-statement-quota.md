# Statement quota: never-expiring DM statements fill a chat identity's allowance

Board mission: M3 Protocol foundations

Status: Found while prototyping in polkadot-chat-desktop (commit b5cbe5d) and polkadot-chat-agents (branch desktop/rfc-0003). No wire change was built.

This issue is evidence for two existing board items, not a new ask:

- "Validate max_count sizing for always-on bots"
- "Publish normative statement size and allowance floors"

## Problem

- The base spec permits `ExpirationTime = u32.max` for chat statements. The shared SDK pins it, "matching iOS & Android". Polkadot Desktop and the web client use that allocator.
- The store rejects a replacement with a lower expiry. So a never-expiring channel statement can never be freed by its owner. The SDK has no remove call.
- A chat identity has a fixed allowance of live statements. Each DM peer holds up to 2 of them for ever.
- The result: after about 25 peers, an identity cannot submit anything new. Group posts, a new chat or a bot card fail with `AccountFull`. No reference client handles `AccountFull` in chat.

## What the prototype measured (devnet, 2026-09-24)

- **Allowance.** The identity backend's attestation grants `:statement_allowance:<account>` = **50 statements and 512,000 bytes** live per chat identity. Nothing else grants it. (Persons on Paseo People: 200 statements / 1 MiB.)
- **Slots used.** A DM peer holds up to 2 statements, a v2 group 1–3, a bot's heartbeat 1.
- **Live failure.** Two busy test identities could not post in any group: `AccountFull`. Their DM statements filled the allowance.
- **Per device, not per peer.** With mds, sessions are per device, so a slot is used per peer **device** (our reading of mds.md; not measured separately). A person with a phone and a desktop costs a bot twice. This bears on the `max_count` sizing for always-on bots, which talk to many peers.
- **Timing.** The allowance arrives 20–65 s after registration. A submission before that fails with `noAllowance`. pca's 9 s retry was too short.
- **Size.** The node accepts statements up to 1,048,575 bytes, but the allowance (512,000 bytes) is the real limit. An MLS Welcome at 1024 members (255 KB) would use half of it.

Numbers and sources: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/efficiency.md ("Allowance facts", "Quota facts")

## What we think the floors should cover

1. **A finite recommended chat expiry** in the spec, so that acknowledged DM statements free their slot. The base spec's TODO "Channels as resource: reuse channels if messages in it acknowledged" points the same way.
2. **Owner-removable statements** (or an owner-lowerable expiry) in the Statement Store, so a client can free a slot it no longer needs.
3. **A larger allowance for chat identities**, sized from the arithmetic above: slots per peer device × expected peer devices, plus groups and a directory card.

## Client-side mitigation (limited)

- A client can choose a finite `ExpirationTime` for NEW channels (the spec permits it). Existing channels stay full.
- Proposed but not built: "slot garbage collection". When an ACKed DM channel is idle and the account is near the limit, replace the slot with a short-expiry statement.

## Clients that do not support it

- A finite expiry is already allowed by the base spec. Old clients keep `u32.max` and keep filling up.
- Owner removal is a store change; clients that do not use it lose nothing.

## Open questions

1. What expiry should the spec recommend for a chat statement that the peer has acknowledged?
2. Is the 50 / 512,000 devnet allowance the intended production value for a chat identity?
3. Should a client surface `AccountFull` to the user, and with what words?

Decision wanted: adopt, adopt with changes, or reject. React 👍/👎 or comment.
