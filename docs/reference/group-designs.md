# Group chat designs: Signal, WhatsApp, Telegram, Matrix, DarkFi, t3ams (2026-09-24)

Research input for `docs/spec/0011-groups-v2.md`. The owner's bar is Signal,
Telegram and WhatsApp; t3ams is a reference on the same rails, not a template.

Labels: **[V]** read on the cited page or file. **[S]** seen only in a search
snippet (the page returned 403 or needs JavaScript): unverified. **[I]** our
inference, not stated by the source.

## Sources

- t3ams: `paritytech/t3ams-spa`, branch `develop`, commit
  `2aa54524ca614d0225699985732f78098258a95d` (2026-09-23), cloned read-only
  into a scratchpad. Paths below are relative to that repo.
- Statement Store: `paritytech/polkadot-sdk` master, commit
  `83b147a9b29aa5bdf40ddd105d308740a1647892`. Allowance grants:
  `paritytech/individuality` commit `0676dbbfe25277f09e6e787ffdddc4dddb6de918`.
- Web pages: cited inline, fetched 2026-09-24.

## The rails (what every design here must live with)

- A statement has up to 4 topics, an optional 32-byte channel, an expiry,
  data and a proof. [V] `substrate/primitives/statement-store/src/lib.rs:334-353`, `:139`.
- One statement per (account, channel). A new one replaces the old one only
  with a strictly higher expiry, else `ChannelPriorityTooLow`. [V]
  `substrate/client/statement-store/src/lib.rs:1046-1061`.
- The account is the signer key. `Proof` has three variants only: Sr25519,
  Ed25519, Secp256k1Ecdsa. [V] primitives `lib.rs:293-326`.
- Per-account quota `StatementAllowance { max_count, max_size }`, read from
  the raw key `":statement_allowance:" ++ account`. [V] primitives
  `lib.rs:159-229`. When full, the store evicts only that account's own
  statements, lowest expiry first, and rejects with `AccountFull` if the rest
  have an equal or higher expiry. [V] client `lib.rs:1084-1134`.
- Quota values on Paseo People: a person 200 statements / 1 MiB, a lite person
  50 / 500 KiB, one daily slot grant 2 / 500 KiB, 20 slots per day for a
  person, 10 for a lite person. [V] individuality
  `runtimes/next-people-paseo/src/parameters.rs:41-55`. Which quota a chat
  identity holds on devnet: **unverified**.
- A statement is at most 1 MiB − 1 byte encoded. [V] client `lib.rs:180-181`;
  `client/network/statement/src/config.rs:32`.
- Subscribers filter on topics only (`Any`, `MatchAll` ≤ 4, `MatchAny` ≤ 128).
  No filter by account or channel over RPC. [V]
  `substrate/primitives/statement-store/src/store_api.rs:72-81`;
  `substrate/client/rpc-api/src/statement/mod.rs:94-117`.
- So the store and every gossiping node see, per statement: signer account,
  topics, channel, expiry, size, arrival time. The RPC node a client uses also
  sees which topics that client subscribes to. [I]

## How t3ams does groups

t3ams has two layers. The older one is a symmetric epoch key per group; MLS
was added on top in August 2026 behind a flag. [V]
`docs/2026-08-16-mls-implementation-decisions.md` L202-209.

- **MLS library.** `packages/mls` (`@t3ams/mls`) wraps `@wireapp/core-crypto`
  10.3.0, Wire's openmls WASM build (`packages/mls/package.json`), with the
  default ciphersuite and Basic credentials (`packages/mls/src/session.ts:69,124`).
- **Addressing.** Group channel = SHA-256("group:" ‖ workspaceId ‖ ":" ‖
  groupId), fixed for the group's life, no secret, no epoch
  (`packages/bcts/src/channel.ts:126-142`). Topics: hash of group id, request
  or response scope, hash of sender XID (`channel.ts:191-213`). The namespace
  is the host name (`src/app/topic-namespace.ts:10`).
