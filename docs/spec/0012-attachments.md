# RFC: Attachments on the Bulletin chain

|                 |                                                                                  |
| --------------- | -------------------------------------------------------------------------------- |
| **Start Date**  | 2026-09-24                                                                        |
| **Description** | Images, files and voice notes, end-to-end encrypted, stored as feeless Bulletin transactions, referenced by an `attachment` content kind that costs no extra statement |
| **Authors**     | Shawn Tabrizi (with the desktop client team)                                      |
| **Status**      | Draft in `polkadot-chat-desktop/docs/spec`; plan in `docs/milestones/M15.md`; vectors in `vectors-0012.md` |
| **Provisional kinds** | `attachment` = 250 |
| **Research**    | `docs/reference/bulletin-and-media.md` (Bulletin facts with sources; phone apps, t3ams, pca; Signal, WhatsApp, Telegram, Matrix, XMTP) |

## Summary

The sender encrypts a file on the device with a random per-attachment key,
cuts the ciphertext into chunks of at most 2,000,016 bytes, and stores each
chunk with `TransactionStorage.store` on the Bulletin chain. Each chunk's
Blake2b-256 hash is both its integrity check and its IPFS CID digest. When the
chunks are in a best block, the sender sends one `attachment` message (kind
250) that carries the key, the nonce, the chunk hashes, the media metadata, a
blurhash or a small thumbnail, and a caption. The message rides in the
ordinary DM batch or group carrier: **zero extra statements**. Any recipient
device fetches the chunks by CID (Bulletin RPC `bitswap_v1_get`, or an HTTPS
IPFS gateway), checks each hash, and decrypts. Data lives 14 days on chain;
the sender's client can re-store the identical ciphertext on request, which
makes the original message valid again.

## Motivation

The desktop shows "This message can only be viewed in the mobile app" for
every attachment and cannot send one. Bots cannot receive a photo on the
Polkadot-app transport and describe it. The base spec's HOP rail
(`base-spec.md` "Message Attachments") has three limits we cannot build on:

1. **One-shot.** A recipient key acks and the pool deletes the entry; a
   second device gets `NotFound`. `polkadot-desktop` refuses to claim for this
   reason (`AttachmentRenderer.tsx:14-25`).
2. **Per node, per recipient.** The blob sits on one node; recipients are
   fixed at submit (≤ 256). A group of 1024 (0011) or a late joiner cannot use
   it.
3. **24 hours.** A reader who is away for a weekend loses the file, unless
   the node promoted it.

Transaction storage has none of these limits and is feeless under a Bulletin
authorization, which a person already claims for HOP. The owner's efficiency
rule (`efficiency.md`) holds: a chain transaction is not a statement.

## Stakeholders

Desktop client (this repo), `pca` (`polkadot-chat-agents`, branch
`desktop/rfc-0003`), the phone app team (they send HOP `richText` today; they
must not break), chat-spec maintainers (upstream target), Bulletin chain and
People chain owners (authorization for non-persons, quota sizing).

## Explanation

### Notation

As 0011: `encode` is SCALE, `:` is concatenation, AEAD is AES-256-GCM with a
12-byte nonce and the 16-byte tag appended. `blake2b_256` is unkeyed
BLAKE2b with a 32-byte output (the Bulletin content hash). `u32_be(i)` is 4
bytes big-endian; other integers are little-endian as SCALE.

### Content (kind 250)

```
MessageContent = {
    ...
    attachment(AttachmentContent) -> 250
}
AttachmentContent = {
    items: Vec<Attachment>        // 1..=4
    caption: Option<String>       // markdown, <= 1024 bytes
}
Attachment = {
    mime: String                  // <= 64 bytes, e.g. "image/jpeg"
    name: Option<String>          // <= 128 bytes; None for photos and voice notes
    size: u64                     // plaintext bytes, >= 1
    media: Media
    blurhash: Option<String>      // <= 64 bytes; images and videos
    thumbnail: Option<Vec<u8>>    // <= 2048 bytes, image/webp or image/jpeg, plaintext
    key: [u8; 32]                 // random per attachment
    nonce: [u8; 12]               // random per attachment
    chunkSize: u32                // plaintext bytes per chunk; senders use 2_000_000
    chunks: Vec<[u8; 32]>         // blake2b_256 of each encrypted chunk, in order; 1..=14
    store: Store
    expiresAt: u64                // ms since epoch; sender's estimate of the first chunk's expiry
}
Media = enum {
    file = 0
    image { width: u32, height: u32 } = 1
    video { width: u32, height: u32, durationMs: u32 } = 2
    voice { durationMs: u32, waveform: Vec<u8> /* <= 64 samples, 0..=255 */ } = 3
}
Store = enum {
    bulletin { genesis: [u8; 32], mirror: Option<String> } = 0
}
```

