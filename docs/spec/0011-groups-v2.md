# RFC: Private Groups (v2)

|                 |                                                                                  |
| --------------- | -------------------------------------------------------------------------------- |
| **Start Date**  | 2026-09-24                                                                        |
| **Description** | End-to-end encrypted groups up to 1024 members: one statement per message on a secret per-epoch topic, one epoch key, admin roles, invite links, join requests, shared recent history |
| **Authors**     | Shawn Tabrizi (with the desktop client team)                                      |
| **Status**      | Draft in `polkadot-chat-desktop/docs/spec`; replaces 0009 (fan-out v1); plan in `docs/milestones/M16.md` |
| **Provisional kinds** | `groupControl` = 249 (pairwise). Group-topic statements are a new statement payload, not a content kind. |
| **Research**    | `docs/reference/group-designs.md` (Signal, WhatsApp, Telegram, Matrix, DarkFi, MLS, t3ams, with sources) |

## Summary

A group is a secret: an epoch key `K_e`. From it every member derives the
group's topic for that epoch, the channel of its own statements, and the
message key. A member sends a group message as **one statement** on that
topic, with no acknowledgement. An admin removes a member with **one rekey
statement** on the old topic that holds the next epoch key encrypted to each
remaining member with the pairwise secret `K(A, B)` of the base spec, plus one
state statement on the new topic. Joining goes through an admin over the
existing pairwise session: an invite link names an admin and carries a
capability, never a key; the admin's client admits (or queues a join request)
and sends a `welcome`, and may share the last 100 messages. Roles, per-member
permissions, pins, slow mode and join policy live in one encrypted group-state
document on the topic. Bots are members and may be admins. There is one group
type with the supergroup feature set; public communities are out of scope.

## Motivation

v1 (0009) costs n−1 submissions and n−1 acknowledgements per message, caps at
16, and has one admin and no history. `efficiency.md` requires a group message
to cost one submission. The owner's bar is Signal, WhatsApp and Telegram
(roles, invite links, join requests, history for newcomers, slow mode, pins)
with Signal-direction privacy, sized honestly for a shared-key design.

## Stakeholders

Desktop client (this repo), `pca` bots (`polkadot-chat-agents`, branch
`desktop/*`), the phone app team (must not break; will implement later),
chat-spec maintainers (upstream target), People-chain and Statement Store
owners (level 2 privacy needs their parameters).

## Explanation

### Notation

As the base spec: `khash(key, payload)` is keyed BLAKE2b-256, `K(A, B)` is the
pairwise secret of Appendix A, `encode` is SCALE, `:` is concatenation. AEAD is
AES-256-GCM with a 12-byte random nonce and a 16-byte tag. `groupId` is the
textual UUID as a SCALE `String` (as in 0009). `e` is the epoch, a `u32`
starting at 1.

### Keys, topic and channels (privacy level 1)

```
K_e        = 32 random bytes chosen by the admin who opens epoch e
Topic_e    = khash(K_e, b"grp-topic" : encode(groupId) : encode(e))
MsgKey_e   = khash(K_e, b"grp-msg")
ChMsgs_e   = khash(K_e, b"grp-ch-msgs")    // a member's message carrier
ChState_e  = khash(K_e, b"grp-ch-state")   // an admin's group state
ChRekey_e  = khash(K_e, b"grp-ch-rekey")   // an admin's rekey out of epoch e
```

The store sees a random topic that changes every epoch and never sees the
group id. One statement per (account, channel) holds, so each member keeps at
most one message statement, and each admin at most one state and one rekey
statement, per group per epoch.

### Statements on the group topic

```
GroupStatement = Statement {
    topic1  = Topic_e
    channel = ChMsgs_e | ChState_e | ChRekey_e
    expiry  = GroupExpiry
    data    = encode(GroupData)
    proof   = sign(SPk(signer), signature_material)     // as the base spec
}
GroupData = enum {
    messages(Sealed) = 0     // plaintext: GroupMessages
    state(Sealed)    = 1     // plaintext: GroupState
    rekey(Rekey)     = 2
}
Sealed = { nonce: [u8; 12], ciphertext: Vec<u8> }
         // AEAD(MsgKey_e, nonce, plaintext, aad = b"grp" : signer : encode(e) : variant byte)
GroupMessages = {
    from: AccountId          // the member; the signer must be one of its posting accounts
    topic: Option<u32>       // reserved for forum topics; MUST be None in v2
    messages: Vec<Vec<u8>>   // remote messages; each item encodes exactly as an opaque message in a DM Request
}
```

