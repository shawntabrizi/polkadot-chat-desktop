# MLS vs the epoch key: survey, measurements, MIMI mapping (2026-09-24)

Research input for the owner's decision in `docs/review/mls-decision.md`.
The question: keep the groups v2 key layer (one admin-distributed epoch key
per group, `docs/spec/0011-groups-v2.md`) or move to MLS (RFC 9420). And:
align roles, permissions and content with the IETF MIMI drafts, or not.

Labels: **[V]** read on the cited page or file. **[M]** measured by us (script
in Appendix A). **[S]** seen only in a search snippet: unverified. **[I]** our
inference, not stated by the source.

## Sources

- polkadot-sdk `master` at `cccea0c9393792a97a7814b88ca73a7678c43fc7`
  (2026-09-24).
- chat-spec base spec at `7af4fabd67c8b82f7109880eee702eca303bddbd`
  (`.refs/chat-spec/base-spec.md`).
- RFC 9420 https://www.rfc-editor.org/rfc/rfc9420.txt and RFC 9750
  https://www.rfc-editor.org/rfc/rfc9750.txt, read in full.
- Repos cloned read-only on 2026-09-24: `marmot-protocol/marmot` `26fa6a6`,
  `nostr-protocol/nips` `62d5fed`, `discord/dave-protocol` `1b2b706`,
  `xmtp/libxmtp` `cc87802`, `xmtp/XIPs` `cc4ad7f`, `wireapp/wire-server`
  `0ff91a0`, `wireapp/core-crypto` `69f9c37`.
- t3ams: `paritytech/t3ams-spa` `develop` at
  `e81b83ed4e967f4db05ae93883b012fc01ddae66` (2026-09-24), compared with
  `2aa5452` of `group-designs.md`.
