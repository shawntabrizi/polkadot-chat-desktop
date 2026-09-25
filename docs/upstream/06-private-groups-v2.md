# Private groups: one statement per message on a secret epoch topic

Board mission: M3 Protocol foundations

Supersedes board item: chat-spec · Groups — Bots in group chats

## Problem

- The base spec has no groups.
- A group built from pairwise sessions (fan-out) costs n − 1 submissions and n − 1 acknowledgements per message. Our first prototype (fan-out v1) did this and needed a cap of 16.
- The efficiency rule asks that a group message cost one submission.
- Bots must be able to be members and admins.

## What we implemented

- **Epoch key.** A group is a secret `K_e`. From it every member derives the topic for the epoch, the channels and the message key (keyed BLAKE2b). The store sees a random topic that changes each epoch. It never sees the group id.
- **One statement per message.** A member posts one statement on its own message channel of the topic. It carries the new message and the sender's own messages of the last 24 h (≤ 4,096 bytes), so a replacement loses nothing a reader needs. The carry never crosses an epoch. There is no acknowledgement. Every existing content kind rides inside unchanged.
- **Group state.** An admin posts one encrypted document: name (may be empty; clients then show a name made from the roster), members (roles, permissions, posting accounts per device), invites, pins, slow mode, join policy, history sharing. Order: epoch, then version, then the lower signer account.
- **Removal.** The admin posts one rekey statement on the old topic. It holds the next epoch key sealed to each remaining member with the pairwise secret `K(A, B)` (68 bytes per member). Then one state statement on the new topic. A timer rotation happens every 7 days. No rotation at a join.
- **Pairwise control** (provisional kind 249, over the DM session): `welcome` (epoch key, state hash), `joinRequest`, `joinDecision`, `history`, `keyRequest`, `historyRequest`.
- **Joining.** An invite link (`polkadot-chat://g#<base64url>`) names an admin and carries a capability, never a key. The admin's client admits the joiner or queues the request, then sends `welcome`. A bot admin forwards a join request to the owner with Approve / Reject buttons.
- **History on request** from any member (a bot admin first), up to 100 messages in pages of ≤ 4 KB.
- **AEAD.** Sealing uses AES-256-GCM through Web Crypto (see open decision 5).

Full spec, with the reviewer rulings at the end: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0011-groups-v2.md

### Why the epoch key, and not MLS

We measured MLS with ts-mls 1.6.4 (ciphersuite 1, X25519 + AES-128-GCM + Ed25519) at 64, 256 and 1024 members. Survey: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/reference/mls-survey.md

| Bytes | n = 64 | n = 256 | n = 1024 |
|---|---|---|---|
| Our rekey (68 B × (n − 1)) | ~4,300 | ~17,300 | ~69,600 |
| MLS remove commit, admin-only tree (measured) | 5,839 | 21,668 | 84,719 |
| MLS remove commit, full tree (members commit too) | 1,468 | 1,866 | ~2,300 (extrapolated, not measured) |
| MLS Welcome with the ratchet tree (measured) | 16,546 | 64,345 | 255,488 |

What decides it:

- **The store does not order and does not keep a log.** MLS needs every commit, in order, for every member (RFC 9420 §12.4.2). A member that misses one must be re-added.
- **Admin-only commits give no size gain.** When only an admin commits, the tree stays sparse. A remove commit is about 83 bytes per member, the same order as our rekey. The small MLS commits need every member to commit, and that needs an orderer.
- **The Welcome is large.** 255 KB at 1024 members is half of a chat identity's 512,000-byte allowance (proposal 11).
- **No precedent.** We found no deployment of MLS with admin-only commits on a broadcast topic and no orderer. Wire, RCS, Discord, XMTP and Webex all order commits at a server or a chain. Marmot (Nostr) comes closest, and its relays keep commits for ever.
- **MIMI** has no RFC (four working-group drafts) and assumes a hub that orders and enforces. We use MIMI names for roles and permissions only, not its transport.

Other options compared (removal at n members, m = n − 1 remaining):

| n | This proposal | Epoch key by DM each | Sender Keys | MLS, commits sent pairwise (as t3ams) |
|---|---|---|---|---|
| 64 | 2 statements, ~4.3 KB | 63 + 63 ACKs | 3,906 | 63 DMs × 5.8 KB |
| 256 | 2, ~17 KB | 255 + 255 | 64,770 | 255 DMs × 21.7 KB |
| 1024 | 2, ~70 KB (+ ~45 KB state) | 1023 + 1023 | 1,045,506 | 1023 DMs, ~87 MB |