- **One statement per message, but the slot is overwritten.** The fixed
  channel means each send replaces the sender's previous statement. To
  compensate, each message carries up to 8 KB of recent ciphertexts from all
  senders (`src/features/messaging/services/backfill.ts:11-18,33-66`). Expiry
  24 h (`src/shared/chain/statement-store.ts:41,59-62`).
- **Keys and epochs.** Only the group admin commits
  (`src/features/messaging/domain/mls-commit-authority.ts:16-19`). Commits,
  Welcomes and KeyPackage requests go one sealed copy per member over a
  pairwise control slot, not on the group topic
  (`src/shared/mls/transport.ts:11-14,147-165`). KeyPackages are issued on
  request, 24 h, 8 per peer per minute (`packages/mls/src/key-packages.ts:22-27`).
  Daily rotation by the admin (`packages/mls/src/rotation.ts:18`).
- **Membership.** One admin per group; add and remove are admin-only
  (`group-sync-distributor.ts:172-194`, `group-membership.ts:73-95`). If the
  admin leaves, the group dissolves (`group-membership.ts:106-140`). Workspaces
  have owner/admin/member and an admin-signed last-write-wins state document;
  a per-permission matrix is listed as missing (`ROADMAP.md:13`).
- **Cap.** 10 members (`src/features/groups/domain/group.ts:52`), chosen so the
  full MLS GroupInfo fits inline on the pairwise path (decisions doc L181-185).
- **History.** None for late joiners (`group-sync-distributor.ts:170-171`).
- **Multi-device.** CoreCrypto gives each install a client id
  (`packages/mls/src/client-id.ts:57-60`), but the app maps one leaf per
  (conversation, user) (`src/shared/mls/member-map.ts`); second-device admission
  is out of scope (decisions L187-192).