- MIMI drafts from datatracker and `ietf.org/archive/id`, fetched 2026-09-24.
- Chain fees: Polkadot Asset Hub (`statemint` 2005000, block #21044697) and
  Polkadot People (`people-polkadot` 2005000, block #10176318), runtime API
  `TransactionPaymentApi_query_length_to_fee`, 2026-09-24.

## 1. The rails (what every option must live with)

| Fact | Value | Source |
|---|---|---|
| Max statement size the node accepts | `MAX_STATEMENT_SIZE = MAX_STATEMENT_NOTIFICATION_SIZE − 1` = 1024·1024 − 1 = **1,048,575 bytes encoded**. Larger: `InvalidReason::EncodingTooLarge` | [V] `substrate/client/statement-store/src/lib.rs:178-181`, `:2764-2776`; `substrate/client/network/statement/src/config.rs:32` (`cccea0c`) |
| Allowance of a chat identity (devnet) | 50 live statements, 512,000 live bytes per account | [V] `docs/spec/efficiency.md` (pca finding 2026-09-24) |
| Allowance of a person (Paseo People) | 200 statements / 1 MiB | [V] `group-designs.md` (individuality `0676dbb`) |
| One statement per (account, channel) | a new one replaces the old one only with a strictly higher expiry | [V] base spec L112; `group-designs.md` |
| Expiry | high 32 bits = unix seconds; the store removes the statement after it. v2 uses now + 14 days | [V] base spec L113, 0011 |
| App-level chat statement size | "a unencrypted statement data limit of 4 KB SHOULD be sufficient" | [V] base spec L307 |
| Batching | a pending request "MUST extend the current request with the new message" | [V] base spec L309 |
| Efficiency rule | one submission per group message; no added submissions | [V] `efficiency.md` |

Two consequences drive the whole comparison [I]:

1. **The store is not a log.** An account's statements on one channel replace
   each other. A sequence of commits survives only if each commit gets its own
   channel (and its own share of the 50-statement, 512 KB allowance) or if one
   statement carries the recent commits.
2. **The store does not order.** Two admins' statements have no global order.
   Any MLS design here must prevent concurrent commits or pick a winner by a
   client-side rule.

## 2. MLS: what the standard requires

### 2.1 Ordering

- RFC 9750 §5.2 [V]: "the members of the group must agree on the order in
  which changes are applied. Concretely, the group must agree on a single MLS
  Commit message that ends each epoch and begins the next one."
- RFC 9420 §14 [V]: "Applications MUST have an established way to resolve
  conflicting Commit messages for the same epoch ... either by preventing
  conflicting messages from occurring in the first place, or by developing
  rules for deciding which Commit out of several sent in an epoch will be
  canonical."
- RFC 9750 §5.2.1 (strongly consistent DS) [V]: "The Delivery Service is
  trusted to break ties when two members send a Commit message at the same
  time." §5.2.2 (eventually consistent) [V]: "clients are responsible for
  reconciliation"; a client can pause with "a deterministic tie-breaking
  policy" or keep the previous state briefly and revert. "Most DSs will use
  the strongly consistent paradigm."
- RFC 9420 §14 [V]: "the Welcome message corresponding to a Commit MUST NOT be
  delivered to a new joiner until it's clear that the Commit has been
  accepted."

So the RFCs permit a DS with no ordering, if the application prevents
conflicts or has a deterministic rule [V]. A single committer is the
"prevent" branch.

### 2.2 Restricting who may commit is a permitted policy

- RFC 9750 §6.4 [V]: "an application could decide that a group administrator
  will be the only member to perform Add and Remove operations."
- RFC 9750 §3.5 [V]: "MLS does not itself enforce any access control on group
  operations ... MLS-using applications are responsible for setting their own
  access control policies."
- RFC 9750 §6.4 [V]: "If handshake messages are encrypted, any access control
  policies must be applied at the client, so the application must ensure that
  the access control policies are consistent across all clients."
- RFC 9420 §12.4 [V]: a proposal list is invalid if it includes "an Add when
  the sender does not have the application-level permission to add new users."
- RFC 9420 §16.11 [V]: "a DS could enforce a policy that only certain members
  are allowed to perform these operations."

Admin-only commits are therefore standard-conformant. The cost: the ratchet
tree fills only along committers' paths (see 2.5).

### 2.3 Membership visibility to the DS

RFC 9420 §16.4 [V]: MLS does not protect KeyPackages, GroupInfo, the clear
part of a Welcome, PublicMessage handshakes, "The unencrypted header fields in
PrivateMessage messages" and message lengths. §16.4.1: "MLS provides no
mechanism to protect the group ID and epoch of a message from the DS."
§16.4.3: exposing the ratchet tree "leak[s] the group's membership".
RFC 9750 §6.4 recommends encrypted handshakes for privacy [V]. On our rails we
can hide `group_id` and epoch by wrapping each MLS message in our own AEAD
under a key exported from the epoch [I]; v2 already hides the group id.

### 2.4 External commits, external joins, recovery

- External commit (RFC 9420 §12.4.3.2) [V]: lets a new member "add themselves
  to a group, without requiring that an existing member has to come online",
  using a GroupInfo with `external_pub`. Two flavours: a "join" commit and a
  "resync" commit "that replaces a member's prior appearance with a new one".
  It MUST carry a path and be signed by the joiner. "each GroupInfo object can
  be used for one external join, since that external join will cause the
  epoch to change."
- External proposals (§12.1.8) [V]: signers pre-listed in the
  `external_senders` extension may propose add, remove, psk, reinit,
  group_context_extensions, as PublicMessage.
- **A member cannot skip commits.** §12.4.2 [V]: the commit's epoch must equal
  the member's current epoch. A member that missed k commits needs all k, in
  order, or must rejoin.
- §16.12 [V]: such members "will need to either add themselves back with an
  external Commit or reinitialize the group from scratch."
- RFC 9750 §6.6 [V]: a member that lost state rejoins "as a new member and
  removing the member representing their earlier state" (a re-add with a new
  Welcome), optionally proving prior membership with an exported PSK;
  "Reinitializing in this way does not provide the member with access to group
  messages exchanged during the state loss window."
- ReInit (§12.1.5, §11.2) [V]: "creating a completely new group and shutting
  down the old one"; RFC 9750 §5.2.3 warns that parallel reinits can fork.
- RFC 9750 §5.3 [V]: automatic rejoin trusts the GroupInfo the DS provides; "a
  malicious member that deliberately posts an invalid Commit could also post a
  corrupted GroupInfo object".

Contrast [I]: in v2 a member that missed k rekeys needs only the latest key.
One `welcome` (2 DMs) restores it from any epoch.

### 2.5 Sizes in the default ciphersuite [M]

Measured with `ts-mls` 1.6.4, ciphersuite 1
(`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`), Basic credentials with a
32-byte identity, commits as PrivateMessage, no padding, sizes of the encoded
`MLSMessage`. "Admin-only tree" = only the admin has ever committed, so every
parent node off the admin's path is blank. "Full tree" = every parent node
is set (members on odd leaves each committed once).

| Bytes | n = 64 | n = 256 | n = 1024 |
|---|---|---|---|
| KeyPackage | 354 | 354 | 344 |
| Application message, 100 B plaintext | 321 | 322 | 323 |
| Commit adding 1 member (no path) | 518 | 513 | 524 |
| Welcome for 1 joiner, **with** `ratchet_tree` | 16,546 | 64,345 | 255,488 |
| Welcome for 1 joiner, without tree | 331 | 332 | 333 |
| GroupInfo with tree and `external_pub` | 16,655 | 64,588 | 255,867 |
| **Remove commit, admin-only tree** | **5,839** | **21,668** | **84,719** |
| Empty (update) commit, admin-only tree | 5,832 | 21,661 | 84,712 |
| Member's first commit, admin-only tree | 5,842 | 21,661 | 84,702 |
| **Remove commit, full tree** | **1,468** | **1,866** | ~2,300 (extrapolated, not measured) |
| Empty (update) commit, full tree | 1,133 | 1,367 | ~1,600 (extrapolated) |
| Create: one commit adding n − 1 | 22,444 | 90,201 | 361,206 |
| Create: its Welcome (with tree) | 23,613 | 94,078 | 375,835 |
| v2 rekey (68 B × (n − 1)), for comparison | ~4,300 | ~17,300 | ~69,600 |
| v2 state (~45 B per member), for comparison | ~2,900 | ~11,500 | ~45,000 |

The full-tree run at 1024 was not done (the n = 256 run took 871 s in pure
TypeScript; 1024 would take hours). The extrapolation adds the measured step
per doubling.

Independent checks:
- Soler et al., arXiv:2502.18303v2 (OpenMLS, groups to 10,000) [V]: Welcome
  and GroupInfo "contain a full copy of the Ratchet Tree" and grow linearly;
  commits from a degraded tree grow linearly. Their note [V]: "real-world
  messaging applications usually limit updates to one or more administrators.
  Thus, members should be allowed to periodically update their own leaf node
  to prevent the accumulation of blanked intermediate nodes."
- A structural estimate from the RFC 9420 wire formats gave ~1.1/1.35/1.6 KB
  for a full-tree update commit and ~18/72/290 KB for a Welcome with tree; it
  agrees with the measurements.
- No published byte table for 64/256/1024 was found (Wire, Webex, OpenMLS
  blog, IETF slides searched).

**Finding [M].** With admin-only commits, an MLS commit costs about 83 bytes
per member, the same order as the v2 rekey (68 bytes per member). MLS's
O(log n) commit holds only when most members commit themselves. The Welcome
(or a GroupInfo for catch-up) carries the tree: 255 KB at 1024, half of a
chat identity's 512,000-byte allowance.

### 2.6 Libraries for Electron, the browser and Node

| Library | Version, date | Licence | Build | Notes |
|---|---|---|---|---|
| `ts-mls` (LukaJCB) | 1.6.4, 2026-08-28 (2.0.0-rc.16 on another tag) | MIT | pure TypeScript, 692 KB unpacked, one dependency `@hpke/core`; Node 20+ | claims a "full implementation of RFC 9420"; test vectors and interop dirs; "has not undergone a formal security audit". Used for the measurements above [V][M] |
| `@wireapp/core-crypto` | 10.5.3, 2026-09-23 | **GPL-3.0** | 7.6 MB `.wasm`; npm tarball ~16 MB, 50.9 MB unpacked (native Node libs) | Wire's openmls fork; t3ams uses 10.3.0. GPL is copyleft for any app that ships it [V] |
| `openmls` | crate 0.9.0, 2026-08-25 | MIT | `js` feature for wasm; npm `openmls-wasm` 0.1.0 (2025-10-10, single release, 1.4 MB `.wasm`) "a step on the way to proper Wasm support" | no JS API of production quality today [V] |
| `mls-rs` (AWS) | crate 0.56.0, 2026-08-19 | Apache-2.0 OR MIT | WASM builds; Web Crypto provider "Experimental", suites 2, 5, 7 only | no npm package; "has not yet received a full security audit" [V] |

No `@mls/*`, `openmls`, `mls-rs` or `mlspp` package exists on npm [V]. The
desktop repo is `"private": true` with no licence file, so a GPL dependency
is a decision, not a blocker [I]. Mobile would use openmls, mls-rs or
core-crypto through native bindings [I].

## 3. Deployments and their ordering answer

| Deployment | Who commits | Who orders | Missed commit / desync | Cap | Source |
|---|---|---|---|---|---|
| Wire | any member client; the backend checks role actions (`ActionDenied AddConversationMember …`) | central backend (galley): one commit per epoch under a commit lock; stale epoch → 409 `mls-stale-message` | external commit from the stored GroupInfo; `mls-reset-conversation` "Reset an MLS conversation to epoch 0"; core-crypto buffers future-epoch messages | `maxConvSize: 500` | [V] wire-server `0ff91a0`: `libs/wire-api/src/Wire/API/Error/Galley.hs:282`, `…/MLS/Message.hs`, `…/Commit/ExternalCommit.hs`, `charts/wire-server/values.yaml` |
| Cisco Webex (meetings) | one "leader" (usually the host), chosen by Webex | Webex servers route | not public | 1000 | [V] Cisco white paper c11-744553; blog.webex.com "scalable end-to-end security" |
| GSMA RCS (RCC.16 v2.0, 2025-07-18) | any group client | the "MLS Conversation Focus" server: "Accept exactly one Commit in each Epoch"; stale → 409 | §10.1 "Self-Heal": fetch GroupInfo, external commit to resync own leaf, ~5 retries | n/a | [V] RCC.16 v2.0 PDF. Google Messages uses it: [S] only |
| Discord DAVE (voice) | all media-session members | voice gateway: "broadcasts the first commit it receives for a given epoch" | client flags opcode 31; gateway proposes its removal; client resets and is re-added | none stated | [V] `dave-protocol/protocol.md` `1b2b706` |
| XMTP v3 | any member within XIP-47 policies (`ALLOW_IF_ADMIN_OR_SUPER_ADMIN` …) | today: nodes run by XMTP Labs ("do not use a blockchain"); decentralized design (XIP-49): commits "chain-anchored to a single fixed originator" (`Originators::MLS_COMMITS = 0`) on an L3 chain; app messages on the broadcast network | intents republish on `WrongEpoch`; commit log (only super admins publish) detects forks; a forked client asks super admins to re-add it | `MAX_GROUP_SIZE = 250` | [V] docs.xmtp.org/network/faq; XIPs `cc4ad7f`; libxmtp `cc87802` (`crates/xmtp_configuration/src/common/d14n.rs`, `groups/commit_log.rs`) |
| Nostr Marmot (successor of NIP-EE) | admins for invites, removals, settings; non-admins only a self-update commit or a SelfRemove-only commit | **nobody**: relays store kind 445 events; each client runs a deterministic fork choice ("Commits are the consensus log"; relay time and arrival order "MUST NOT choose group state") | fork → `Recovering`, convergence pass (1 s quiet / 5 s max), `max_rewind_commits = 5`; beyond that: rejoin from a fresh admin Welcome. Commits never carry an expiry: "group-state history stays fetchable for members catching up" | none stated | [V] marmot `26fa6a6`: `protocol-core/group-messaging.md:42-58`, `protocol-core/convergence.md:49-75`, `transports/nostr.md:180-188` |
| NIP-EE (old) | admins for membership; any member for own credential | client rule: lowest `created_at`, then lowest event id | keep old state briefly | — | [V] `nips/EE.md` `62d5fed` (marked superseded) |
| Matrix | — | MSC2883 "Matrix-flavoured MLS" (forking epochs, `epoch_creator`, `resolves`): open draft; proof of concept only | — | — | [V] arewemlsyet.com (2025-06-20); uhoreg FOSDEM 2026 slides |
| Phoenix R&D (Air) | any | central DS, "first-come, first-served" | — | — | [V] blog.phnx.im 2025-10-29 |
| t3ams | the one group admin | nobody: commits go pairwise, one sealed copy per member | new since `2aa5452`: OQ7 "losing concurrent commits are not rebased"; the loser's state is discarded and the group is re-founded with a `recreate` bundle and a fresh Welcome; messages the loser sent meanwhile are lost | 10 (`GROUP_CHAT_MAX_MEMBERS`) | [V] t3ams `e81b83e` `docs/2026-08-16-mls-implementation-decisions.md` (OQ7), `src/features/groups/domain/group.ts:52` |

**Option B precedent: none found.** No deployment or specification has all
four properties of option B: admins only commit, commits go on a shared
broadcast topic, no server or chain orders them, and members catch up from
that topic. The closest:

- **Marmot**: broadcast relays, no ordering server, admin-gated membership.
  But non-admins may commit self-updates, and a fork-choice machine handles
  races. Relays keep commits with no expiry. It is a specification with
  implementations (not checked for production scale).
- **Webex**: one committer at a time, but chosen and routed by Webex servers.
- **draft-xue-distributed-mls-01** (2025-09-09): each member is the only
  committer of its own "Send Group"; no DS. It does not define catch-up. It is
  an individual draft, not a deployment.
- **t3ams**: one admin commits, but sends commits pairwise (option C), cap 10.

## 4. Our five options under the store's rules

Options:
- **A**: epoch key as built (0011).
- **B**: MLS, admin-only commits on the group topic, with a catch-up rule.
- **C**: MLS, admin commits sent pairwise (t3ams).
- **D**: MLS, any-member commits ordered by a sequencer (a bot DS, or a
  Polkadot chain).
- **E**: Sender Keys (Signal, WhatsApp).

The catch-up rule assumed for B [I]: each commit goes on its own per-epoch
channel `ChCommit_e`, so commits do not replace each other; each commit
statement also carries the previous commits of the last 24 h (the v2 carry
idea), within a byte cap; the admin keeps one current GroupInfo (with tree,
encrypted to members) on the topic as a snapshot for joiners; a member that
falls further behind asks an admin to re-add it (Remove + Add, new Welcome).

### 4.1 Cost per operation

Submissions exclude the join-by-link handshake (request, accept,
`joinRequest`), which is the same for all options. "DM" = one base-spec
request plus its ACK.

| | A epoch key | B MLS admin, topic | C MLS admin, pairwise | D MLS any member, sequencer | E Sender Keys |
|---|---|---|---|---|---|
| Ordering mechanism | fork rule on state (lower signer wins); keys, not a chain, so forks are cheap | one committer per group; per-epoch channels; forks must be prevented, not merged | one committer; each member gets its own copy | a sequencer: a bot DS, or a chain block order | none needed (no shared state) |
| Per message | **1** | **1** (MLS app message re-encrypts the carry) | **1** | **1** | **1** |
| Per removal, n = 64 | 2 (rekey ~4.3 KB + state) | 1 commit 5.8 KB + carry + snapshot refresh 16.7 KB | 63 DMs × 5.8 KB | 1 commit ~1.5 KB via the sequencer | 63 multi-recipient statements of ~4.3 KB (pairwise: 63·62) |
| Per removal, n = 256 | 2 (~17 KB + state) | 1 commit 21.7 KB + snapshot 64.6 KB | 255 DMs × 21.7 KB | 1 commit ~1.9 KB | 255 × ~17 KB |
| Per removal, n = 1024 | 2 (~70 KB + ~45 KB) | 1 commit 84.7 KB + snapshot 256 KB | 1023 DMs × 84.7 KB (~87 MB total) | 1 commit ~2.3 KB | 1023 × ~70 KB |
| Per join (admin adds) | 1 state + 1 DM `welcome` | KeyPackage 1 + commit 1 (~0.5 KB) + Welcome 1 (331 B over DM, tree from the snapshot) | commit to each member (n − 1 DMs) + Welcome with tree 16.5–255 KB pairwise | as B, or the joiner's own external commit (~2 KB + GroupInfo fetch) | 1 statement (newcomer's key to all) + n − 1 keys to the newcomer |
| Largest statement vs node max 1,048,575 B | 115 KB at 1024 | snapshot 256 KB; create-Welcome 376 KB | 255 KB Welcome in one DM (DM guideline 4 KB) | 256 KB GroupInfo | 70 KB |
| Against the 512,000-byte devnet allowance, n = 1024 | fits (~115 KB live for an admin) | snapshot 256 KB + ~3 commits of 85 KB: full | infeasible | fits (commits small; snapshot as B) | fits per sender |
| Offline member missed k changes | skip to the latest key; missed rekey → `keyRequest` → `welcome` (2 DMs) | replay k commits from per-epoch channels (kept ≤ 14 d, bounded by allowance: at 1024 about 3 live); beyond: re-add by admin (1 commit + Welcome) | lost when the pairwise slot is overwritten (t3ams finding); admin recreates | replay k commits from the sequencer (chain: needs an archive node or indexer, since pruned nodes drop block bodies [I]); or external-commit resync | ask each changed sender for its new key |
| Forward secrecy per message | no: per epoch (7 d rotation, keys kept 14 d) | yes, within the epoch (secret tree) | yes | yes | yes (per-sender hash ratchet) |
| Post-compromise security; who heals | none against a stolen identity chat key (rekey entries use static `K(A, B)`) | the admin heals itself and the epoch; a member heals only when the admin commits that member's Update proposal (sparse tree encrypts to each leaf key) | as B | every member heals itself with one commit | none against a stolen identity key (keys travel over static-key DMs) |
| Privacy to the store | signers, random per-epoch topic, sizes (rekey size ≈ n) | as A if MLS framing is wrapped in our AEAD; KeyPackage topic shows who uses groups; commit size ≈ n | pairwise statements admin → each member: co-membership by timing | bot DS: the bot sees everything the store sees. Chain: committer account and cadence public and permanent | n statements per removal: strong co-membership signal |
| Library / complexity | built, no dependency | MLS library (ts-mls MIT, unaudited; or core-crypto GPL 7.6 MB) + KeyPackage topic + commit channels + carry + snapshot + single-committer election | library + t3ams's pairwise control slot | library + sequencer (a bot DS or chain extrinsics, an indexer, and DOT on every committer) | per-sender chains + distribution; no library |
| Migration from v2 (test groups only) | 0 | new wire format, groups recreated; pca `bot-core` must adopt MLS too (bots are members and admins) | as B | as B + sequencer | new format, recreate |
| Interop prospects | our clients only; the phone team implements from spec (small) | MLS core shared in principle; no other system uses our transport | closest to t3ams, but t3ams caps at 10 and uses workspace channels | conceptually XMTP's d14n (commits on a chain); no wire interop | none |