- **Content hash and locator are one field.** `chunks[i]` is the Bulletin
  `content_hash` of chunk i, and its CID is
  `CIDv1(raw 0x55, multihash(0xb220, chunks[i]))` (base32 `bafk2bzace…`). The
  message needs no transaction reference: `renew` accepts
  `TransactionRef::ContentHash` (`primitives/src/lib.rs:113-116`).
- `store.genesis` names the Bulletin chain (devnet para 1010:
  `0xe101f0fa…0a59`), so a client on a different network refuses rather than
  fetches the wrong chain.
- `store.mirror` is an optional HTTPS prefix; the chunk URL is
  `mirror ‖ cid` (for a gateway, `https://…/ipfs/`). It holds the same
  ciphertext; the hash check makes the mirror untrusted.
- The thumbnail and blurhash are inside the E2E message, so they need no
  separate encryption.
- A later `Store` variant (`hop = 1`) could carry a HOP ticket for phone
  interop; not defined here.

### Encryption

For an attachment of `size` bytes, `n = ⌈size / chunkSize⌉` chunks:

```
nonce_i  = nonce[0..8] : (nonce[8..12] XOR u32_be(i))
aad_i    = b"pcd-att-v1" : u32(i) : u32(n) : u64(size)
c_i      = AEAD(key, nonce_i, plaintext[i*chunkSize .. (i+1)*chunkSize], aad_i)
chunks[i]= blake2b_256(c_i)
```

The AAD binds each chunk to its position, the chunk count and the size, so a
reordered, dropped or truncated chunk fails to decrypt. Encryption is
deterministic for a given key, nonce and file, so a re-store produces the
same chunks and the same CIDs. `chunkSize` = 2,000,000 gives a ciphertext
chunk of 2,000,016 bytes, under the 2,097,152-byte `MaxTransactionSize`.

AES-256-GCM, not ChaCha20-Poly1305: it matches the base spec text, 0011, and
t3ams, and is native in WebCrypto (desktop) and Node (pca). The phone apps use
ChaCha20-Poly1305 for HOP; that rail is untouched.

### Upload flow (sender)

1. **Prepare.** Enforce the limits below. Images: apply the EXIF rotation,
   strip all EXIF (GPS), downscale to at most 2560 px on the long side,
   re-encode JPEG quality 0.8 (keep PNG for screenshots under 1 MiB, keep GIF
   as is). Compute `width`, `height`, a 4×3 blurhash (as the phone apps) and,
   when it fits the message budget, a WebP thumbnail ≤ 2048 bytes (~96 px).
   Voice: see below. Other files: sent as they are, `media = file`.
