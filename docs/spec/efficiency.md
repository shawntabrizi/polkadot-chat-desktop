# Efficiency budget for extensions (2026-09-23)

The shared cost of the Statement Store is **submissions**: every submitted statement is validated and gossiped to every node. Storage is bounded (one slot per sender and channel, replaced on resubmission, expiring), and per-person bandwidth is capped by the personhood allowance. So:

**Rule.** A new content kind may add bytes to a statement that would be submitted anyway. It MUST NOT add submissions unless it replaces a user action that would have been a submission. Every RFC in this folder states its submission cost.

| Kind | Submission cost | Status |
|---|---|---|
| deleted (21) | 0 (rides in the batch; pre-delivery removal shrinks it) | fine |
| buttons / buttonPress (242/243) | 0 beyond the message | fine |
| botInfo (244) | 1 per peer per version, then 0 | fine |
| transactionReference (245) | 3 per tx today | **tighten**: 2 (post at in-block, edit at finalized) |
| typing (240) | ≤ 1 per 4 s per peer while composing | **tighten**: first signal after 1 s of composing; refresh every 10 s; agents once per turn + 15 s refresh |
| seen (241) | ≤ 1 per 2 s per peer while reading | **tighten**: batch 5 s; piggyback on the next outgoing message when one follows |
| groupMessage (247) | n−1 per message for n members | temporary (v1); cap 16; v2 = one submission on a group topic with a shared key (MLS, as t3ams) |
| Meter charges (not wire; chain) | 1 Asset Hub extrinsic per bot reply | **tighten**: meter off-chain, settle every 5 replies or 10 min; header shows pending debit |

Reference points: a person's 1:1 chat sends roughly one statement per message; pca live placeholders now start only after 20 s; the base spec's request extension already batches every un-ACKed message into one statement.

Owner's question that produced this page: "are we keeping the protocol efficient? this must scale to lots of people on shared infra."