### 4.2 D with a Polkadot chain as the sequencer

Length fee on Polkadot Asset Hub and Polkadot People (both spec 2005000) is
**5 µDOT per byte** [V, runtime API `query_length_to_fee`]: 1,600 B →
0.008 DOT, 6,000 B → 0.03, 22,000 B → 0.11, 85,000 B → 0.425,
256,000 B → 1.28 DOT. The weight part for a small call (200 M ref-time, an
assumption) is ~0.0004 DOT. So a full-tree commit costs about 0.01 DOT, a
sparse-tree commit at 1024 about 0.43 DOT [M+V]. Paseo endpoints did not
answer: testnet fees **unverified**. Block time and whether `system.remark`
is filtered on People: **unverified**.

Against the chain: every committer needs DOT (a chat identity holds none);
commits are public and permanent (worse than level 1 privacy); commit
latency is at least one block; members need block bodies (archive or
indexer). For: a total order at no trust in a bot, and no allowance cost. A
bot DS is cheaper but makes the bot a trusted orderer, which v2's bots
already partly are (admitters, history providers) [I].

### 4.3 Is option B sound?

**Technically sound, with conditions** [I]:
1. Exactly one committer per group at a time (the owner, or a designated bot
   admin). Two admins committing at once fork the group; MLS cannot merge
   forks, so the loser's members must be re-added (t3ams OQ7 does this).