2. **Budget check.** Read the account's authorization with the runtime API
   `BulletinTransactionStorageApi.account_authorization`
   (`runtime-api/src/lib.rs:38-56`). Refuse when `n` transactions or the
   ciphertext bytes exceed what remains ("Not enough Bulletin storage left:
   N MB. It refills on <date>."). The chain would accept the store with low
   priority; we do not use that.
3. **Encrypt** as above. Keep the plaintext in the local store; it is the
   source for re-upload.
4. **Store.** Submit `TransactionStorage.store(c_i)` for each chunk, signed by
   the client's Bulletin account, nonces in sequence, all in flight at once.
   Watch for `Stored { content_hash = chunks[i] }` **in a best block**; do not
   wait for finality (project rule: read at the best block, show finality).
5. **Send** the kind-250 message on the normal path (DM batch or group
   carrier). The bubble shows the local file at once with a "sending" tick.
6. **Retry.** A chunk not in a best block within 60 s is resubmitted, up to 3
   times with backoff (10 s, 30 s, 90 s). Before a resubmit, read
   `TransactionStorage.TransactionByContentHash(chunks[i])`; if present, the
   chunk is stored. After 3 failures the bubble shows "Upload failed · retry";
   no message is sent. A best block that is later retracted is seen as a
   missing chunk by the check in step 7 and re-stored.
7. **Confirm.** After finality (in the background), check every chunk once
   more; re-store any that fell out. The message is not resent (same CIDs).

Which account signs: the client's Bulletin account. The phone apps derive it
as `//allowance//bulletin//chat` from the wallet; pca derives the same path
from the bot seed. The desktop derives the same path from its identity seed.

### Download flow (recipient, any device)

1. On receipt, show the bubble at once: blurhash or thumbnail, dimensions,
   duration, size, caption.
2. **Auto-download** images and voice notes ≤ 5 MiB; others on tap.
3. For each chunk, fetch `c_i` by CID: first `bitswap_v1_get(cid)` on the
   client's Bulletin RPC node, then `store.mirror`, then the network's known
   gateway (`docs/reference/bulletin-and-media.md` §3). Timeout 30 s per
   source.
4. Check `blake2b_256(c_i) == chunks[i]`; else discard and try the next
   source. Decrypt with `nonce_i` and `aad_i`; a tag failure is a hard error
   ("Attachment is damaged").
5. Concatenate; check the length equals `size`. Store the plaintext in the
   local database; later views read it locally.
6. **Expired.** If every source fails and `now > expiresAt`, show
   "Attachment expired" with "Ask to resend". Before `expiresAt`, show
   "Download failed · retry" and retry with backoff (10 s → 10 min) for 24 h.

### Expiry, renewal and re-upload

- Bulletin keeps a chunk 14 days (201,600 blocks). `expiresAt` = upload time
  + 14 days − 1 hour.
- **Re-upload on request.** "Ask to resend" sends a text message
  (`richText`, "Please resend <file name>"), which is a user action and costs
  the one statement any message costs. A recipient client that knows 0012
  may add a `replyTo` on it. The sender's client, if it still holds the
  plaintext, re-encrypts with the same key and nonce and re-stores the
  chunks: the CIDs are the same, so the original message works again; the
  asking client retries for 24 h. No new message kind.
- **Keep longer.** `DataRenewal.renew(ContentHash(chunks[i]))` restarts the
  14 days, but draws on the hard "permanent" allowance
  (`PermanentAllowanceExceeded`). Not automatic in v1; an unresolved
  question for pinned files.

### Limits

| Item | Limit | Why |
|---|---|---|
| Size per attachment | 25 MiB (14 chunks) | t3ams uses 25 MiB; a person's claim is 8 MiB, so larger files eat several claims |
| Items per message | 4 | album |
| Size per message | 25 MiB total | one budget check |
| Encoded `AttachmentContent` | ≤ 3,584 bytes | must fit the 4,096-byte DM batch and group carrier with room for the envelope; the sender drops thumbnails (keeps blurhashes) until it fits |
| Chunk | 2,000,000 plaintext bytes | 2 MiB `MaxTransactionSize` |
| Voice note | 5 minutes | one chunk at 24 kbps |
| Per person per day | the client refuses beyond the authorization; no protocol day cap | the chain's cap on store is soft; the client meters |
| Caption | 1,024 bytes | 4 KB budget |

A typical photo message (one item, name, a 2,048-byte thumbnail, a 100-byte
caption) encodes to 2,334 bytes; without the thumbnail, ≈ 280 bytes
(`vectors-0012.md`).

### Cost (efficiency rule)

| Operation | Statements | Bulletin transactions | Fees | Authorization used |
|---|---|---|---|---|
| Send a photo (≈ 400 KB after re-encode) | 1 (the message; 0 extra) | 1 | 0 | 1 tx, ≈ 400 KB |
| Send a 60 s voice note (24 kbps ≈ 180 KB) | 1 | 1 | 0 | 1 tx, 180 KB |
| Send a 25 MiB file | 1 | 14 | 0 | 14 tx, 25 MiB |
| Album of 4 photos | 1 | 4 | 0 | 4 tx |
| Group of n members, any size | 1 | same as above | 0 | same; independent of n |
| Download | 0 | 0 | 0 | none (RPC or HTTPS reads) |
| Re-upload on request | 1 (the request message) + 0 | ⌈size/2 MB⌉ | 0 | again |
| Retry of a dropped chunk | 0 | 1 | 0 | 1 tx |

Chain load: every byte is in a block body on every full node for 14 days.
A person's claim (100 tx / 8 MiB per 14 days, **unverified** how many claims
a person gets) is about 20 photos of 400 KB. The HOP rail used by the phone
apps costs 0 chain transactions when every recipient acks within 24 h; this
RFC trades that for multi-device, groups and 14-day availability.

### Groups

