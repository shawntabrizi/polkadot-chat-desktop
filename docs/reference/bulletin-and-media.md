# Bulletin chain and chat media: findings and comparison (2026-09-24)

Research input for `docs/spec/0012-attachments.md`. Question: how can the chat
protocol carry images, files and voice notes end-to-end encrypted, with the
Bulletin chain as the blob store, at one Statement Store submission per
message?

Labels: **[V]** read in the cited file, page or live RPC answer. **[S]** seen
only in a search snippet or a third-party page: unverified. **[I]** our
inference, not stated by the source.

## Sources

- Bulletin: `paritytech/polkadot-bulletin-chain` upstream `main` at
  `71c75c624ebb8b57cba3e07e11820eee498b5942` (2026-09-17), read with `gh api`.
  The local clone (`b6c2827d`, 2026-07-08) is 94 commits behind: upstream
  moved `renew` and auto-renew into a new `pallets/data-renewal`. Paths below
  are upstream unless marked.
- HOP node side: `paritytech/polkadot-sdk` `substrate/client/hop`, identical on
  master `83b147a9b29a` (2026-09-23).
- Fellowship runtimes: `polkadot-fellowship/runtimes` `1385f8296`
  (2026-09-22); Bulletin storage pallets arrived in `a20e73afb` (2026-08-25).
- People-chain storage claims: `paritytech/individuality` `dbcf9b8b61`
  (2026-09-08), `runtimes/next-people-paseo`.
- Phone apps: `polkadot-app-android-v2` `ba3e15749` (2026-08-27),
  `polkadot-app-ios-v2` `88f790aa0` (2026-08-25); desktop app
  `polkadot-desktop` `44090bb3` (2026-09-17).
- t3ams: `paritytech/t3ams-spa` `develop` `952b2870` (2026-07-25).
- pca: `polkadot-chat-agents` `desktop/rfc-0003` `675f948` (2026-09-23).
- Tooling: `bulletin-deploy` `bddd640`, `product-sdk` `1981a2d`.
- Chat spec: `paritytech/chat-spec` `7af4fab` (2026-07-10), `base-spec.md`.
  That copy was stale (branch `rfc/message-deletion`). Main at `134cad7`
  (2026-07-31) has the same `base-spec.md` and adds
  `rfcs/0001-file-transfer-improvements.md` (RFC-0001) and
  `rfcs/rfc-0004-x25519-chacha20poly1305.md` (RFC-0004). Checked 2026-09-24.
- Live RPC on 2026-09-24 against `https://bullet.sik.rocks` (devnet) and
  `https://paseo-bulletin-next-rpc.polkadot.io`.

## 1. Two rails on one chain

The Bulletin chain gives a chat client two ways to move a blob. The base spec
uses the first; this RFC proposes the second.

| | **HOP** (hand-off pool) | **Transaction storage** |
|---|---|---|
| What | an off-chain, disk-backed pool on one node, JSON-RPC | an on-chain extrinsic; data indexed in the block body |
| Calls | `hop_submit`, `hop_claim`, `hop_ack`, `hop_poolStatus` | `TransactionStorage.store(data)`, `store_with_cid_config(cid, data)` |
| Chain transaction? | no, unless promoted | yes, one per blob |
| Lifetime | until every recipient acks, or 24 h | 14 days, renewable |
| Recipients | fixed list of ≤ 256 keys at submit | anyone with the CID can fetch the ciphertext |
| Propagation | none: the pool is per node | every full node holds the block body |
| Max blob | 2 MiB (`max_promotion_size`) | 2 MiB per transaction |
| Gate | the submitter must hold a Bulletin authorization | the same authorization |
| Used by | Polkadot phone apps, t3ams standalone, pca | Proof-of-Ink evidence, product preimages, `bulletin-deploy` |

## 2. Transaction storage: facts

**Pallets.** A Bulletin-specific fork, not the SDK pallet: `TransactionStorage`
(index 40), `HopPromotion` (41), `DataRenewal` (42) in both the Paseo runtime
(`runtimes/bulletin-paseo/src/lib.rs:626-631`) and Fellowship Polkadot
(`system-parachains/bulletin/bulletin-polkadot/src/lib.rs:577-582`). [V]
The pallet doc says it is "designed to be used on chains with no transaction
fees" (`pallets/transaction-storage/src/lib.rs:16-21`). [V]