2. Commits on per-epoch channels, each carrying the commits of the last 24 h,
   within an allowance budget.
3. A snapshot GroupInfo for joiners, and re-add by the admin as the last
   resort.
4. Members send Update proposals now and then, which the admin commits;
   without them, member PCS never happens and the tree stays sparse.

**But it buys little on these rails.** Admin-only commits keep the tree
sparse, so commits cost ~83 B per member, like the v2 rekey. B adds per-message
FS and member PCS (when the admin commits member updates), and pays with a
library, a strict commit chain that the store does not keep, a 256 KB tree
snapshot at 1024, and no precedent. The missing precedent is not a proof of
failure; it is a reason to prototype before committing to it.

## 5. MIMI

### 5.1 Status (2026-09-24) [V]

| Draft | Latest | Date | Intended status | State |
|---|---|---|---|---|
| draft-ietf-mimi-arch | -03 | 2026-07-06 | Informational | WG document; not sent to the IESG |
| draft-ietf-mimi-protocol | -06 | 2026-04-25 (expires 2026-10-27) | Standards Track | WG document |
| draft-ietf-mimi-content | -09 | 2026-07-04 | Informational | WG document; its milestone "Mar 2025 … to IESG" is missed |
| draft-ietf-mimi-room-policy | -04 | 2026-07-06 | Informational | WG document |