`GroupExpiry` follows the base spec's `Expiry` rule with `ExpirationTime` =
now + 14 days, so it rises with every submission and a replacement on the same
channel always wins. It is lower than the DM `ExpirationTime = u32.max`, so
when an account is full the store evicts group statements before DMs
(`client/statement-store/src/lib.rs:1084-1134`).

**Sending (one submission, no ACK).** The sender's client puts the new message
and its own earlier messages of the last 24 h into one `GroupMessages`, newest
first, until the plaintext would pass 4096 bytes, and submits it on `ChMsgs_e`.
It replaces the sender's previous statement. A reader that was offline gets
every sender's recent messages from one statement each; older ones are gone
and the client shows "Some messages may be missing" once (the 0009 gap rule,
by `messageId`). Messages composed within the same second go in one
statement. All existing contents (text, reply, reaction, edit, `deleted`,
`buttons`, `buttonPress`, `transactionReference`, `botInfo`) ride inside
unchanged; target `messageId`s are group-wide. `seen` is not sent in groups;
`typing` is not sent in groups (M12c).

**Receiving.** Subscribe with `matchAny` over the `Topic_e` of every group
(≤ 128 per filter). Decrypt; check that the proof signer is a posting account
of `from` in the current state and that `from` has the `post` permission (or
the message is a `groupLeave`); dedup by `messageId`.

### Group state

```
GroupState = {
    groupId: String
    epoch: u32
    version: u32                  // +1 on every change, across epochs
    name: String                  // <= 60 characters; may be empty (clients show a name made from the roster)
    avatar: Option<[u8; 32]>      // reserved: content hash; transfer not defined in v2
    defaultPermissions: u16       // given to members added from now on
    slowModeSecs: u32             // 0 = off
    joinPolicy: u8                // 0 admins add only, 1 link with approval, 2 link open
    historyShare: u8              // 0 off, else messages shared with a newcomer (<= 100)
    members: Vec<Member>          // 1..=1024, sorted by account
    invites: Vec<Invite>          // <= 16
    pinned: Vec<String>           // message ids, <= 10
    topics: Option<Vec<u8>>       // reserved for forum topics; MUST be None in v2
    createdAt: u64
}
Member = {
    account: AccountId
    role: u8                      // 0 member, 1 admin, 2 owner (exactly one owner)
    permissions: u16              // bit flags below; the owner has all
    posting: Vec<AccountId>       // <= 8 extra signer accounts (mds devices, level 2 aliases)
    joinedAt: u64
}
Invite = { inviteId: [u8; 16], secret: [u8; 16], createdBy: AccountId,
           expiresAt: u64 /* 0 = never */, maxUses: u32 /* 0 = no limit */, uses: u32 }
```

Permission bits: `0x0001` post, `0x0002` add members and create invites,
`0x0004` pin, `0x0008` change info (name, avatar, slow mode, policies),
`0x0010` remove members, `0x0020` approve join requests, `0x0040` manage
admins, `0x0080` delete others' messages (cooperative, as RFC-0003). Admin
flags only take effect for role ≥ 1; `post` applies to everyone.

**Rules.**
- An admin posts the whole new state on `ChState_e` for every change. A state
  is valid when its signer is a posting account of a member whose role and
  permissions in the receiver's current state allow the change.
- Order: higher `epoch`, then higher `version`; at a tie, the lower signer
  account bytes win. The admin whose change lost reapplies it on top of the
  winner with the next version.
- Only the owner changes roles of admins or transfers ownership. Nobody
  removes the owner. The owner leaving without a transfer makes the
  longest-standing admin the owner (lowest `joinedAt`, then account bytes).
- A member's own devices: a `deviceAdded` (kind 17) posted by an existing
  posting account of member X adds that account to X's posting set on every
  receiver; `deviceRemoved` (18) takes it out. The next state records it.

### Removal, leave and epoch change

