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
| Meter charges (not wire; chain) | 1 Asset Hub extrinsic per 5 metered replies or 10 min, whichever first; the bot's balance hint shows the pending debit | revised 2026-09-23 (M12c) |

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