What MLS would give that we lack: per-message forward secrecy and post-compromise security (PCS). Our answer, not built: a **flat-tree healing scheme**. Each member publishes a rotating X25519 wrap key inside its message statement (32 bytes, no extra submission). The rekey wraps `K_{e+1}` with `K(A, B)` combined with a DH between a fresh admin key and that wrap key. This is TreeKEM with a flat tree, at the same O(n) cost. A thief of an identity key loses access after the member's next rotation and rekey. It is our own construction, so it needs an outside review and test vectors first.

## Cost

| Operation | Submissions |
|---|---|
| Send a message, reaction, edit, delete or button press | **1** (v1 fan-out: n − 1 plus n − 1 ACKs) |
| Typing, seen | 0 (not sent in groups) |
| Pin, rename, role, permission, slow mode, policy, invite | 1 (state) |
| Remove a member | **2 at any size** (rekey + state) |
| Timer rotation | 2 per 7 days |
| Admin adds a member | 1 + 1 DM + its ACK |
| Join by link | ~6, once |
| History to a newcomer | ⌈bytes / 4 KB⌉ DMs + ACKs, once |

- **Bytes.** Rekey 68 bytes per member. State about 45 bytes per member (~45 KB at 1024). A removal at 1024 is about 115 KB in two statements. A full message statement in the vector is 268 bytes. The carry is capped at 4,096 bytes.
- **Allowance.** Each member holds 1 live statement per group; an admin 1–3.
- **Measured (devnet e2e, 84 s).** Create in one statement; one submission per message; a bot reply in one statement; the carry survives a restart; removal in two statements, and the removed member is locked out of epoch 2; a history page from a bot; a v1 room migrated in place. A second run (80 s) covered join by invite with approval, shared history, pins, slow mode, promotion, and a bot removed by a new admin in two submissions.

## What it gives the user

- Private groups with bots as members and admins, at the cost of a DM per message.
- Invite links, join approval (by a person or a bot admin), roles and permissions, pins, slow mode, recent history for a newcomer.
- Unnamed groups show the members' names ("Ana, Ben, Cy and 2 others"), as iMessage, Signal and Matrix do.
- A member picker that says which contacts can join and why.

## Privacy levels

| Level | The store sees | Status |
|---|---|---|
| 1 | signer accounts, a random topic per epoch, sizes, timing; not the group id, name, roster or content | built |
| 2 | unlinkable per-group posting accounts; not who is a member | target; People-chain slots make it possible for persons |
| 3 | nothing linkable to an identity | out of scope |

Level 1 still shows the store which signers post on the same topic. That is WhatsApp-level to the store, not Signal-level.

## Clients that do not support it

- Group kinds go only to devices that listed kind 249 and feature bit 0 in capabilities (proposal 01). The picker greys out other contacts: "Uses a client without group support", or "Not known yet: message them first".
- The phone apps have no groups. They never receive kind 249, and a client cannot add them to a group.
- Group statements use new topics. A client that does not subscribe never sees them.
- **Pitfall: the quota.** Busy test identities could not post in any group: `AccountFull`. Their never-expiring DM statements filled the allowance (proposal 11).

## Open decisions

1. **Epoch key or MLS?** Choose: (a) keep the epoch key (our recommendation); (b) MLS with admin-only commits on the topic; (c) MLS with an orderer (a bot or a chain). MLS makes sense if interop or per-message forward secrecy becomes a requirement.
2. **Healing scheme.** Add the flat-tree wrap-key scheme for PCS, after an outside review? Yes / no / not now. If no, a thief of a member's identity chat key reads later epochs until that member is removed (DMs have the same property today).
3. **Cap.** 256 (rekey ~17 KB) or 1024 (removal ~115 KB)? The format allows 1024; the prototype caps at 256 until proposal 11 is settled.
4. **Privacy level.** Ship level 1 now and build level 2 later? Or hold groups until level 2? Level 2 needs every member to be a person, or to get a slot from one.
5. **Cipher alignment.** RFC-0004 moved the protocol to ChaCha20-Poly1305. Choose: (a) switch group sealing to ChaCha20-Poly1305 before adoption (the desktop already ships `@noble/ciphers` for HOP, so no new dependency); (b) keep AES-256-GCM and state the divergence in the spec.
6. **Offline readers.** A reader away for more than 24 h depends on history from another member. Accept for v1? Yes / no.
7. Kind 249 and the group-topic payload are provisional numbers for chat-spec to assign.

Status: Built. polkadot-chat-desktop 46bf8d8 (M16), 7b911bd (M16b), 000391c (derived names, gated picker), b5cbe5d; spec 06374b2, rulings 0467b3a; survey 2a792f8. polkadot-chat-agents branch `desktop/rfc-0003` 0fa12a2 and 96bf004.

Decision wanted: answer the open decisions, then adopt, adopt with changes, or reject. React 👍/👎 or comment.