**Calls.** [V] `pallets/transaction-storage/src/lib.rs`:
- `store(data: Vec<u8>)`, call 0 (L406-412): always Blake2b-256 and the raw
  codec; `feeless_if(true)`.
- `store_with_cid_config(cid: CidConfig, data)`, call 9 (L425-435).
- `authorize_account(who, transactions: u32, bytes: u64)`, call 3 (L466-489);
  `authorize_preimage(content_hash, max_size)`, call 4; `refresh_account_authorization(who)`, call 7.
- `data` must be the last argument: the trailing bytes of the extrinsic are
  what the node indexes (L1044-1051).
- Renewal (`pallets/data-renewal/src/lib.rs`): `renew(entry: TransactionRef)`
  call 0 (L267-292), `force_renew` call 1, `enable_auto_renew(content_hash)`
  call 2, `disable_auto_renew` call 3; all feeless.
  `TransactionRef = Position { block, index } | ContentHash([u8; 32])`
  (`primitives/src/lib.rs:113-116`), so a client can renew by content hash
  alone.

**Content id.** [V] `primitives/src/cids.rs:37-150`: CIDv1; hash Blake2b-256
(multihash `0xb220`, default), SHA2-256 (`0x12`) or Keccak-256 (`0x1b`); codec
raw `0x55` or DAG-PB `0x70`. The event is `Stored { index: u32, content_hash,
cid: Option<Cid> }` (`lib.rs:738`, emitted at L1095-1099); `index` is the
position in that block's list and the block is implicit. So a blob stored with
`store` has the CID `0x01 0x55 0xa0e402 0x20 ‖ blake2b_256(data)`, base32
`bafk2bzace…`. [V] computed in `vectors-0012.md`.

**Limits.** [V] `lib.rs:66-78` and runtime `storage.rs`:

| Limit | Value |
|---|---|
| Max bytes per transaction | 2 MiB (`DEFAULT_MAX_TRANSACTION_SIZE = 2 * 1024 * 1024`, "aligned with the Bitswap maximum block size") |
| Max indexed transactions per block | 512 |
| Block length | 10 MiB, 90 % for normal transactions (≈ 9 MiB) (Paseo `lib.rs:196-211`) |
| Block time | 6 s (`DAYS = 14400` blocks) |
| Stated throughput | "~127 GiB/day" (`docs/authorizations.md:9-17`) |
| Retention | 201,600 blocks = 14 days (`DEFAULT_RETENTION_PERIOD = 2 * 100800`) |
| Renewed-bytes cap, whole chain | 1.7 TiB (`MaxPermanentStorageSize`, governance value) |

Devnet check [V, live 2026-09-24]: `https://bullet.sik.rocks` answers
`system_chain = "Bulletin Paseo"`, `ParachainInfo.ParachainId = 1010`
(`0xf2030000`), spec `bulletin-paseo` 2004000, genesis
`0xe101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a59`,
`TransactionStorage.RetentionPeriod = 201600`. Its metadata has
`store_with_cid_config`, `authorize_account`, `HopPromotion`, `DataRenewal`,
`enable_auto_renew`, `Utility.batch_all` and `Sudo`. Its `rpc_methods` list
`bitswap_v1_get`, `hop_submit`, `hop_claim`, `hop_ack`, `hop_poolStatus`;
`hop_poolStatus` returns `maxBytes = 10737418240` (10 GiB). Paseo Bulletin Next
is para 1501, genesis `0x8cfe6717…0a22`, spec 1000026, and has
`bitswap_v1_get` but no `hop_*` methods on its RPC node (HOP there is on
`wss://paseo-hop-next-{0,1}.polkadot.io`).

**Retention and proofs.** [V] `on_initialize(n)` drops
`Transactions[n − RetentionPeriod − 1]` (`lib.rs:282-329`); "When data reaches
the end of its retention period without being renewed, it is automatically
cleaned up" (README L99-104). A renew writes a fresh entry and restarts the
14-day clock (`docs/authorizations.md:27-41`). Collators prove storage with a
mandatory inherent over a random 256-byte chunk of block `n − RetentionPeriod`
(`lib.rs:969-987`, `:334-360`).

