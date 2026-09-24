# RFC: Bulletin file as a RichText FileVariant

|                 |                                                                                  |
| --------------- | -------------------------------------------------------------------------------- |
| **Start Date**  | 2026-09-24                                                                        |
| **Description** | The 0012 Bulletin attachment moves into the base spec's `RichText` as `FileVariant` index 1, so one media model carries both HOP and Bulletin files; kind 250 is retired after one release |
| **Authors**     | Shawn Tabrizi (with the desktop client team)                                      |
| **Status**      | Draft in `polkadot-chat-desktop/docs/spec`; plan in `docs/milestones/M20.md`; vectors in `vectors-0014.md` |
| **Kinds**       | none new: `richText` = 15 (base spec); retires `attachment` = 250 (0012)          |
| **Decision**    | `docs/questions.md` "Attachments phone interop: DECIDED 2026-09-24 (owner, final plan)", step 4 |

## Summary

```
FileVariant = enum {
    p2pMixnet(P2PMixnetFile) = 0     // base spec, HOP
    bulletin(BulletinFile)   = 1     // this RFC
}
```

`BulletinFile` carries what a 0012 `Attachment` carries: the base spec's
`FileMeta` (MIME type, size, width and height or duration, blurhash in
`thumbnail`), a file name, an optional small preview, voice data, the key,
the nonce, the chunk size, the chunk hashes, the store locator and the
expiry. The caption is `RichText.text`; the album is `RichText.attachments`.
Encryption, upload, download and expiry are 0012's, unchanged: the same file
gives the same chunks and CIDs in both forms.

A sender sends the new variant only to a peer whose every device lists
`fileVariants ∋ 1` in its `capabilities` (0013). Clients read kind 250 and the
new variant from M20 on; kind 250 is no longer sent after one release.

## Motivation

- **One media model.** Upstream chat-spec already has `RichText` with a
  `FileVariant` enum whose comment says it describes "how the file is
  transferred". A second transfer rail is a second variant, not a second
  message kind. Replies and edits (`ReplyContent.ownContent`,
  `EditContent.newContent`) are `RichText`, so a reply can carry a Bulletin
  file with no new kind.
- **The owner's plan**, step 4: move our Bulletin file into the enum and
  propose the variant upstream with 0013.
- 0012 "Compatibility" already named this form: "`FileVariant.bulletin = 1`
  inside `richText` with the same `Attachment` fields ... keeps one media
  model."

## Explanation

### Layout

```
RichTextContent {                       // base spec, unchanged
    text: Option<String>                // markdown; the caption, <= 1024 bytes for a Bulletin file
    attachments: Option<Vec<FileVariant>>
}
FileVariant = enum {
    p2pMixnet(P2PMixnetFile) = 0        // base spec, unchanged
    bulletin(BulletinFile)   = 1
}
BulletinFile = {
    meta: FileMeta                      // base spec enum, unchanged (see mapping)
    name: Option<String>                // <= 128 bytes; None for photos and voice notes
    preview: Option<Vec<u8>>            // <= 2048 bytes, image/webp or image/jpeg, plaintext (0012 `thumbnail`)
    voice: Option<VoiceMeta>            // Some for voice notes only
    key: [u8; 32]
    nonce: [u8; 12]
    chunkSize: u32                      // senders use 2_000_000
    chunks: Vec<[u8; 32]>               // blake2b_256 of each encrypted chunk; 1..=14
    store: Store                        // 0012, unchanged: bulletin { genesis, mirror } = 0
    expiresAt: u64                      // ms since epoch
}
VoiceMeta = { durationMs: u32, waveform: Vec<u8> /* <= 64 samples */ }
FileMeta = enum {                       // base spec, unchanged
    general(GeneralFileMeta { mimeType: String, fileSize: u32 }) = 0
    image(ImageFileMeta { general, width: u32, height: u32, thumbnail: Option<Vec<u8>> }) = 1
    video(VideoFileMeta { general, duration: u32 /* seconds */, thumbnail: Option<Vec<u8>> }) = 2
}
```