No MIMI RFC exists. None is in WGLC, at the IESG or in the RFC Editor queue.
The protocol draft lists identifiers, knock/invite flows and authentication
as open; its capability names differ from room-policy's.

### 5.2 What MIMI assumes that we cannot provide

- **A hub.** protocol-06 §1 [V]: "Each MIMI protocol room is hosted at a
  single provider (the 'hub' provider) ... responsible for ordering and
  distributing messages, enforcing policy, and authorizing messages. It also
  keeps a copy of the room state, which includes the room policy and
  participant list." We have no server; the store neither orders nor
  enforces.
- **Providers** that store KeyPackages for their users and talk over mutually
  authenticated HTTPS (§4.1, §5.2) [V].
- **MLS** as the key layer; room policy lives in the MLS GroupContext as
  `app_data_dictionary` components (room-policy §1) [V].
- **Hub timestamps for order**: content-09 §3.4 [V]: "Message ordering is
  provided by the Hub in the form of the accepted timestamp."
- `mimi://` URIs for users, clients and rooms; message IDs hash sender URI
  and room URI (content §3.3) [V].
- The participant list is visible to the hub (protocol §6) [V].

### 5.3 Mapping: GroupState → MIMI room policy

| Our field (0011) | MIMI field | Note |
|---|---|---|
| `groupId` (UUID) | room URI `mimi://<provider>/r/<id>`; MLS `group_id` | we have no provider domain |
| `epoch`, `version` | MLS epoch; AppDataUpdate per commit | MIMI has no separate state version |
| `name` | `RoomMetaData.room_name` (protocol §7.6) | |
| `avatar` | `RoomMetaData.room_avatar` | |
| `members[]` | `ParticipantListData{ UserRolePair{user, role_index} }` (protocol §7.5) | |
| `Member.role` 0/1/2 | `role_index` into `roles_list` (`RoleData`), e.g. ordinary_user / group_admin / super_admin (room-policy App. A) | index 0 = no role, 1 = banned are fixed |
| `Member.permissions` (per-member flags) | **no equivalent**: capabilities belong to roles, one role per user | per-member flags need one role per distinct flag set (private range 0xF000–0xFFFF) |
| `Member.posting` (device accounts) | the user's MLS clients; `multi_device`, `canAddOwnClient` | |
| `defaultPermissions` | the role given to new participants | |
| `joinPolicy` 0 (admins add) | no `canOpenJoin` on role 0; `canAddParticipant` on admins | |
| `joinPolicy` 1 (link with approval) | `canKnock` / `canAcceptKnock` are **reserved** (not defined) | no MIMI form yet |
| `joinPolicy` 2 (link open) | `canOpenJoin` on role 0 + `JoinLinkPolicy` | |
| `invites[]` (`expiresAt`, `maxUses`) | `JoinLinks` component; `JoinLinkPolicy{on_request, join_link, multiuser, expiration}` | no use counter |
| `historyShare` (≤ 100 messages) | `HistoryPolicy{history_sharing, roles_that_can_share, automatically_share, max_time_period}` | MIMI bounds by time, we by count |
| `slowModeSecs` | **none** | |
| `pinned[]` | **none** | |
| `topics` (reserved) | content `topicId`; `canStartTopic` … | |
| bots (members, admins) | `BotPolicy{allowed_bots}` with `bot_role_index` | |
| `createdAt` | none | |