**Fees and who pays.** [V]
- `store`, `store_with_cid_config` and every renewal call are feeless:
  "Authorization is the sole economic gate" (`docs/authorizations.md:43`). The
  pallet has `Currency = NoCurrency` (Paseo `storage.rs:99-101`). The storage
  values `ByteFee = 10` and `EntryFee = 1000` exist on devnet [V, live] but
  `store` is `feeless_if(true)`, so they do not apply [I].
- A signed store needs an unexpired `Authorizations[Account(who)]`; without
  one it fails with `InvalidTransaction::Payment` (`lib.rs:1515-1520`).
- **Soft cap on store, hard cap on renew.** A store over the account's
  authorized bytes is not rejected; it loses the priority boost
  (`ALLOWANCE_PRIORITY_BOOST`, `extension.rs:362`; README L108-118). A renew
  over it fails with `PermanentAllowanceExceeded`
  (`docs/authorizations.md:98-125`). So a client must police its own upload
  budget; the chain will not stop it. [I]
- Authorization lasts 14 days (`AuthorizationPeriod = 14 * DAYS`). A second
  grant on an unexpired authorization adds to the caps without extending the
  expiry (`lib.rs:447-456`).
- Who may authorize: Root, the People chain over XCM (Paseo allows paras 1502
  and 5140, `xcm_config.rs:132-153`; Polkadot `Equals<PeopleLocation>`), and
  accounts in `AllowedAuthorizers` (Paseo `storage.rs:108-117`).

**How a person gets storage.** [V] The People chain's
`Resources.claim_long_term_storage(period, counter, target)` (call 12, a
ring-VRF anonymous membership proof, `pallets/resources/src/lib.rs:1036-1050`)
sends XCM `authorize_account` to Bulletin (`runtimes/next-people-paseo/src/people.rs:1729-1790`,
`BULLETIN_CHAIN_PARA_ID = 1501` at L1183). Per claim
(`parameters.rs:70-87`): a person gets **100 transactions / 8 MiB**, a lite
person 10 / 4 MiB; `ClaimsPerPeriod = 100`; `PeriodDuration = 14*24*60*60`
(unit, seconds or blocks: **unverified**; whether `ClaimsPerPeriod` is per
person: **unverified**). The devnet Bulletin (para 1010) metadata has no
`claim_long_term_storage` (it lives on People); which People chain authorizes
devnet Bulletin: **unverified**.

**Testnet shortcut.** pca's `bot-core/lib/testnet-file-allowance.mjs:1-50,
259-285` signs `TransactionStorage.authorize_account` with the public dev key
`//Eve` for 1,000 transactions / 100 MB on named testnets, "mirroring what the
public faucets do"; `bulletin-deploy` does the same with `//Alice` or `//Eve`
(`src/pool.ts:235-290`). Whether `//Eve` is an allowed authorizer on devnet
today: **unverified** (the code path exists; we did not run it).

## 3. Retrieval

- **RPC**: `bitswap_v1_get(cid) -> hex` returns the raw indexed transaction by
  CID, with no DAG assembly (`polkadot-sdk/substrate/client/rpc-spec-v2/src/bitswap/`).
  Present on both devnet and Paseo Next RPC nodes [V, live]. No
  `transactionStorage_*` RPC exists; the runtime API
  `BulletinTransactionStorageApi { account_authorization, can_store, can_renew }`
  answers quota questions (`runtime-api/src/lib.rs:38-56`). [V]
- **Bitswap**: `--ipfs-server` makes a node "join the IPFS network and serve
  transactions over bitswap protocol"; CIDv1 with a 32-byte Blake2b-256,
  SHA2-256 or Keccak-256 hash; at most 16 wanted blocks per request
  (`client/network/bitswap/src/lib.rs:34-56`). "The node speaks IPFS Bitswap
  (libp2p), not HTTP" (README L78-82). litep2p or libp2p: **unverified**.
- **HTTP gateways**: devnet `https://devnet-ipfs.api.polkadotcommunity.foundation`
  (`bulletin-deploy/assets/environments.json`, para 1010) and Paseo Next
  `https://paseo-bulletin-next-ipfs.polkadot.io`; both answer HTTP 200 for
  `/ipfs/bafkqaaa` [V, live]. The Bulletin docs mark gateways "Deprecated",
  Helia P2P "Available", smoldot `bitswap_block` "Coming Soon"
  (`docs/book/src/concepts/retrieval.md:9-13`). [V]