- **Bots.** None in t3ams itself. pca runs bots on t3ams DMs and workspace
  channels, not on ad-hoc groups ("Native ad-hoc T3ams groups are not supported
  yet"), and needs a channel key grant for private channels
  (`.refs/polkadot-chat-agents/docs/guide/t3ams.md`, pca `a0e04979`).
- **Signer.** The host signs with the product's allowance account
  (`statement-store.ts:9-12,44`). Whether that account is shared by all users
  or per user is not settled in the repo (`architecture.html:1350,1363` vs the
  multi-device plan L48): **unverified**.
- **Features today.** Pins: yes, any member (`group-ops.ts:46-72`). Threads:
  yes (`threadRootId`). Avatars: yes. Invite links: a recorded non-goal
  (`BACKLOG.md:44`). Join requests: a type, no flow (`group-expressions.ts:105`).
  Slow mode: backlog (`BACKLOG.md:353`).

**What t3ams got right:** one statement per message on a group address; one
commit authority per group to avoid forks; a size cap stated with its reason;
admin-only membership; no history promise it cannot keep.

**What is fragile on these rails:**
- The fixed channel overwrites the sender's last message; the 8 KB backfill of
  *other* senders' MLS ciphertexts cannot be decrypted twice (MLS forbids it),
  so it is wasted bytes (`mls-channel-codec.ts:146-155`) [I from code].
- Commits, Welcomes, KeyPackages and resyncs for all groups share one
  last-write-wins pairwise slot per peer (decisions L165-166), so an offline
  invitee can lose a Welcome; only admin recreation recovers it
  (`group-mls-resync-handler.ts:111`) [I from code].
- About 9 statements per commit plus 8 KB carriers against a quota of tens
  to hundreds of statements (`architecture.html:1371`) [I].
- Pins and reactions in MLS groups bypass MLS and use the legacy key
  (`group-ops.ts:52-69,262-279`).
- A single admin: its state loss or departure ends the group.
- Group channel and topics derive from the group id without a secret: anyone
  who learns the id links every statement of the group [I].

## Signal

- **Fan-out.** Sender Keys (`group_encrypt`, `create_sender_key_distribution_message`)
  [V] https://github.com/signalapp/libsignal/blob/main/rust/protocol/src/group_cipher.rs.
  Sealed Sender v2 sends one multi-recipient ciphertext, so one upload per
  message [V] https://github.com/signalapp/libsignal/blob/main/rust/protocol/src/sealed_sender.rs.
  Sender keys go over the 1:1 sessions [S].
- **Server metadata.** "The Signal service has no record of your group
  memberships, group titles, group avatars, or group attributes." Members
  prove membership with anonymous credentials [V]
  https://signal.org/blog/signal-private-group-system/ ,
  https://eprint.iacr.org/2019/1416 (Chase, Perrin, Zaverucha).
- **Admins.** Remove, promote, restrict who edits info or adds members [V]
  https://signal.org/blog/new-groups/.
- **Invite links** with optional admin approval [V] https://signal.org/blog/group-links/.
- **Size** 1000 [S] (support page 403). History for new members, linked
  devices, slow mode, topics: not found (**unverified**).

## WhatsApp

Source unless marked: WhatsApp Encryption Overview whitepaper v9, 2026-02-25,
https://www.whatsapp.com/security/WhatsApp-Security-Whitepaper.pdf [V].

- **Fan-out.** Each sender makes a Chain Key and a signature key, "individually
  encrypts the Sender Key to each member of the group, using the pairwise
  messaging protocol", then "transmits the single ciphertext message to the
  server, which does server-side fan-out". Sender Keys go to each member
  *device*.
- **Removal.** "Whenever a group member leaves, all group participants clear
  their Sender Key and start over." The hash ratchet gives forward secrecy;
  there is no post-compromise security until the reset [I].
- **Multi-device.** Client fan-out to each device.
- **History for new members.** "Group Message History": 25 to 100 recent
  messages, end-to-end encrypted, the group is notified, admins can turn it off
  [V] https://blog.whatsapp.com/introducing-group-message-history-a-more-private-way-to-catch-up-in-group-chats
  (2026-02-19).
- **Size 1024, invite links, "Approve new participants"** [S]
  https://faq.whatsapp.com/3242937609289432/ , https://faq.whatsapp.com/902091421605313/ .
- **Server metadata.** The server knows the member list; it does the fan-out [I].

## Telegram

- **No end-to-end encryption in groups.** Secret chats are one-to-one only [V]
  https://core.telegram.org/api/end-to-end ; groups use server-client
  encryption [V] https://telegram.org/faq. The server sees everything [I].
- **Size.** Basic groups 200, supergroups 200,000 [V] https://core.telegram.org/api/channel.
- **Admin rights** (`change_info`, `post_messages`, `delete_messages`,
  `ban_users`, `invite_users`, `pin_messages`, `add_admins`, `manage_topics`, …)
  and per-member banned rights [V] https://core.telegram.org/api/rights.
- **Invite links** with expiry, usage limit and `request_needed`; bots see join
  requests [V] https://core.telegram.org/api/invites.
- **Slow mode**: one message every N seconds [V]
  https://core.telegram.org/method/channels.toggleSlowMode.
- **Topics** (forums) [V] https://core.telegram.org/api/forum. **Pins** [V] faq.
- **History for new members**: admin toggle [V]
  https://core.telegram.org/method/channels.togglePreHistoryHidden.

## Matrix (Megolm)

- Room keys go to each device over Olm; the room event is one ciphertext [V]
  https://spec.matrix.org/latest/client-server-api/ (v1.19).
- Clients MUST rotate on `rotation_period_ms` (default one week),
  `rotation_period_msgs` (default 100), or when a user or device leaves [V] same.
- Megolm forward secrecy is partial: a leaked ratchet value decrypts that
  message and all later ones in the session; there is no backward secrecy, so
  "periodically start a new session" [V]
  https://gitlab.matrix.org/matrix-org/olm/-/raw/master/docs/megolm.md.
- History visibility `shared` by default; v1.19 adds shareable sessions for new
  members [V] spec. The homeserver sees membership (state events) [I].

## DarkFi (darkirc)

- P2P event-graph chat over Tor by default [V] https://dark.fi/book/misc/darkirc/darkirc.html.
- A channel is encrypted only when all participants set the same channel
  secret (`ChaChaBox`); no forward secrecy, no per-member rotation, no identities
  [V] same page; name, nick and message are encrypted separately [V]
  https://dark.fi/book/misc/darkirc/specification.html.
- Removal means sharing a new secret out of band [I]. No admin model [V].

## MLS (RFC 9420)

- Group key updates cost O(log n) encryptions; Sender Keys need key update
  messages that scale as the square of the group for PCS [V]
  https://www.rfc-editor.org/rfc/rfc9420.txt §1.
- FS and PCS; removal is one Commit; each device is a leaf; a Welcome gives only
  the current epoch; the delivery service sees group id, epoch and timing
  (§16.4) [V].

## Comparison

"v2" is the proposal in spec 0011. Verdict is v2 against t3ams: **adopt**,
**improve**, or **differ, because …**.

| Property | Signal | WhatsApp | Telegram | Matrix | DarkFi | t3ams (2aa5452) | our v1 (0009) | proposed v2 (0011) | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| Submissions per message | 1 (multi-recipient) | 1 (server fan-out) | 1 | 1 | 1 (gossip) | 1, overwrites own last | n−1, plus n−1 ACKs | 1, no ACK | adopt, improve (own-message carry, no overwrite loss) |
| Group key | Sender Keys | Sender Keys | none (server) | Megolm per sender | one static secret | MLS (plus legacy epoch key) | none (pairwise) | one epoch key per group | differ, because MLS commits and Welcomes cost ~n pairwise statements in t3ams and need a KeyPackage service |
| Key delivery | pairwise | pairwise | n/a | pairwise (Olm) | out of band | pairwise control slot | n/a | welcome over DM; rekey as 1 multi-recipient statement on the topic | improve |
| Removal cost (n members) | ~n² [I] | ~n² [I] (all reset) | 0 | n per sender | out of band | 1 commit sent pairwise (~n) | 1 roster DM each | 1 statement, ~68 B per member | improve |
| FS / PCS | FS; PCS limited | FS; no PCS until reset | none | partial FS; no PCS | none | FS + PCS (MLS) | DM layer only | epoch FS; no PCS against a stolen identity key | differ, because MLS PCS costs O(n) pairwise here; see 0011 |
| Roles / permissions | admins | admins | admin rights matrix | power levels (**unverified**) | none | one admin; workspace 3 roles | one admin | owner/admin/member + per-permission flags | improve |
| Invite links | yes, approval optional | yes [S] | yes, expiry/limit/approval | yes (room alias) [I] | shared secret | no (non-goal) | no | yes; link carries no key | differ, because admission through an admin keeps the key off the link |
| Join requests | yes | yes [S] | yes | knock [I] | no | type only | no | yes | improve |
| Late-joiner history | none (**unverified**) | 25–100 msgs, E2E | admin toggle | shared visibility | 24 h DAG | none | none | ≤ 100 msgs over DM from the admitter, admin toggle | improve |
| Pins | **unverified** | [S] | yes | yes [I] | no | yes, any member | no | yes, permission flag | adopt |
| Slow mode | **unverified** | no [I] | yes | no [I] | no | backlog | no | yes, client-enforced | improve |
| Topics / threads | no [I] | no [I] | forums | threads | channels | threads | no | reserved field | differ, because later |
| Bots | no [I] | no [I] | first-class | appservices | no | via pca DMs/channels only | members | members and admins | improve |
| Multi-device | linked devices [S] | per device | cloud | per device | n/a | one leaf per user | per session | identity chat key shared by mds; device posting accounts in roster | improve |
| Max size | 1000 [S] | 1024 [S] | 200,000 | no fixed [I] | none | 10 | 16 | 1024 | improve |
| Infrastructure learns | nothing about membership | members, sender | everything | members, sender [I] | timing | group id hash, sender XID hash, signer | pairwise topics | L1: signer, random per-epoch topic, timing; L2: aliases only | improve |
| Depends on DM sessions | yes | yes | no | yes | no | pairwise key layer | fully | for welcome, join and history only | adopt |
