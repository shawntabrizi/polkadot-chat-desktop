# Decision brief: keep the v2 epoch key or move to MLS; MIMI alignment (2026-09-24)

For the owner. Evidence and sources: `docs/reference/mls-survey.md`.

## The facts that decide it

- The node accepts statements up to **1,048,575 bytes** encoded
  (`MAX_STATEMENT_SIZE`, `substrate/client/statement-store/src/lib.rs:180`,
  polkadot-sdk `cccea0c`). A devnet chat identity may keep 50 statements and
  512,000 bytes live.
- The store is not a log and does not order. MLS needs every commit, in order,
  for every member. A member that misses one cannot continue without a rejoin
  (RFC 9420 §12.4.2, §16.12).
- Admin-only commits are allowed by the RFCs (RFC 9750 §6.4: "an application
  could decide that a group administrator will be the only member to perform
  Add and Remove operations"). But they keep the ratchet tree sparse. We
  measured a remove commit at **5.8 / 21.7 / 84.7 KB** for 64 / 256 / 1024
  members. The v2 rekey is 4.3 / 17 / 70 KB. MLS's small commits
  (1.5–2.3 KB) need members to commit themselves.
- A Welcome with the ratchet tree is 16.5 / 64 / 255 KB.
- No deployment of option B (admin-only commits on a shared broadcast topic,
  no orderer) was found. Every production MLS system (Wire, RCS, Discord,
  XMTP, Webex) orders commits at a server or chain. Marmot (Nostr) comes
  closest. It lets members commit self-updates, runs a fork-choice machine,
  and relays keep commits forever.
- MIMI has no RFC (four WG drafts, none at the IESG) and assumes a hub
  that orders and enforces.

## The options

| | A epoch key (built) | B MLS, admin commits on topic | C MLS, pairwise (t3ams) | D MLS, sequencer | E Sender Keys |
|---|---|---|---|---|---|
| Per message | 1 | 1 | 1 | 1 | 1 |
| Per removal at 1024 | 2 (~115 KB) | 1 commit 85 KB + 256 KB snapshot | 1023 DMs, ~87 MB | 1 commit ~2.3 KB + a chain fee (~0.01 DOT) or a bot orderer | 1023 statements |
| Missed changes | jump to the latest key | replay every commit, else re-add | lost; recreate | replay from the sequencer | ask each sender |
| FS | per epoch | per message | per message | per message | per message |
| PCS | none vs a stolen identity key | a member heals only via the admin | as B | each member heals itself | none |
| New dependency | none | MLS library (ts-mls MIT unaudited, or core-crypto GPL, 7.6 MB) | same | same + sequencer | none |
| Precedent | Megolm-like | **none** | t3ams (cap 10) | Wire, RCS, XMTP | Signal, WhatsApp |

## Recommendation: keep A, and add member wrap keys for PCS

1. **Keep the v2 epoch key.** It meets the efficiency rule at every size. A
   returning member needs only the latest key. The design needs no library
   and no orderer.
2. **Add the one property MLS would give us: PCS.** Each member publishes a
   rotating X25519 wrap key inside its message statement (32 bytes, no extra
   submission). The admin's rekey wraps `K_{e+1}` with `K(A, B)` combined
   with a DH between a fresh admin key and that wrap key. The result is TreeKEM
   with a flat tree, the same thing admin-only MLS does on its sparse tree, at
   the same O(n) cost. A thief of an identity key loses access after the
   member's next rotation and rekey. The fresh admin key also gives rekey
   entries forward secrecy.
3. **MIMI: vocabulary, not transport.** Name our permissions with MIMI
   capability names in 0011 and keep the mapping table. Do not put MIMI
   structures on the wire.

**Risks.** The wrap-key scheme is our own construction. It needs a review
and test vectors. It still has no per-message FS: a stolen epoch key reads up
to 7 days (14 kept). It does not make us interoperable with any MLS system.

**Is option B sound?** On paper, yes. It needs one committer per group at a
time, per-epoch commit channels that carry the last 24 h of commits, a tree
snapshot, and re-add as the last resort. The lack of a deployment alone
should not stop us. The arithmetic should: B costs as much per removal as A
and adds a 256 KB snapshot at 1024. It also brings a commit chain that the
store does not keep and a new dependency. Its gain over A plus wrap keys is
per-message FS and a standard wire format.

**Fallback if A plus wrap keys fails in a prototype** (the review rejects the
construction, or rotation costs too much): prototype B in pca `bot-core`
with `ts-mls`. Use a bot admin as the only committer. Measure the allowance at
256 members before any client work.

## Changes to spec 0011 (no rewrite)

- Cost table and Unresolved 8: replace "MLS Commit on the topic: 1–2,
  O(log n)" with the measured admin-only sizes (5.8 / 21.7 / 84.7 KB), and
  state that O(log n) needs member commits.
- Rationale 2: cite the survey. State that MLS needs a commit order that the
  store does not give.
- Security: add member wrap keys (a `Member.wrapKey` field, or a field in
  `GroupMessages`), the combined `WrapKey`, and an ephemeral admin key per
  `Rekey`. Change "No post-compromise security" to "PCS after the member's
  next rotation and rekey".
- Limits: +32 bytes per member in the state, +32 bytes per rekey.
- An informative appendix: GroupState and permission bits mapped to MIMI
  room-policy names; message kinds mapped to MIMI content.
- Unresolved: "MLS if interop or per-message FS becomes a requirement; the
  sequencer question comes first".

## Three questions for the owner

1. Is PCS against a stolen device or identity key a requirement for v2
   groups now? If yes, the wrap keys go into M16. If no, keep A as built and
   file wrap keys for later.
2. Is MLS interop (t3ams, XMTP, a future MIMI hub) a product goal? If yes,
   do you accept a GPL (core-crypto) or an unaudited (ts-mls) dependency, and
   a commit orderer (a bot or a chain)?
3. Do you accept MIMI names for our roles and permissions (names only, no
   wire change), or do we keep our own names?