- After pruning, "validator nodes may no longer serve the data"
  (`retrieval.md:142-148`). [V]

## 4. HOP: facts

[V] `polkadot-sdk/substrate/client/hop/src/types.rs:255-301` and README:
retention 24 h (`DEFAULT_RETENTION_SECS = 86_400`); pool 10 GiB; ≤ 256
recipients; per-user quota 256 MiB; submit rate 60/min (burst 120); bandwidth
128 MiB/min (burst 256). Two hours before expiry the node **promotes**
unacknowledged entries to transaction storage (`DEFAULT_PROMOTION_BUFFER_SECS
= 7200`) through `HopPromotion.promote`, a general transaction with "no
signature, no fees, lowest priority, and no debit of the submitter's Bulletin
allowance" (`pallets/hop-promotion/src/lib.rs:16-27, 338-373`). Max entry =
`max_promotion_size()` = `MaxTransactionSize` = 2 MiB (Paseo `lib.rs:969-972`).
Submitting requires an active Bulletin authorization
(`hop-promotion/src/lib.rs:183-185`).

## 5. What the phone apps do today

[V] unless marked; paths are in the two app repos.

- **Rail: HOP only.** Both apps implement `hop_submit`/`hop_claim`/`hop_ack`
  with 2,000,000-byte chunks and ticket-derived keys (Android
  `feature/chats/impl/.../data/hop/HopService.kt:64-121, 280-284`; iOS
  `Packages/HandoffService/Sources/FileLoader/HandoffFileLoadConfig.swift:15`).
  No `store` extrinsic for chat media. When a claim returns `NotFound` (1004)
  they fall back to `bitswap_v1_get` on a CIDv1 raw Blake2b-256, as RFC-0001
  "On-chain fallback" specifies, which works only if the node promoted the entry (Android `HopService.kt:123-166`; iOS
  `RemoteStore/BitswapRemoteStore.swift:36,56-61`).
- **They follow the merged chat-spec RFCs, not the old `base-spec.md` body**
  (`base-spec.md:1740-1791`, unchanged on main): they encrypt with
  **ChaCha20-Poly1305** (Android `data/hop/encryption/HopEncryption.kt:8`; iOS
  `FileLoader/FileEncryptor.swift:9-28`), as RFC-0004 §3 item 3 says, and they
  wrap the root entry in RFC-0001's versioned envelope
  `VersionedUploadedFile = v1(inline | chunked{totalSize, chunks})` with small
  files inline (Android `VersionedHopPoolEntry.kt:9-39`;
  `rfcs/0001-file-transfer-improvements.md` "Versioned upload model"). Both
  RFCs merged on 2026-07-31; the `base-spec.md` body still says AES-256-GCM
  and a bare `UploadedFile`. Correction 2026-09-24: this bullet said "RFC 0001
  is not in `chat-spec/rfcs/`" and "the apps are the de facto standard". That
  came from the stale copy. The divergence is between the old base-spec text
  and the RFCs, not between the apps and the spec
  (`docs/upstream/12-hop-cipher-envelope.md`).
- **Wire:** `RichText { text, attachments: [FileVariant] }`, `FileVariant =
  p2pMixnet { identifier, claimTicket, node, meta }`, `FileMeta = general |
  image{w,h,thumbnail?} | video{duration,thumbnail?}` (`base-spec.md:636-680`).
- **Types and sizes:** images and videos only, one per message. Android: max
  128 MB (`ChatFeedInteractor.kt:74,197-198`), JPEG q85 with EXIF rotation, no
  resize (`FileUploadPreProcessor.kt:15-51`). iOS: downsample to 4800 px, JPEG
  q0.7 (`PHImageAttachmentProvider.swift:16-62`); video re-exported at
  640×480 (`PHVideoAttachmentProvider.swift:68-123`). Thumbnails are
  **blurhash** 4×3 components from a ~128 px preview (Android
  `data/attachment/BlurHash.kt:6-12`; iOS `BlurHashConfiguration.swift:3-8`).