```
Rekey = {
    newEpoch: u32
    entries: Vec<RekeyEntry>      // one per remaining member, sorted by hint
}
RekeyEntry = { hint: [u8; 8], nonce: [u8; 12], box: [u8; 48] }   // 68 bytes
WrapKey(A, B, e) = khash(K(A, B), b"grp-wrap" : encode(groupId) : encode(e))
box  = AEAD(WrapKey(admin, member, newEpoch), nonce, K_newEpoch, aad = encode(newEpoch))
hint = first 8 bytes of khash(WrapKey(admin, member, newEpoch), b"grp-hint")
```

- **Remove.** The admin generates `K_{e+1}`, submits `rekey` on `ChRekey_e`
  (topic `Topic_e`) with an entry for every remaining member (itself
  included), then submits the new state on `ChState_{e+1}` (topic
  `Topic_{e+1}`). Two submissions. The removed member sees the rekey and finds
  no entry for it; it cannot read epoch e+1. The two statements are on
  different topics so the store cannot link the epochs by topic.
- **Leave.** The member posts a `groupLeave` (kind 248, reused) inside its
  messages statement, then erases its keys. The first admin with
  `remove members` that sees it removes the member as above.
- **Timer.** An admin opens a new epoch when the current one is 7 days old
  (Megolm's default `rotation_period_ms`), after a random wait of up to one
  hour, and not if a rekey already appeared.
- **Forks.** Two rekeys out of epoch e: the one from the lower signer account
  wins. Clients keep both candidate keys for 24 h to read messages sent under
  the loser. The losing admin reapplies its change as epoch e+2.
- **Old keys.** A client keeps `K_e` for 14 days after the next epoch (the
  statement lifetime), then erases it.
- **Missed rekey.** A member whose epoch's topic went silent for 7 days, or
  who sees a rekey without its entry while still listed, sends `keyRequest`
  to an admin over the DM session; the admin answers with a `welcome`.

### Pairwise control (kind 249)

```
MessageContent = {
    ...
    groupControl(GroupControl) -> 249
}
GroupControl = enum {
    welcome(Welcome)            = 0
    joinRequest(JoinRequest)    = 1
    joinDecision(JoinDecision)  = 2
    history(History)            = 3
    keyRequest(KeyRequest)      = 4
}
Welcome      = { groupId: String, epoch: u32, epochKey: [u8; 32], stateVersion: u32, stateHash: [u8; 32] }
JoinRequest  = { groupId: String, inviteId: [u8; 16], proof: [u8; 32], note: String /* <= 140 */ }
JoinDecision = { groupId: String, inviteId: [u8; 16], status: u8 /* 0 pending, 1 rejected */ }
History      = { groupId: String, items: Vec<HistoryItem>, last: bool }
HistoryItem  = { from: AccountId, message: Vec<u8> /* a remote message; encodes as an opaque message */ }
KeyRequest   = { groupId: String, haveEpoch: u32 }
proof        = khash(invite.secret, b"grp-join" : AccountId(joiner))
stateHash    = hash(GroupState)
```

The `welcome` is small on purpose: a state of 1024 members is about 45 KB and
does not fit a DM statement (base spec: 4 KB of plaintext is sufficient). The
newcomer derives `Topic_e`, fetches the state statement, checks `stateHash`.

### Joining

- **Admin adds.** An admin with `add members` posts a new state with the
  member, then sends `welcome` over the DM session (opening a chat request
  first if none exists, as 0009 does).
- **Invite link.** `InviteLink = { groupId, name, admins: Vec<AccountId> /* 1..=3 */, inviteId, secret }`,
  SCALE, base64url, in a URL fragment (`…/g#<b64>`). It has no key and no
  topic. The joiner's client sends a chat request to one listed admin with the
  opener text `Join request: <groupName> [grp:<b64 inviteId>:<b64 proof>]`
  (a request opener is rich text only, so the capability rides in the text).
  The admin's client verifies the proof against its state and auto-accepts
  the request; then the joiner sends `joinRequest` on the session.
- **Policy.** `joinPolicy` 2: the admin's client admits at once (state +
  `welcome`). Policy 1: it answers `joinDecision{pending}` and shows the
  request to every admin with `approve joins` (the queue is local to that
  admin in v2). A rejected request gets `joinDecision{rejected}`.
- **Bots as admitters.** A pca bot with `add members` is an always-online
  admitter; the link can list it first.

### History on request (reviewer change, 2026-09-24)