Permission bits → MIMI capabilities (room-policy §8, §10.2):

| Our bit | MIMI capability |
|---|---|
| 0x0001 post | `canSendMessage` (0x0100) |
| 0x0002 add members, create invites | `canAddParticipant` (0x0000); `canCreateJoinCode` (0x0007, reserved) |
| 0x0004 pin | none |
| 0x0008 change info | `canChangeRoomName`/`Description`/`Avatar`/`Subject` (0x0300–0x0303); slow mode and policy: none / `canChangeRoomMembershipStyle` (0x0502) |
| 0x0010 remove members | `canRemoveParticipant` (0x0001), `canKick` (0x000c), `canBan` (0x000a) |
| 0x0020 approve joins | `canAcceptKnock` (0x000e, reserved) |
| 0x0040 manage admins | `canChangeUserRole` (0x000f), `canChangeRoleDefinitions` (0x0503) |
| 0x0080 delete others' messages | `canDeleteOtherMessage` (0x010b) |

### 5.4 Mapping: message contents → MIMI content (CBOR)

| Ours (base spec kinds, SCALE) | MIMI content-09 |
|---|---|
| `messageId: UUID`, `timestamp` | `messageId` = hash(sender URI, room URI, message, salt); order by hub timestamp |
| text (0), richText (15) | `SinglePart` `text/plain` or `text/markdown;variant=GFM-MIMI` |
| reply (7) | `inReplyTo` |
| reacted (4) | `inReplyTo` + disposition `reaction` |
| reactionRemoved (5) | `replaces` the reaction message + NullPart |
| edit (12) | `replaces` = id of the first version, new body |
| deleted (21) | `replaces` + NullPart |
| attachment (250) / FileVariant | `ExternalPart{url, key, nonce, contentHash, …}` |
| buttons (242), buttonPress (243), transactionReference (245), token (1), send (2), coinagePayment (16) | none: custom media types or extensions |
| botInfo (244) | partly room-level `BotPolicy` |
| typing (240), seen (241) | not in content; draft-mahy-mimi-message-status; room-policy `StatusNotificationPolicy` |
| groupLeave (248) | MLS SelfRemove / Remove + participant-list update |
| mentions (in text) | Markdown links to the user URI |