Limits are 0012's: 1..=4 items with `bulletin` in one `RichText`, 25 MiB
each and in total, encoded `RichTextContent` ≤ 3,584 bytes (the sender drops
`preview` first, then `thumbnail`).

### Mapping from the 0012 `Attachment`

| 0012 `Attachment` | `BulletinFile` | Note |
|---|---|---|
| `mime` | `meta.general.mimeType` | |
| `size: u64` | `meta.general.fileSize: u32` | ≤ 25 MiB fits; the AAD still uses `u64(size)` |
| `media = file` | `meta = general` | |
| `media = image { w, h }` | `meta = image { general, w, h, thumbnail }` | |
| `media = video { w, h, durationMs }` | `meta = video { general, ⌈durationMs / 1000⌉, thumbnail }` | the base `VideoFileMeta` has no width or height (Unresolved 2) |
| `media = voice { durationMs, waveform }` | `meta = general`, `voice = Some(...)` | the base enum has no audio variant; we do not add one (Unresolved 3) |
| `blurhash` | `meta.thumbnail` as UTF-8 bytes (image, video) | the phone apps put the blurhash there (iOS `ChatRichRemoteContent.swift`: "UTF-8 encoded BlurHash used as the image's pre-download preview") |
| `thumbnail` | `preview` | a real small image, not a blurhash |
| `name` | `name` | |
| `key`, `nonce`, `chunkSize`, `chunks`, `store`, `expiresAt` | same | |
| `AttachmentContent.caption` | `RichText.text` | |
| `AttachmentContent.items` | `RichText.attachments` | |