- **Authorization:** the upload key is `//allowance//bulletin//chat` derived
  from the wallet (Android `HopSigner.kt:43`; iOS `WalletDerivationPath.swift:15`).
  Before an upload the app submits `Resources.claim_long_term_storage` on the
  People chain from an anonymous alias and waits up to 30 s for the grant to
  reach Bulletin (Android `RealTransactionStorageSlotAllocator.kt:59-176`).
- **Endpoints:** from Firebase Remote Config (`chains_v2`); HOP URLs are the
  Bulletin chain's `externalApi.hop` list; receivers accept only allowlisted
  nodes (Android `HopFileDownloader.kt:30-32`). Concrete URLs: not in the repos.
- **Voice notes: none.** No audio `FileMeta`, no recorder. **Groups: none.**
- **Multi-device is broken by design [I from code]:** one ticket, one
  recipient key per file (iOS `UploadFileContext.swift:57`); the first device
  to claim acks and deletes the entry; the others get 1004 and depend on
  promotion. `polkadot-desktop` therefore never claims ("HOP claim is
  one-shot, so claiming here would deny the mobile recipient",
  `src/features/chat/ui/partials/AttachmentRenderer.tsx:14-25`) and shows
  "This message can only be viewed in the mobile app" (`en.json:275`). Its
  send path is commented out and its library speaks an older, incompatible
  `hop_submit` (`gateway.ts:17-86`).
- **Failure UI:** Android retries with backoff 10 s → 1 h for 24 h, then
  "Downloading failed · retry" (`strings.xml:1088`).

## 6. What t3ams and pca do

- **t3ams** [V]: two transports (`src/shared/media/blob-transport.ts:1-123`).
  In a host, the RFC-0010 preimage manager: the host signs the
  TransactionStorage call and owns the allowance; the product checks the key
  is Blake2b-256 of the blob. Standalone: HOP with AES-256-GCM and a per-file
  ticket (`hop-crypto.ts:61-141`). AES-256-GCM is t3ams's choice: it matches
  the old `base-spec.md` text, not RFC-0004. The reference rides inside the E2E
  message as `hop:` + base64url JSON with the ticket (`attachment-ref.ts:14-70`);
  in groups it rides in the epoch-key envelope. Max 25 MiB per file
  (`cloud-media.ts:20`). Gateways are configured but unused.
- **pca** [V]: receives phone-app attachments (`richText.attachments`, kind
  `p2pMixnetFile`), downloads them over HOP (pca's "legacy" dialect,
  which is the RFC-0004 cipher, ChaCha20-Poly1305, `bot-core/lib/hop-client.mjs:98-110`), 32 MiB cap, and
  stages them for the brain (`lib/agent-runtime.mjs:932-973`). It can send one
  (`index.mjs:1799-1845`, `sendAttachment` → `uploadP2PFile`) signed by
  `//allowance//bulletin//chat` from the bot seed. "Photo and document
  understanding" is the separate media analyzer (Anthropic Messages API,
  images as `image`, PDFs as `document`, an "untrusted data" system prompt;
  `transports/t3ams/t3ams-media-analyzer.mjs:1090-1269`); it is wired **only**
  for the T3ams transport, not the Polkadot-app path.
- **This desktop** [V]: decodes `richText` attachment metadata and shows the
  same "mobile app" placeholder (`src/renderer/ui/MessageBubble.tsx:266-275`);
  no upload or download code.

## 7. Comparison

