# Private groups: one statement per message on a secret epoch topic

Board mission: M3 Protocol foundations

Supersedes board items: chat-spec · Groups — Bots in group chats

Status: Prototyped in polkadot-chat-desktop (commit b5cbe5d) and polkadot-chat-agents (branch desktop/rfc-0003).

## Problem

- The base spec has no groups. A group built from pairwise sessions (fan-out) costs n − 1 submissions and n − 1 acknowledgements per message. Our first prototype (fan-out v1) did this and needed a cap of 16.
- The efficiency rule asks that a group message cost one submission.
- Bots must be able to be members and admins.

## Proposed wire change

- **Epoch key.** A group is a secret `K_e`. From it every member derives the topic for the epoch, the channels and the message key (keyed BLAKE2b). The store sees a random topic that changes each epoch, and never sees the group id.
- **One statement per message.** A member posts one statement on its own message channel of the topic. It carries the new message and the sender's own messages of the last 24 h (≤ 4,096 bytes), so a replacement loses nothing a reader needs. There is no acknowledgement. Every existing content kind rides inside unchanged.
- **Group state.** An admin posts one encrypted document: name, members (roles, permissions, posting accounts per device), invites, pins, slow mode, join policy, history sharing. Order: epoch, then version, then the lower signer account.
- **Removal.** The admin posts one rekey statement on the old topic. It holds the next epoch key sealed to each remaining member with the pairwise secret `K(A, B)` (68 bytes per member). Then one state statement on the new topic. A timer rotation happens every 7 days.
- **Pairwise control** (provisional kind 249, over the DM session): `welcome` (epoch key, state hash), `joinRequest`, `joinDecision`, `history`, `keyRequest`, `historyRequest`.
- **Joining.** An invite link names an admin and carries a capability, never a key. The admin's client admits the joiner or queues the request, then sends `welcome`. It can share the last 100 messages.

Full spec: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/spec/0011-groups-v2.md (with the reviewer rulings at the end)

## What the prototype learned

- **Cost.** 1 submission per message, reaction, edit or press. Removal: 2 statements at any size. Typing and seen are not sent in groups.
- **Measured (devnet e2e, 84 s).** Create in one statement; one submission per message; a bot reply in one statement; the carry survives a restart; removal in two statements with the removed member locked out of epoch 2; a history page from a bot; a v1 room migrated in place.
- **Removal compared** (remaining members m = n − 1):

  | n | This proposal | Epoch key by DM each | Sender Keys | MLS, admin-only commits (measured) |
  |---|---|---|---|---|
  | 64 | 2 statements, ~4.3 KB | 63 + 63 ACKs | 3,906 | 5.8 KB |
  | 256 | 2, ~17 KB | 255 + 255 | 64,770 | 21.7 KB |
  | 1024 | 2, ~70 KB | 1023 + 1023 | 1,045,506 | 84.7 KB |

- **The MLS survey.** We measured MLS with ts-mls 1.6.4 (ciphersuite 1). When only an admin commits, the tree stays sparse and a remove commit is about 83 bytes per member, the same order as our rekey. MLS's small commits (1.5–2.3 KB) need every member to commit. A Welcome with the tree is 16.5 / 64 / 255 KB at 64 / 256 / 1024. MLS also needs every commit, in order, for every member. The Statement Store neither orders nor keeps a log. We found no deployment of MLS without an orderer. Recommendation: keep the epoch key. Add rotating member wrap keys to get post-compromise security (owner decision pending). MIMI names for roles and permissions, not the MIMI transport. Survey: https://github.com/shawntabrizi/polkadot-chat-desktop/blob/main/docs/reference/mls-survey.md
- **The cap.** The format allows 1024 members. The prototype caps at 256 until the quota question (proposal 11) is settled. A removal at 1024 is about 115 KB of statements.
- **Pitfall: the quota.** Two busy test identities could not post in any group: `AccountFull`. Their never-expiring DM statements filled the allowance (proposal 11).
- **Other rulings from the build.** History on request from any member (a bot admin first); the 24 h carry never crosses an epoch; no rotation at a join; a bot admin forwards join requests to the owner with Approve / Reject buttons.

## Privacy levels

| Level | The store sees | Status |
|---|---|---|
| 1 | signer accounts, a random topic per epoch, sizes, timing; not the group id, name, roster or content | built |
| 2 | unlinkable per-group posting accounts; not who is a member | target; People-chain slots make it possible for persons today |
| 3 | nothing linkable to an identity | out of scope |

Level 1 still shows the store which signers post on the same topic. That is WhatsApp-level to the store, not Signal-level.

## Clients that do not support it

- Group kinds go only to devices that listed them in capabilities (proposal 01). A peer that did not list them cannot be added, and the UI says why.
- The phone apps have no groups. They see kind 249 as "unsupported" and a join request as plain text. Nothing breaks.
- Group statements use new topics. Clients that do not subscribe never see them.

## Open questions

1. **AEAD.** The draft uses AES-256-GCM. RFC-0004 (merged 2026-07-31) makes ChaCha20-Poly1305 the protocol AEAD. Switch before adoption? We think yes.
2. **Post-compromise security.** Rekey entries use the static `K(A, B)`. A thief of a member's identity chat key reads later epochs until that member is removed. Add member wrap keys, move to MLS, or accept?
3. **Cap.** 256 or 1024?
4. **Level 2.** Ship level 1 now, or wait for per-group posting accounts? Level 2 needs every member to be a person, or to get a slot from one.
5. **Offline readers.** A reader away for more than 24 h depends on history from another member.
6. Kind numbers: 249 and the group-topic payload are provisional.

Decision wanted: adopt, adopt with changes, or reject. React 👍/👎 or comment.