Any member MAY ask any other member over the DM session for group messages
since a `messageId` or a timestamp (`history` request in kind 249); the
provider answers with pages of at most 4 KB, newest first, from its local
store, up to 100 messages per request. A returning member that finds a gap
(the 0009 gap rule) asks a bot admin first when the state lists one (bots are
always online), else the most recently active admin, else any member. The
newcomer history below is the same mechanism with "since = join".

### History for late joiners

The admitting client sends, over the DM session, the last `historyShare`
(≤ 100) messages it holds as `history` chunks of ≤ 4 KB, `last = true` on the
final one. Clients show "<admitter> shared recent messages" in the room. No
archive server exists and none is proposed. Setting `historyShare` to 0 also
makes the admitter open a new epoch at each join, so the newcomer cannot read
the current epoch's carriers either (WhatsApp and Telegram offer the same
toggle).

### Bots

A bot is a member (0009's model). It receives a `welcome` over its DM session,
subscribes to the topic, and answers with one statement. It may be an admin
with any flags. Recommended: mention-gating in groups over 16 members (as pca
does on t3ams channels). pca's `bot-core/lib/groups.mjs` keeps its roster,
seq and dedup rules; its fan-out (`targets`, `send`) becomes one submission.

### Multi-device (mds)

All of a member's devices hold the identity chat keypair (mds.md, step 5), so
each derives `K(A, B)`, opens `welcome`s and its own rekey entry: the group key
reaches every device without an extra message. Each device signs with its own
`statementAccountId`; those accounts are the member's `posting` set. A device
that joins later learns groups and history from its own devices over the mds
sync channel (mds.md, "Synchronization between devices").

### Limits

| Item | Limit |
|---|---|
| Members | 256 in v2 (reviewer default; the format allows 1024; owner decision pending, see Unresolved) |
| `GroupMessages` plaintext | 4096 bytes; a single larger message is refused, as in DMs |
| Carry window | own messages of the last 24 h, within the 4096 bytes |
| Statements per member per group | 1 (messages); admins +1 state, +1 rekey |
| Submission rate | ≤ 1 per second per group per member; slow mode: ≤ 1 per `slowModeSecs` for role 0 |
| State | ≤ 64 KiB encoded (~45 KB at 1024 members) |
| Rekey | 68 bytes per member (~70 KB at 1024) |
| Expiry | now + 14 days; epoch rotation every 7 days |

Slow mode is enforced by the sender's client; receivers hide a role-0
member's statement that arrives sooner than `slowModeSecs` after its previous
one (by arrival time). The store cannot enforce it.

### Submission cost (efficiency rule)

| Operation | Submissions | Notes |
|---|---|---|
| Send any message or reaction, edit, delete, button press | **1** | no ACK on the topic; v1 was n−1 plus n−1 ACKs |
| Typing, seen | 0 | not sent in groups |
| Pin, rename, role, permission, slow mode, policy, invite create | 1 | state statement |
| Remove a member | 2 | rekey on old topic + state on new topic |
| Leave | 1 + 2 | the leaver's message; the admin's removal |
| Timer rotation | 2 per 7 days | |
| Admin adds a member | 1 + 1 DM + its ACK | state + `welcome` |
| Join by link | ~6 once | request, accept, `joinRequest`+ACK, `welcome`+ACK, state |
| History to a newcomer | ⌈bytes / 4 KB⌉ DMs + ACKs | once per join |
| Create with n members | 1 + (n−1) DMs + ACKs | state + `welcome`s; large groups grow by link |
| Missed-rekey recovery | 2 DMs + ACKs | `keyRequest`, `welcome` |
| Migrate a v1 room | 1 + (n−1) DMs | once |

Removal compared (remaining members m = n−1):

| n | v2 (this RFC) | epoch key by DM each | Sender Keys (WhatsApp) | MLS Commit on the topic | t3ams MLS (pairwise) |
|---|---|---|---|---|---|
| 64 | 2 statements, ~4.3 KB rekey | 63 + 63 ACKs | 63·62 = 3,906 (+ACKs) | 1–2 | ~63 |
| 256 | 2, ~17 KB | 255 + 255 | 255·254 = 64,770 | 1–2 | n/a (cap 10) |
| 1024 | 2, ~70 KB | 1023 + 1023 | 1023·1022 = 1,045,506 | 1–2 | n/a |

Sender Keys: every remaining member sends a new sender key to every other,
per the WhatsApp whitepaper's "all group participants clear their Sender Key
and start over" and RFC 9420 §1 ("scales as the square of the group size").
MLS commit size is O(log n) typical [inferred from RFC 9420; not measured].

### Security

- **Confidentiality.** Only holders of `K_e` read epoch e. A removed member
  loses access from the next epoch; it can read epoch e until the rekey lands
  (seconds when an admin is online).
- **Forward secrecy: per epoch.** Every member holds `K_e` for the whole
  epoch, so a per-sender hash ratchet (Megolm, Sender Keys) would add nothing:
  a thief of `K_e` derives every chain. A stolen device reads the current
  epoch and the kept old epochs (≤ 14 days), no more. Megolm shows the same
  limit ("partial" FS) and answers it with rotation on leave and on a timer;
  we do the same.
- **No post-compromise security against a stolen identity chat key.** Rekey
  entries use the static `K(A, B)`; a thief of a member's identity chat key
  opens every later rekey entry for that member until the member is removed.
  DMs have the same property today (static ECDH, base spec Appendix A). MLS
  would fix this with leaf updates; see Unresolved.
- **Authenticity.** Any member can encrypt; the sender is the statement signer
  (checked by the store) mapped to a member by the state. The AAD binds the
  ciphertext to its signer, so a member cannot re-sign another's ciphertext
  as its own.
- **Invite links.** A leaked link lets a stranger ask to join, never read. The
  admin checks `expiresAt`, `maxUses`, and policy; any admin can revoke by
  removing the invite from the state.
- **Deletion** in groups is cooperative (RFC-0003); carriers are replaced on
  the next send, which removes the old ciphertext from the store early.

## Privacy

| Level | Store and nodes see | Status |
|---|---|---|
| 1 | signer accounts, a random topic per epoch, channel, size, timing. Not the group id, name, roster or content. | **v2 ships this** |
| 2 | unlinkable per-group posting accounts on a random topic. Not who is a member, not who sent. | **target; v2 is ready for it** |
| 3 | nothing linkable to any identity (DarkFi-style) | out of scope |

**Level 1 limits, stated plainly.** The set of signers on a topic still links
epochs and shows who is in a group together (WhatsApp-level to the store, not
Signal-level). The RPC node a client uses sees which topics it subscribes to
and from which address. DMs today have the same exposure: the signer is
visible and a request and its ACK pair up by timing [inferred].

**Level 2: what works today.** Verified in code:
- Statement proofs are Sr25519, Ed25519 or ECDSA signatures only, and the
  store's account is the signer key (`substrate/primitives/statement-store/src/lib.rs:293-326`,
  polkadot-sdk `83b147a`). A People-chain alias is a ring-VRF output, not a
  signing key (`substrate/frame/people/src/extension.rs:215`), so an alias
  itself cannot sign or hold an allowance.