The same blob serves every member. The `attachment` content rides inside the
sender's 0011 `GroupMessages` carrier like any content, encrypted with
`MsgKey_e`; the per-attachment key is inside it. Cost is independent of group
size. A member removed later keeps the keys of attachments it already
received (as with any message it already read); it cannot read later ones.
Because the carrier repeats the sender's messages of the last 24 h within
4,096 bytes, an attachment message (≈ 280–2,300 bytes) leaves room for few
others; the carrier drops older items first (0011 rule).

### Multi-device

Every device of the recipient gets the message (mds sync or the group topic)
and fetches by CID. Nothing is consumed, so there is no "first device wins".
The sender's other devices fetch too. A device that joins later gets the
message from its sibling over the mds sync channel and fetches the chunks
while they live.

### Bots

pca sends and receives kind 250 over the Polkadot-app transport.
- **Receive.** Decode, fetch, verify, decrypt into the per-turn staging
  directory the brain already uses for HOP attachments
  (`lib/agent-runtime.mjs:932-973`), with the same caps (32 MiB).
- **Media understanding hook.** `onAttachment(meta, path)`: pca runs the
  existing media analyzer (today wired only for T3ams) on images and PDFs and
  passes its result into the prompt as untrusted data, as
  `renderUntrustedAttachmentAnalysis` does. The brain may also read the file.
- **Send.** A bot reply can carry an `attachment` (a generated chart, a file).
  pca signs Bulletin stores with its `//allowance//bulletin//chat` key.
- A bot's `botInfo` (0008) may later advertise accepted MIME types; not in v1.

### Voice notes

- `mime = "audio/ogg; codecs=opus"`, mono, 48 kHz, 24 kbps, `media = voice`
  with `durationMs` and a 64-sample waveform (peak per slice, 0–255) for the
  bubble. `name = None`, no blurhash, no thumbnail.
- Chromium's `MediaRecorder` records `audio/webm;codecs=opus` [I; not
  checked in Electron 44]; the desktop remuxes to Ogg (the Opus packets are
  unchanged) or the spec accepts `audio/webm; codecs=opus` too. See
  Unresolved.
- Played inline with a scrubber; auto-downloaded (≤ 5 MiB).

### Fallback

- A client that does not know kind 250 shows the base spec's unsupported
  bubble (phone apps: "Unsupported message content. Please update the app.").
  Development-mode rule (README): accepted. The base protocol has no generic
  fallback text, so an old client cannot show "sent an attachment" without a
  second message; we do not send one.
- A client that knows 0012 but not a media type or MIME type shows a file row
  "<name or 'Attachment'> · <size>" with Download.
- Chat-list previews: "Photo", "Video", "Voice message (0:42)", "File:
  <name>", or the caption; "You: " prefix as today; "sent an attachment" when
  nothing better is known.
- Desktop and pca also decode incoming base-spec `richText` HOP attachments
  as today; downloading those is a separate milestone (see M15 "later").

## Privacy

What each party sees:

| Party | Sees | Does not see |
|---|---|---|
| Bulletin chain, collators, every full node | the uploading account, each chunk's size and time, the CIDs; the ciphertext, for 14 days, by anyone | the key, the content, the recipients, the message |
| Statement Store | one ordinary message statement (size grows by ≈ 0.2–2.3 KB) | that it carries an attachment |
| RPC node or gateway a recipient reads from | the reader's IP address and the CIDs it asks for, and when | the content |
| People chain | an anonymous alias claimed storage for some account (ring-VRF) | which person |

Limits, stated plainly:

- **The ciphertext is public.** Anyone can fetch it for 14 days and archive
  it forever. Confidentiality rests on the key inside the E2E message. A later
  leak of a chat key (DMs use a static pairwise secret, base spec Appendix A)
  exposes archived attachments too. HOP limits fetches to recipient keys;
  Signal and WhatsApp hide blobs behind server access control. This is the
  main cost of the design.
- **Linkability.** One Bulletin account signs all of a client's uploads, so
  the chain links them to each other. It does not link them to the People
  identity (the grant came from an anonymous alias). A store followed seconds
  later by a statement of about the same time can link the Bulletin account to
  the statement account for an observer that sees both [I]. Mitigation (v1):
  none beyond using the same RPC node for both. Later: a per-period Bulletin
  account.
- **Readers reveal interest.** A recipient that fetches a CID from a gateway
  tells the gateway it received that file; the uploader and the reader are
  then linked by CID at the gateway. Prefer `bitswap_v1_get` on the client's
  own RPC node (same exposure as its statement subscriptions).