The chunk crypto is 0012's: `nonce_i`, `aad_i = b"pcd-att-v1" : u32(i) :
u32(n) : u64(size)`, AES-256-GCM, `chunks[i] = blake2b_256(c_i)`. The label
stays `pcd-att-v1`; nothing about the ciphertext changes.

### Sending (0013 decides)

For each attachment message to peer P (DM) or a group:

1. DM, `effective(P).fileVariants ∋ 1` → `RichText` + `bulletin`.
2. DM, else `effective(P).kinds ∋ 250` → kind 250 (transition only).
3. DM, else → `RichText` + `p2pMixnet` (HOP) in a dialect of
   `effective(P).hopDialects`.
4. Groups v2 (0011): `bulletin` when every member device known to the sender
   lists it, else kind 250. HOP is never used in a group (≤ 256 recipients
   per entry, one-shot).

A `RichText` never mixes `p2pMixnet` and `bulletin` items: the whole message
must decode on every receiving device.

### Receiving

- Decode both variants of `FileVariant` and kind 250.
- A `bulletin` item is fetched, checked and decrypted exactly as a 0012 item
  (the download flow, auto-download caps and expiry UI are unchanged).
- The bubble is one component for all three sources (HOP, variant 1, kind
  250); the local row stores the 0012 shape so older rows need no migration.

### Transition

| Release | Sends | Reads |
|---|---|---|
| now (before M20) | kind 250 to everyone | kind 250, HOP (M20 step 1 in progress) |
| M20 (desktop N, pca same week) | variant 1 to peers that list it; kind 250 to peers that list 250 only; HOP to the rest | kind 250, variant 0, variant 1 |
| N + 1 | kind 250 no longer sent | kind 250 still read (old history, old peers) |
| later | | kind 250 read-only forever for stored rows; a live kind-250 message from a peer still decodes |

"One release" means one desktop release and the matching pca deploy. A
client that skipped a release still reads kind 250. Nothing re-encodes
stored rows.

### What a baseline client sees

**Checked in code, not on a live phone.** An unknown `FileVariant` index
makes the whole `RichText` message undecodable, so the whole message
(caption text included) becomes the base spec's unsupported message. It does
not drop just the unknown item.

- Base spec: requests hold opaque messages "to allow independent decoding
  and unsupported messages"; a message that fails to decode is marked
  unsupported (`base-spec.md` "Sending Requests and Responding"). The spec
  does not say what an unknown enum index inside a known kind does; a SCALE
  enum with an unknown index cannot be decoded, and the next bytes cannot be
  skipped because their length is not known.
- **Android** (`polkadot-app-android-v2` `ba3e15749`): `FileVariant` is a
  sealed interface with only `@EnumIndex(0) P2PMixnet`
  (`feature/chats/transport-protocol/.../scale/ChatMessageStatementContent.kt:176-180`).
  `toChatMessageOrUnsupported` decodes the message in `runCatching` and on
  failure keeps only the id and timestamp as `Content.Unsupported(raw)`
  (`feature/chats/impl/.../data/model/ChatMessageStatementContentMappers.kt:78-101`).
  The bubble reads "Unsupported message content. Please update the app."
  (`common/src/main/res/values/strings.xml:905`); a push shows the same text.
  The raw bytes are kept and re-parsed when a chat session starts
  (`RealContactChatSession.kt:80, 192-208`), so after an app update that knows
  variant 1 the old message shows correctly.
- **iOS** (`polkadot-app-ios-v2` `88f790aa0`): `FileVariant.init` throws
  `unexpectedDecodedValue` for any index but 0
  (`polkadot-app/Modules/Chat/Model/ChatRichRemoteContent.swift:88-104`);
  `Chat.OpaqueMessage` catches it and stores `versioned: .unsupported(data)`
  (`RemoteChatMessage.swift:245-260`). Whether iOS re-parses later:
  **unverified**.
- **This desktop** (scale-ts): a baseline `Enum({ p2pMixnet })` throws on
  index 1 (tried 2026-09-24 with vector A below). M20 adds the variant before
  any client sends it.
- pca, `polkadot-desktop`, `polkadot-chat-web`: **not checked**; all three
  use SCALE enums for `FileVariant` and are expected to fail the same way.

So for a baseline client the new variant is exactly as visible as kind 250:
one unsupported bubble. That is why the sender uses it only when 0013 says
every device of the peer lists it.

## Test vectors

`vectors-0014.md`: vector A (image with caption) and vector B (voice note)
of 0012 re-encoded as `RichText` + `bulletin`, 194 and 276 bytes, computed
by two encoders. They use 0012's crypto vectors C1 and C2 unchanged.

## Privacy and Security

As 0012: the ciphertext is public on Bulletin for 14 days and the key is
only in the E2E message. Moving the fields into `RichText` changes no party's
view. One new point: the blurhash now sits in `FileMeta.thumbnail`, which is
where HOP files carry it, so a client's render path is the same for both.

## Drawbacks

- Two encodings of one attachment exist during the transition (kind 250 and
  variant 1).
- The base `FileMeta` loses 0012's video width and height and gives duration
  in seconds; voice needs our own `voice` field.
- `fileSize: u32` caps a Bulletin file at 4 GiB (no real limit at 25 MiB).

## Testing

- Codec: vectors A and B in `vectors-0014.md` encode and decode byte for byte
  in the desktop and pca codecs; a kind-250 vector and its variant-1 twin map
  to the same local row; a `RichText` with index 2 is unsupported.
- e2e (M20): capable peer → variant 1 on the wire, the image opens; baseline
  peer → HOP; a mixed `RichText` is never sent.

## Compatibility

- Breaks nothing on a peer whose devices all list variant 1.
- On a baseline client, the whole message is unsupported (above). 0013 keeps
  it from being sent there.
- Upstream: proposed with 0013 (plan step 4). If chat-spec takes index 1 for
  something else, our variant moves and the transition repeats.

## Unresolved Questions

1. **Index 1.** Ask chat-spec to reserve it before we ship, or ship and
   propose? The base enum has no other variants in use (checked in the base
   spec v0.16 and both phone apps).
2. **Video width and height.** Upstream `VideoFileMeta` has none. Propose
   adding them (a base change), or leave them out (the bubble uses the
   preview's aspect)?
3. **An audio `FileMeta` variant** upstream (index 3) instead of our
   `voice` field? It would also let HOP voice notes exist.
4. **Retiring kind 250 upstream.** It was never proposed upstream; only our
   clients and pca know it. Drop it from `kinds.md` after N + 1, or keep the
   row as "read only"?
5. **A HOP ticket inside `Store`** (0012 Unresolved 3) is no longer needed:
   variant 0 is HOP.