- `pallet_people::set_alias_account` links an ordinary account to an alias in
  a context from `AccountContexts` (`substrate/frame/people/src/lib.rs:912-930`).
  It grants no statement allowance; `frame/people` never touches it.
- The individuality resources pallet grants a statement allowance to **any**
  `target_account` from an unsigned extrinsic that carries a ring-VRF proof in
  the context `stmt_store_slot_context(period, seq)`
  (`pallets/resources/src/lib.rs:943-990`, `:1445-1449`;
  `pallets/resources/src/extension.rs:256-275`; individuality `0676dbb`). One
  grant is 2 statements / 500 KiB; a person has 20 slots per day, a lite person
  10 (`runtimes/next-people-paseo/src/parameters.rs:41-55`).

So a person can today get a fresh, unlinkable posting account per group per
day, and v2's one-statement-per-member-per-group design fits a 2-statement
grant (messages + state; an admin that rekeys uses a second slot). The member
announces the account inside the group: a `postingAlias` message (a content
reserved for level 2) that carries the account and a signature by one of the
member's existing posting accounts over `groupId : e : account`, so only
members learn the link. What does **not** work today: more than ~18 private
groups per person per day (slot count); bots and the desktop's own identity,
which are not persons (a person owner can grant one of its slots to a bot's
account, since `target_account` is free); whether devnet runs this pallet:
**unverified**.

