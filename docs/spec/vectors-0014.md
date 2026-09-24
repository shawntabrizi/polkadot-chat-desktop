# Test vectors: spec 0014 (Bulletin `FileVariant` in `richText`)

Status: **draft.** Computed on 2026-09-24 by two encoders: a Python SCALE
encoder (it reproduces 0012 vector A byte for byte) and `scale-ts` 1.6.1 as the
desktop uses it. Both give the same bytes. Not yet reproduced by the pca
codec. A disagreement is a bug in this file until proven otherwise.

Conventions are those of `vectors-0012.md`. `richText` = kind 15 = `0x0f`.
The chunk crypto is 0012's; these vectors reuse C1 and C2 from
`vectors-0012.md` unchanged (same key `0x11 × 32`, nonce `0x22 × 12`, devnet
Bulletin genesis `0xe101f0fa…0a59`).

## Layout

```
RichTextContent = { text: Option<String>, attachments: Option<Vec<FileVariant>> }
FileVariant = enum { p2pMixnet(P2PMixnetFile) = 0, bulletin(BulletinFile) = 1 }
BulletinFile = {
    meta: FileMeta, name: Option<String>, preview: Option<Vec<u8>>,
    voice: Option<VoiceMeta>, key: [u8; 32], nonce: [u8; 12], chunkSize: u32,
    chunks: Vec<[u8; 32]>, store: Store, expiresAt: u64
}
FileMeta = enum {
    general { mimeType: String, fileSize: u32 } = 0,
    image { general, width: u32, height: u32, thumbnail: Option<Vec<u8>> } = 1,
    video { general, duration: u32, thumbnail: Option<Vec<u8>> } = 2
}
VoiceMeta = { durationMs: u32, waveform: Vec<u8> }
Store = enum { bulletin { genesis: [u8; 32], mirror: Option<String> } = 0 }
```

## Vector A: an image with a caption (0012 vector A, uses C1)

Values:

```
messageId: "ATT-1"
timestamp: 1720000000000
richText: {
  text: Some("Our cat"),
  attachments: Some([ bulletin {
    meta: image { general: { mimeType: "image/jpeg", fileSize: 15 },
                  width: 640, height: 480,
                  thumbnail: Some(utf8("LEHV6nWB2yk8")) },   // the blurhash
    name: None, preview: None, voice: None,
    key: 0x11 × 32, nonce: 0x22 × 12, chunkSize: 2000000,
    chunks: [ C1.chunks[0] ],
    store: bulletin { genesis: devnet, mirror: None },
    expiresAt: 1721209600000
  } ])
}
```

Opaque message (194 bytes; the kind-250 form is 195):

```
0103144154542d310030fd7790010000000f011c4f7572206361740104010128696d6167652f6a7065670f00000080020000e001000001304c454856366e574232796b38000000111111111111111111111111111111111111111111111111111111111111111122222222222222222222222280841e0004d47b2b87847e22939dd7b1f54541fffbb4afefc09c582fbae8892d0682fc8a8a00e101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a5900003816c090010000
```

| Bytes (hex) | Field | Value |
|---|---|---|
| `0103` | compact length of the remote message | 192 (`0x0301 >> 2`) |
| `14` `4154542d31` | messageId | `"ATT-1"` |
| `0030fd7790010000` | timestamp | 1720000000000 |
| `00` | version | V1 |
| `0f` | contentKind | 15 `richText` |
| `01` `1c` `4f757220636174` | text | Some(`"Our cat"`) |
| `01` `04` | attachments | Some, 1 item |
| `01` | FileVariant | 1 `bulletin` |
| `01` | FileMeta | 1 `image` |
| `28` `696d6167652f6a706567` | mimeType | `"image/jpeg"` |
| `0f000000` | fileSize, u32 | 15 |
| `80020000` `e0010000` | width, height | 640, 480 |
| `01` `30` `4c454856366e574232796b38` | thumbnail | Some(12 bytes: the blurhash) |
| `00` `00` `00` | name, preview, voice | None, None, None |
| `11` × 32, `22` × 12 | key, nonce | |
| `80841e00` | chunkSize | 2000000 |
| `04` `d47b…8a8a` | chunks | 1, C1 |
| `00` `e101…0a59` `00` | store | `bulletin`, devnet, mirror None |
| `003816c090010000` | expiresAt | 1721209600000 |

`RichTextContent` alone: 176 bytes. `BulletinFile` alone: 164 bytes.

## Vector B: a voice note (0012 vector B, uses C2)

Values:

```
messageId: "ATT-2"
timestamp: 1720000000000
richText: {
  text: None,
  attachments: Some([ bulletin {
    meta: general { mimeType: "audio/ogg; codecs=opus", fileSize: 13 },
    name: None, preview: None,
    voice: Some({ durationMs: 4200, waveform: [0, 64, 128, 255] }),
    key: 0x11 × 32, nonce: 0x22 × 12, chunkSize: 8,
    chunks: [ C2.chunks[0], C2.chunks[1] ],
    store: bulletin { genesis: devnet,
                      mirror: Some("https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs/") },
    expiresAt: 1721209600000
  } ])
}
```

Opaque message (276 bytes; the kind-250 form is 278):

```
4904144154542d320030fd7790010000000f000104010058617564696f2f6f67673b20636f646563733d6f7075730d0000000000016810000010004080ff11111111111111111111111111111111111111111111111111111111111111112222222222222222222222220800000008f2413e6849beeed0945f57c6e2ad2123ff1fb177fa95f711eb0685786b434bb47e79076d84989135f84e2f00d739f3d071485f143ea485ede4cd2033f1ebb0a800e101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a5901e868747470733a2f2f6465766e65742d697066732e6170692e706f6c6b61646f74636f6d6d756e6974792e666f756e646174696f6e2f697066732f003816c090010000
```

| Bytes (hex) | Field | Value |
|---|---|---|
| `4904` | compact length | 274 (`0x0449 >> 2`) |
| `0f` | contentKind | 15 `richText` |
| `00` | text | None |
| `01` `04` `01` | attachments, 1 item, `bulletin` | |
| `00` `58` + 22 bytes `0d000000` | meta | `general { "audio/ogg; codecs=opus", 13 }` |
| `00` `00` | name, preview | None, None |
| `01` `68100000` `10` `004080ff` | voice | Some { 4200 ms, 4 samples } |
| `11` × 32, `22` × 12, `08000000` | key, nonce, chunkSize | chunkSize 8 |
| `08` + C2 hashes | chunks | 2 |
| `00` + genesis + `01` `e8` + 58 bytes | store | `bulletin`, devnet, mirror Some |
| `003816c090010000` | expiresAt | 1721209600000 |

## Negative case

A baseline decoder (`FileVariant` with index 0 only) fails on vector A at
the `01` variant byte. Under `scale-ts` the decode throws (tried
2026-09-24). The client must then show the whole message as unsupported
(0014, "What a baseline client sees").

## TODO

- Reproduce A and B in the pca codec and the desktop codec (M20).
- A vector with a `preview` and a `video` item (duration in seconds).
- A mixed-rail negative: a `RichText` with one `p2pMixnet` and one `bulletin`
  item must never be sent (sender check; the decoder accepts it).