| | Signal | WhatsApp | Telegram | Matrix | XMTP | Polkadot app (HOP) | proposed 0012 (Bulletin) |
|---|---|---|---|---|---|---|---|
| Blob store | Signal CDN | media servers (blob store) | Telegram cloud | homeserver media repo (`mxc://`) | any HTTPS host | one Bulletin node's pool | Bulletin chain (every full node) |
| E2E encrypted | yes | yes | no (cloud chats) | yes, in E2E rooms | yes | yes | yes |
| Cipher | AES-CBC + HMAC [S] | AES-256-CBC + HMAC-SHA256, random IV [V] | server-side | AES-CTR-256 + SHA-256 hash [V] | per-attachment secret, salt, nonce [V] | ChaCha20-Poly1305 (apps, chat-spec RFC-0004); old base-spec text says AES-GCM | AES-256-GCM per chunk |
| Key | random per attachment | random 32-byte AES + 32-byte HMAC per attachment [V] | n/a | JWK per file [V] | 32-byte secret per attachment [V] | ticket per file, keys derived | random 32-byte key + 12-byte nonce per attachment |
| In the message | pointer, key, digest [S] | key, HMAC key, SHA-256 of blob, pointer [V] | file id | `url`, `key`, `iv`, `hashes.sha256`, `thumbnail_file` [V] | `url`, `contentDigest`, `secret`, `salt`, `nonce`, `scheme`, `contentLength`, `filename` [V] | identifier, ticket, node, meta, blurhash | chunk hashes (= CIDs), key, nonce, store, meta, blurhash/thumbnail |
| Who can fetch ciphertext | holder of the id [S] | holder of the pointer [I] | server decides | homeserver users (auth media) [I] | anyone with the URL | listed recipient keys only | **anyone with the CID** (public chain data) |
| Lifetime | ~45 days on CDN [S] | while on server [S] | forever | server policy | host's policy | ack or 24 h (then promotion to chain) | 14 days, renewable |
| Max size | 100 MB, raised to 200 MB 2026-07 [S] | 2 GB (2022) [V] | 2 GB, 4 GB Premium [V] | `m.upload.size` per server [V] | host's limit; inline 1 MB message cap [V] | 128 MB (Android) | 25 MiB (this RFC) |
| Groups | one blob, key per recipient message | one blob, key in the Sender-Key message [I] | one file | one blob, key in the Megolm event | one blob | per-recipient ticket (≤ 256) | one blob; key in the group message |
| Multi-device | yes | yes (companion devices fetch) [V] | yes | yes | yes | first claim wins (broken) | yes, any device fetches by CID |
| Who pays | Signal | Meta | Telegram | homeserver | uploader's host | uploader's Bulletin authorization | uploader's Bulletin authorization |

Sources fetched 2026-09-24: WhatsApp Encryption Overview, 2026-02-25,
"Transmitting Media and Other Attachments"
(https://www.whatsapp.com/security/WhatsApp-Security-Whitepaper.pdf) [V];
WhatsApp 2 GB (https://blog.whatsapp.com/reactions-2gb-file-sharing-512-groups,
2022-07-11) [V via search result on the official domain]; Telegram 2 GB / 4 GB
(https://telegram.org/blog/700-million-and-premium) [V], upload parts ≤ 512 KB
(https://core.telegram.org/api/files) [V]; Matrix `EncryptedFile`
(https://spec.matrix.org/v1.11/client-server-api/) [V]; XMTP XIP-17
(https://github.com/xmtp/XIPs/blob/main/XIPs/xip-17-remote-attachment-content-type-proposal.md)
[V; the XIP does not name the cipher]. Signal: support.signal.org returned 403;
the 100 MB → 200 MB figure is from https://aboutsignal.com (not official) [S];
the Signal cipher and CDN lifetime are [S].

## 8. What our rails allow (the design constraints)

1. **One submission per message.** An upload is `⌈size / 2,000,000⌉` feeless
   Bulletin transactions plus the one statement the message costs anyway.
   Zero extra statements. (HOP costs zero chain transactions in the happy
   path, but it is per node and one-shot.)
2. **Message size.** A DM request batch and a group carrier are ≤ 4096 bytes
   of plaintext (`base-spec.md:307`; 0011 Limits). An 8 KB inline thumbnail
   cannot fit. Blurhash (≈ 30 bytes) plus an optional ≤ 2 KB thumbnail can.
3. **Blob size.** 2 MiB per transaction; larger files are chunks. The chunk
   list rides in the message (32 bytes per chunk), so no manifest transaction.
4. **Budget.** A person's claim is 100 transactions / 8 MiB for 14 days;
   the chain does not reject over-budget stores. The client must meter.
5. **Ciphertext is public for 14 days** and can be archived by anyone. Only
   the key in the E2E message protects it. That is weaker than HOP's
   recipient-only claim and than Signal's unguessable CDN id.
6. **Non-persons** (this desktop's own identity, bots) cannot claim storage.
   On devnet a dev authorizer works; elsewhere a person must grant it or an
   operator must be an `AllowedAuthorizer`.
7. **Read at the best block.** Wait for `Stored` in a best block before
   sending the message; show finality, never block on it (project rule).
