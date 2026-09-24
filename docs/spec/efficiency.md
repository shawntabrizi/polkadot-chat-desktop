# Efficiency budget for extensions (2026-09-23)

The shared cost of the Statement Store is **submissions**: every submitted statement is validated and gossiped to every node. Storage is bounded (one slot per sender and channel, replaced on resubmission, expiring), and per-person bandwidth is capped by the personhood allowance. So:

**Rule.** A new content kind may add bytes to a statement that would be submitted anyway. It MUST NOT add submissions unless it replaces a user action that would have been a submission. Every RFC in this folder states its submission cost.

| Kind | Submission cost | Status |
|---|---|---|
| deleted (21) | 0 (rides in the batch; pre-delivery removal shrinks it) | fine |
| buttons / buttonPress (242/243) | 0 beyond the message | fine |
| botInfo (244) | 1 per peer per version, then 0 | fine |
| transactionReference (245) | 1 per tx (in block or failed; submitted only after 30 s; finalized derived from the chain) | revised 2026-09-23 in 0007 |
| typing (240) | 0 by default: not sent; bots never send it; the client infers "working" for a known bot locally. Opt-in: ≤ 1 per 10 s | revised 2026-09-23 in 0005 (owner: cut now, no legacy) |
| seen (241) | 0 in a back-and-forth (rides the next message within 5 s); else 1 per read session | revised 2026-09-23 in 0005 |
| groupMessage (247) | n−1 per message for n members | temporary (v1); cap 16; v2 = one submission on a group topic with a shared key (MLS, as t3ams) |
| Meter charges (not wire; chain) | 1 Asset Hub extrinsic per 5 metered replies or 10 min, whichever first, plus one reference statement per charge; the header shows the on-chain balance, `/balance` shows balance minus the pending debit | implemented in pca c488a31 (M12c) |

Base-protocol cost noted 2026-09-24: every fetched batch is acknowledged with one submission (the base spec's ACK), so a back-and-forth costs about two submissions per message, one from each side; the desktop Diagnostics counts these. A piggybacked ACK (the ACK riding the next outgoing statement) is an upstream question for chat-spec.

Reference points: a person's 1:1 chat sends roughly one statement per message; pca live placeholders now start only after 20 s; the base spec's request extension already batches every un-ACKed message into one statement.

Owner's question that produced this page: "are we keeping the protocol efficient? this must scale to lots of people on shared infra."

## Cost tiers (owner ruling 2026-09-23)

1. **Free**: rides in a message that goes anyway. Buttons, deletion, bot info, reactions, edits.
2. **One per event**: seen (when not piggybacked), transaction references.
3. **Many per message**: typing, live streaming. Tier 3 features MUST be opt-in and MUST have a no-wire design (for example the local "working" state) that covers the common case.

The owner's rule: decide by arithmetic now, while no client in the field sends these kinds; a cut later needs everyone to update.

## Measurement (M12c)

- The desktop counts submissions and messages sent per session and shows the ratio in Settings › Diagnostics ("submissions per message").
- `scripts/probe-statements.mjs` submits statements from a test identity at rising rates on devnet and reports propagation time to a second client (p50/p95) and any rejection, so the Statement Store's practical ceiling is a number, not a guess.

## Allowance facts (pca finding 2026-09-24, devnet)

A chat identity's statement allowance is set by the identity backend's attestation (`Resources.Consumers`): `:statement_allowance:<account>` = 50 statements and 512 000 bytes live per account; nothing else grants it. It arrives 20–65 s after registration; submissions before that are rejected with `noAllowance` (a client must wait for `Consumers` before its first submit; bot-core's 9 s retry was too short). The allowance caps live statements, not submissions per hour: a DM peer holds up to 2, a v2 group 1–3, a bot's heartbeat 1. So a chat identity on devnet is limited to about 25 active DM peers today (persons on Paseo People: 200 / 1 MiB). Heartbeat default lowered from 30 s to 120 s (120 → 30 submissions per hour per bot).

## Quota facts checked against the reference clients (2026-09-24)

The base spec permits a never-expiring chat statement; the shared SDK pins the expiry high word to 0xFFFFFFFF "matching iOS & Android"; Polkadot Desktop and the web client use that allocator; no reference client handles `AccountFull` in chat. The store rejects a replacement with a lower expiry, so a never-expiring channel statement can never be freed by its owner, and the SDK exposes no remove call. Client-side mitigation is limited to a finite `ExpirationTime` for NEW channels (spec-permitted); existing channels stay. The fix is upstream: owner-lowerable or removable statements in the store, a finite recommended chat expiry in the spec, and a larger allowance from the identity backend.