- **Sizes.** Exact ciphertext sizes are visible. v1 does not pad (padding
  costs authorization bytes). Unresolved.
- **Metadata stripped.** The client removes EXIF (GPS, device) before
  encryption. File names are inside the E2E message only.

## Security

- Integrity: the chunk hash is checked before decryption; the AEAD tag and
  the AAD check content, order, count and size.
- Key freshness: key and nonce are random per attachment; chunk nonces are
  distinct within an attachment; the same key is never used for two
  different files. A re-store reuses key and nonce with the same plaintext,
  which yields identical ciphertext and reveals nothing new.
- Untrusted sources: RPC nodes, mirrors and gateways are untrusted; a wrong
  byte fails the hash.
- Decompression and parsing: images and PDFs are decoded in the renderer
  sandbox (desktop) and in a bounded worker (pca); size caps apply before
  decode.
- A malicious sender can make a recipient fetch up to 25 MiB per item; the
  auto-download cap (5 MiB) bounds unsolicited traffic.

## Drawbacks

Public ciphertext for 14 days. A chain transaction per 2 MB where HOP needs
none. Non-persons need someone to authorize them. Not visible to today's phone
apps (unsupported bubble). The 4 KB message budget allows only a small
thumbnail.

## Testing

- Codec: both vectors in `vectors-0012.md` decode and re-encode byte for
  byte in the desktop and pca codecs; the crypto vectors reproduce.
- Unit: chunking at 0, 1, exact and over `chunkSize`; a swapped chunk, a
  dropped last chunk and a changed `size` fail; a wrong-hash source is
  skipped; `expiresAt` in the past shows "expired"; the 3,584-byte budget drops
  thumbnails.
- Live (devnet, M15): two identities exchange an encrypted image through
  Bulletin; a second device of the recipient fetches it too; a bot describes a
  received image; Diagnostics shows one statement for the message.

## Compatibility

- New kind, sent freely (development mode). Phone apps show unsupported.
- The base spec's `richText` HOP attachments are unchanged; our clients keep
  decoding them.
- Upstream path: either this kind, or `FileVariant.bulletin = 1` inside
  `richText` with the same `Attachment` fields. Both break decoding on today's
  strict phone decoders equally; the `FileVariant` form keeps one media model.
  Decision for the upstream submission, not now.

## Unresolved Questions

1. **Authorization for non-persons (biggest).** The desktop identity and bots
   are not persons and cannot `claim_long_term_storage`. On devnet a dev key
   (`//Eve`) can `authorize_account` (pca and bulletin-deploy do it;
   **unverified** on devnet today). On Paseo Next and Polkadot: a person
   grants a claim's `target` to the bot or desktop account (the call takes any
   target), or the operator becomes an `AllowedAuthorizer`. Owner decision
   needed, with the People-chain team.
2. **Quota sizing.** 8 MiB / 100 tx per claim; how many claims per person per
   period (`ClaimsPerPeriod = 100`, period unit **unverified**)? At 8 MiB this
   is ~20 photos per claim.
3. **Rail choice for 1:1 with phone users.** Keep HOP for phone interop (and
   fix its multi-device problem upstream) or ask the phone team to adopt 0012?
   A `Store.hop` variant would let one content model carry both.
4. **Public ciphertext.** Accept (as this RFC does), or add a recipient-gated
   rail later?
5. **Voice container.** Ogg (as asked) needs a remux on Chromium; accept
   WebM/Opus as well?
6. **Padding.** Pad chunks to size buckets to hide exact sizes, at an
   authorization cost?
7. **Renewal of pinned files** (`renew` draws on the hard permanent
   allowance).
8. **Base spec vs phone apps.** The base spec says AES-256-GCM for HOP; the
   apps ship ChaCha20-Poly1305 and an unpublished "RFC 0001" envelope. Flag to
   chat-spec.
9. **Gateway deprecation.** Bulletin docs mark HTTP gateways deprecated; the
   fallback order may need a Helia or smoldot path later.

### Source order (measured on devnet 2026-09-24)

`bitswap_v1_get` returns a 200 KB chunk in 2–4 s but a 2 MB chunk in 30–33 s; the gateway returns 2 MB in 6–8 s. Clients SHOULD try bitswap first for chunks up to 512 KB and the gateway first above that, falling back to the other; the privacy note stands (a gateway learns which CIDs a client asks for).