**Level 3** (no identities, anonymous transport) conflicts with personhood-based
sybil resistance and the statement allowance, and with the phone app's
identity model. Out of scope.

A level-2 follow-on RFC applies the same posting-account scheme to DMs.

## Rationale (coordinator's position, point by point)

1. **One topic per group, one statement per message.** Adopt, improved: the
   topic is per epoch and derived from `K_e` (level 1), and each member's
   statement carries its own recent messages (the base spec's batching, with
   no ACK) so a replacement loses nothing a reader needs. Verified: topics are
   `[u8; 32]`, 4 per statement, and subscribers filter on topics only
   (`store_api.rs:72-81`). The metadata cost holds as stated for level 1; the
   owner rejected it as the end state, hence level 2.
2. **Epoch key distributed by an admin over one DM each; per-sender hash
   ratchet.** Improved: the rekey is one multi-recipient statement using the
   same pairwise secret `K(A, B)` (Signal's sealed-sender-v2 idea), so removal
   costs 2 submissions, not n−1 plus n−1 ACKs, and needs no open DM session
   with each member. The per-sender ratchet is refuted: with a shared epoch
   root it gives no forward secrecy; rotation does. Cap 1024 kept. MLS is
   needed when post-compromise security against device or identity-key theft
   is required, or when rekey bytes (68 B × n) become too costly.
3. **Signed, encrypted group-state document.** Adopt, with the order (epoch,
   version, lower signer account). No inner signature: mds devices do not hold
   the identity signing key (mds.md, overview), so authority comes from the
   statement signer mapped through the state.
4. **Invite link through an admin.** Adopt. The chat request opener is text
   only (M12 finding), so the capability rides in the opener text; kind 249
   carries `joinRequest` and `welcome`.
5. **Last 100 messages from the admitter.** Adopt (WhatsApp Group Message
   History, 2026). No archive.
6. **Bots as members and admins.** Adopt; bots are the natural always-online
   admitters and timer rotators.
7. **mds.** Adopt. The identity chat key already reaches every device, so the
   rekey needs no per-device entries (WhatsApp sends one per device).
8. **v1 migration.** Adopt; development mode makes "drop v1-only members" moot.

## Drawbacks

Level 1 shows co-membership to the store. No post-compromise security. Rekey
and state grow linearly (≈ 115 KB of statements for a removal at 1024).
Admission and history need an online admin (or a bot admin). Readers offline
for more than a day in a busy group lose messages. Slow mode is advisory at
the store. Invite secrets are visible to all members.

## Testing

In memory, three identities and a bot: create; one message = 1 submission;
dedup across carries; a non-member signer rejected; a member without `post`
rejected; removal: the removed member cannot decrypt the next message; rekey
fork resolves to the lower account; state order; invite proof valid, expired,
over-used, revoked; join with policy 1 and 2; history chunks; `keyRequest`;
v1 migration; a device's `deviceAdded` accepted. Live: devnet room of three and
a bot; the Diagnostics counter shows 1 submission per group message.

## Compatibility

- **v1 rooms migrate** when an admin's v2 client opens epoch 1 with the v1
  roster (v1 admin becomes owner) and sends each member a `welcome` over the
  existing session. The `groupId` stays; the room keeps its history. After
  that the client stops the fan-out. Kinds 246–248 stay decodable for stored
  history; 248 is reused inside v2 carriers.
- **Clients that know only v1** (development mode, README): they show an
  unsupported bubble for 249 and stop receiving the room. Accepted while all
  clients are in development.
- **The phone app** (no groups) sees 249 as unsupported and a join request as
  plain text. Nothing breaks.
- Group-topic statements are a new statement payload on new topics; clients
  that do not subscribe never see them.

## Unresolved Questions

1. **Owner: the metadata trade-off.** Ship level 1 now and build level 2
   (per-group, per-day posting accounts from People-chain slots) next, or hold
   v2 until level 2? Level 2 needs every member to be a person or be granted a
   slot by one; the desktop's own identity is not a person until "Sign in with
   Polkadot app" (roadmap M10a).
2. **Owner: the 1024 cap.** A removal at 1024 is ≈ 115 KB in two statements;
   an admin's quota on Paseo People is 1 MiB and 200 statements
   (`parameters.rs:49-51`). Lower to 256 (≈ 17 KB rekey) or keep 1024?
3. **Quota budget.** Which allowance does a chat identity hold on devnet
   (**unverified**)? Every DM peer holds up to 2 statements of it and every
   group 1–3; a person with many chats runs out, and group posts then fail
   with `AccountFull` because DMs have higher expiry.
4. **Upstream proposal (level 2 at scale).** "Contextual statement allowance:
   let a person register an unlinkable statement account per (context,
   period) where the context is chosen by the caller from a registered family
   (for example `blake2(b"chat-group" : groupSecret : period)`), drawing on a
   per-person, per-period budget larger than today's 20 slots, with a per-grant
   count of at least 4 statements; the grant stays an ordinary
   `increase_allowance_by(target_account)` so the Statement Store needs no
   change. Alternative with a store change: a ring-VRF `Proof` variant whose
   account is `hash(context : alias)`, verified against the ring root in chain
   state (`sp-statement-store`, `sc-statement-store`, network format)."
5. **Kind range.** 240–249 is now full. Extend the provisional range (250–254)
   or ask chat-spec for real numbers.
6. **Public communities** (anyone joins, 100k members) are out of scope: no
   encryption is meaningful there. A separate future "channel" design:
   plaintext or link-keyed broadcast, admin-signed posts, no roster.
7. **Offline readers** beyond the 24 h carry lose messages. A member-run
   archive (a bot that re-shares on request over DM) is possible later.
8. **MLS later?** If post-compromise security becomes a requirement, MLS
   Commits on the group topic (one statement) with KeyPackages published on a
   per-account topic would keep one submission per operation. t3ams sends
   Commits pairwise; interop with t3ams groups is not a goal.
9. **Avatar transfer** (HOP file or Bulletin) is not defined.
10. **Invite secrets in the state** are visible to every member; a per-admin
    invite key would hide them at the cost of one more key per admin.

### Reviewer rulings after the pca build (2026-09-24, pca 0fa12a2)

1. `groupControl` variant 5 `historyRequest = { groupId, since: enum { messageId(String) = 0, timestamp(u64) = 1 }, limit: u8 (1..=100) }` is adopted; the provider answers with `history` pages ≤ 4 KB, newest first.
2. A history request reaches back before the asker's `joinedAt` unless the state's `historyShare` is 0, in which case the provider clamps to `joinedAt`.
3. The 24 h carry never crosses an epoch: a statement in epoch e+1 carries only messages sent in e+1, so a rotation with `historyShare` 0 means what it says.
4. `K(A, B)` is the raw X25519 agreement of the two identity chat keys (the value that keys `SessionId` on this network); every use passes it through `khash` (`WrapKey`), so no separate HKDF step. The base spec's Appendix A text about P-256 with HKDF is outdated for this use.
5. Changing a role-0 member's permissions needs the `manage admins` flag (0x0040) in v2. The owner leaves the state only by the heir rule; nobody removes the owner.
6. Join policy 1 with a bot admin: the bot forwards the request to the owner over DM with Approve / Reject buttons (spec 0006) and admits on Approve. M16b.
7. Removal by a bot admin on request: an admin sends the bot the DM command `/remove <username>`; the bot checks the sender's role in the state, then rekeys. No new wire variant. M16b.
8. A bot announces `botInfo` once when it joins a v2 group, riding inside its first messages statement (no standalone statement).

### Rulings after the pca M16b build (2026-09-24, pca 96bf004)

9. Invite link form: `polkadot-chat://g#<InviteLink base64url>` (amended 2026-09-24: registering the phone app's `polkadotapp://` scheme would capture its pairing links). A host MAY wrap it in an https link it owns; the fragment is never sent to a server.
10. New groups default to join policy 1 (link with approval); a bot admin gets `/joinpolicy <0|1|2>`; `/invite` on a policy-0 group creates the invite and warns.
11. A promoted admin gets every flag except `manage admins` (0x00BF) by default.
12. When the bot is the owner, it forwards a join request to the first other admin with `approve joins`.
13. Policy numbers as written in this spec (0 admins add only, 1 link with approval, 2 link open); the coordinator's brief had them reversed, the code follows the spec.

14. No epoch rotation at a join, even with `historyShare` 0; the cost table holds (a newcomer simply receives no history). Receivers hide a too-fast slow-mode carrier with a 2 s grace for network delay.