### 5.5 Adopt the vocabulary without the transport?

Sensible in a narrow form [I]:
- **Yes**: use MIMI capability names in our spec text and UI strings, and
  keep a mapping table (above). It costs nothing on the wire, and it gives a
  checklist of features (ban vs kick, history by time, link policy).
- **No**: do not adopt MIMI's structures on the wire. They are unstable
  (four WG drafts, no RFC), they assume MLS GroupContext components and a hub,
  and they drop features we have (per-member permissions, pins, slow mode,
  approval queue). CBOR content would also break the phone team's SCALE model.
- Revisit when room-policy and content reach the IESG.

## Appendix A: measurement script

`ts-mls` 1.6.4 with `@noble/hashes`, `@noble/curves` 2.0.1,
`@noble/ciphers` 2.1.1, Node 24.13.1, macOS, 2026-09-24. Core of the script
(the full-tree variant adds a loop in which members on odd leaves commit once
and all states process it):

```js
const impl = await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"))
const enc = (m) => encodeMlsMessage(m).length
// admin creates, adds n-1 KeyPackages in one commit (ratchetTreeExtension: true)
let r = await createCommit({ state: admin, cipherSuite: impl }, { extraProposals: adds, ratchetTreeExtension: true })
// add one member: commit + Welcome with and without tree
// remove one member: createCommit(..., { extraProposals: [{ proposalType: "remove", remove: { removed: n - 1 } }] })
// GroupInfo: createGroupInfoWithExternalPubAndRatchetTree(admin, [], impl)
// app message: createApplicationMessage(admin, new Uint8Array(100), impl)
```

Chain fees: `state_call("TransactionPaymentApi_query_length_to_fee", u32 LE)`
and `TransactionPaymentApi_query_weight_to_fee(Weight)` over HTTPS JSON-RPC
to `polkadot-asset-hub-rpc.polkadot.io` and `polkadot-people-rpc.polkadot.io`.

## Unverified

- Full-tree commit size at 1024 (extrapolated, not measured).
- Testnet (Paseo) fees; block time; whether People filters `system.remark`.
- Google Messages' use of RCC.16 MLS ([S] only).
- Webex's handling of commit conflicts (not public).
- Marmot implementations at production scale.
- Whether a mobile MLS binding fits the phone team's stack.
