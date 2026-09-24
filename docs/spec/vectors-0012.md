# Test vectors: spec 0012 (attachment, kind 250)

Status: **draft, not yet cross-checked by a second codec.** Computed on
2026-09-24 with a throwaway script: SCALE by hand, BLAKE2b-256 from Python
`hashlib.blake2b(digest_size=32)`, AES-256-GCM from Node `crypto`. The pca
codec and the desktop codec must each reproduce these bytes before they are
pinned in `bot-core/test/codec.test.mjs` and `content.spec.ts`. A disagreement
is a bug in this file until proven otherwise.

Conventions are those of `vectors-0011.md`: `String` = compact length + UTF-8;
`Vec<T>` = compact count + items; `u32`/`u64` little-endian; `[u8; N]` raw,
no length; `Option<T>` = `00` or `01` + T; enums = one index byte + the
variant. The opaque message is a compact length then the remote message
(`messageId: String`, `timestamp: u64`, version `00`, content kind byte,
content). Kind 250 = `0xfa`.

## Layout

```
AttachmentContent = { items: Vec<Attachment>, caption: Option<String> }
Attachment = {
    mime: String, name: Option<String>, size: u64, media: Media,
    blurhash: Option<String>, thumbnail: Option<Vec<u8>>,
    key: [u8; 32], nonce: [u8; 12], chunkSize: u32, chunks: Vec<[u8; 32]>,
    store: Store, expiresAt: u64
}
Media = enum { file = 0, image { width: u32, height: u32 } = 1,
               video { width: u32, height: u32, durationMs: u32 } = 2,
               voice { durationMs: u32, waveform: Vec<u8> } = 3 }
Store = enum { bulletin { genesis: [u8; 32], mirror: Option<String> } = 0 }
```

Chunk crypto:

```
n        = ceil(size / chunkSize)
nonce_i  = nonce[0..8] : (nonce[8..12] XOR u32_be(i))
aad_i    = b"pcd-att-v1" : u32_le(i) : u32_le(n) : u64_le(size)
c_i      = AES-256-GCM(key, nonce_i, chunk_i, aad_i)      // ciphertext : tag(16)
chunks[i]= blake2b_256(c_i)
cid_i    = multibase b32( 01 55 a0e402 20 : chunks[i] )  // CIDv1, raw, blake2b-256
```

All vectors use `key = 0x11 × 32`, `nonce = 0x22 × 12`, and the devnet
Bulletin genesis `0xe101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a59`
(para 1010, read live 2026-09-24).

## Vector C1: one chunk

Plaintext `"hello, bulletin"` (15 bytes), `chunkSize = 2000000`, so `n = 1`.

| Item | Hex |
|---|---|
| nonce_0 | `222222222222222222222222` |
| aad_0 | `7063642d6174742d763100000000010000000f00000000000000` |
| c_0 (31 bytes) | `7f926b25afe3bf3d9053b2593ccf8785d9d92181762c9f5eb36cf0a96d4554` |
| chunks[0] | `d47b2b87847e22939dd7b1f54541fffbb4afefc09c582fbae8892d0682fc8a8a` |
| cid_0 | `bafk2bzacedkhwk4hqr7cfe4526y7krkb7753jl7pycofql525ces2buc7sfiu` |

A `TransactionStorage.store(c_0)` on Bulletin must emit
`Stored { content_hash = chunks[0] }` (TODO: confirm on devnet in M15).

## Vector C2: two chunks

Plaintext `"polkadot chat"` (13 bytes), `chunkSize = 8`, so `n = 2`
(chunk 0 = `"polkadot"`, chunk 1 = `" chat"`). Senders use 2,000,000; a
receiver accepts any `chunkSize` from 1 to 2,000,000.

| Item | chunk 0 | chunk 1 |
|---|---|---|
| nonce_i | `222222222222222222222222` | `222222222222222222222223` |
| aad_i | `7063642d6174742d763100000000020000000d00000000000000` | `7063642d6174742d763101000000020000000d00000000000000` |
| c_i | `67986b22a1abf02bcb5de371c38de836d3c4fd3d580848ad` (24 B) | `196f0194e977fac63158d4778d8a53ac4c540c207f` (21 B) |
| chunks[i] | `f2413e6849beeed0945f57c6e2ad2123ff1fb177fa95f711eb0685786b434bb4` | `7e79076d84989135f84e2f00d739f3d071485f143ea485ede4cd2033f1ebb0a8` |
| cid_i | `bafk2bzacedzecptijg7o5ueul5l4nyvneer76h5ro75jl5yr5mdik6dlinf3i` | `bafk2bzaceb7hsb3nqsmjcnpyjyxqbvzz6pihcsc7cq7kjbpn4tgsam7r5oykq` |

Negative checks a codec must make fail: swap c_0 and c_1; drop c_1; decrypt
c_0 with `size = 12` in the AAD.

## Vector A: an image (uses C1)

Values:

```
messageId: "ATT-1"
timestamp: 1720000000000
items: [ {
  mime: "image/jpeg", name: None, size: 15,
  media: image { width: 640, height: 480 },
  blurhash: Some("LEHV6nWB2yk8"), thumbnail: None,
  key: 0x11 × 32, nonce: 0x22 × 12, chunkSize: 2000000,
  chunks: [ C1.chunks[0] ],
  store: bulletin { genesis: devnet, mirror: None },
  expiresAt: 1721209600000        // timestamp + 14 days
} ]
caption: Some("Our cat")
```

Opaque message (195 bytes):

```
0503144154542d310030fd779001000000fa0428696d6167652f6a706567000f000000000000000180020000e001000001304c454856366e574232796b3800111111111111111111111111111111111111111111111111111111111111111122222222222222222222222280841e0004d47b2b87847e22939dd7b1f54541fffbb4afefc09c582fbae8892d0682fc8a8a00e101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a5900003816c090010000011c4f757220636174
```

Field by field:

| Bytes (hex) | Field | Value |
|---|---|---|
| `0503` | compact length of the remote message | 193 (two-byte mode: `0x0305 >> 2`) |
| `14` | compact length of messageId | 5 |
| `4154542d31` | messageId | `"ATT-1"` |
| `0030fd7790010000` | timestamp | 1720000000000 |
| `00` | version | 0 |
| `fa` | contentKind | 250 `attachment` |
| `04` | items count | 1 |
| `28` | mime length | 10 |
| `696d6167652f6a706567` | mime | `"image/jpeg"` |
| `00` | name | None |
| `0f00000000000000` | size, u64 | 15 |
| `01` | media tag | 1 `image` |
| `80020000` | width | 640 |
| `e0010000` | height | 480 |
| `01` `30` | blurhash Some, length | 12 |
| `4c454856366e574232796b38` | blurhash | `"LEHV6nWB2yk8"` |
| `00` | thumbnail | None |
| `11` × 32 | key | |
| `22` × 12 | nonce | |
| `80841e00` | chunkSize, u32 | 2000000 |
| `04` | chunks count | 1 |
| `d47b…8a8a` (32 B) | chunks[0] | C1 |
| `00` | store tag | 0 `bulletin` |
| `e101…0a59` (32 B) | genesis | devnet Bulletin |
| `00` | mirror | None |
| `003816c090010000` | expiresAt, u64 | 1721209600000 |
| `01` `1c` | caption Some, length | 7 |
| `4f757220636174` | caption | `"Our cat"` |

## Vector B: a voice note (uses C2)

Values:

```
messageId: "ATT-2"
timestamp: 1720000000000
items: [ {
  mime: "audio/ogg; codecs=opus", name: None, size: 13,
  media: voice { durationMs: 4200, waveform: [0, 64, 128, 255] },
  blurhash: None, thumbnail: None,
  key: 0x11 × 32, nonce: 0x22 × 12, chunkSize: 8,
  chunks: [ C2.chunks[0], C2.chunks[1] ],
  store: bulletin { genesis: devnet,
                    mirror: Some("https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs/") },
  expiresAt: 1721209600000
} ]
caption: None
```

Opaque message (278 bytes):

```
5104144154542d320030fd779001000000fa0458617564696f2f6f67673b20636f646563733d6f707573000d00000000000000036810000010004080ff000011111111111111111111111111111111111111111111111111111111111111112222222222222222222222220800000008f2413e6849beeed0945f57c6e2ad2123ff1fb177fa95f711eb0685786b434bb47e79076d84989135f84e2f00d739f3d071485f143ea485ede4cd2033f1ebb0a800e101f0fa4627d29a257645e02be86d80378fea1a2bf8fa6a918d150ebc760a5901e868747470733a2f2f6465766e65742d697066732e6170692e706f6c6b61646f74636f6d6d756e6974792e666f756e646174696f6e2f697066732f003816c09001000000
```

Field by field (from `fa`):

| Bytes (hex) | Field | Value |
|---|---|---|
| `5104` | compact length of the remote message | 276 (`0x0451 >> 2`) |
| `04` | items count | 1 |
| `58` + 22 bytes | mime | `"audio/ogg; codecs=opus"` |
| `00` | name | None |
| `0d00000000000000` | size | 13 |
| `03` | media tag | 3 `voice` |
| `68100000` | durationMs | 4200 |
| `10` `004080ff` | waveform, 4 samples | 0, 64, 128, 255 |
| `00` `00` | blurhash, thumbnail | None, None |
| `11` × 32, `22` × 12 | key, nonce | |
| `08000000` | chunkSize | 8 |
| `08` | chunks count | 2 |
| `f241…4bb4`, `7e79…b0a8` | chunks | C2 |
| `00` + genesis | store | `bulletin`, devnet |
| `01` `e8` + 58 bytes | mirror | `"https://devnet-ipfs.api.polkadotcommunity.foundation/ipfs/"` |
| `003816c090010000` | expiresAt | 1721209600000 |
| `00` | caption | None |

## Sizes (for the 3,584-byte budget)

| Content | Encoded `AttachmentContent` |
|---|---|
| Vector A without caption | 169 bytes |
| One photo, name `"IMG_0001.jpg"`, 2,048-byte thumbnail, 100-byte caption | 2,334 bytes |

## TODO

- Cross-check with the pca codec and the desktop codec.
- A `video` vector and a 4-item album with thumbnails dropped to fit.
- Store C1's `c_0` on devnet and record the block, index and the `Stored`
  event; fetch it back by `bitswap_v1_get(cid_0)` and by the gateway.

> Reviewer notes 2026-09-24: (1) vector A's 12-character blurhash is intentionally malformed (a real 4×3 hash is 28 characters); clients paint no placeholder for it. (2) The gating check is done: C1's `c_0` was stored on devnet Bulletin (`wss://bullet.sik.rocks`) in best block #970869 by an account authorized by `//Eve`; `Stored.content_hash` equals `chunks[0]`; fetched back by `bitswap_v1_get` and by the devnet gateway (desktop e2e:attach, 2026-09-24).

> Confirmed by the pca codec 2026-09-24 (`polkadot-chat-agents` branch `desktop/rfc-0003`, `bot-core/test/codec.test.mjs` and `test/attachments.test.mjs`): vectors A (195 bytes) and B (278 bytes) encode and re-decode byte for byte; C1 and C2 reproduce every nonce, AAD, ciphertext, content hash and CID; the three C2 negatives fail; the Sizes table (169 and 2,334 bytes) reproduces. No byte differs. pca's own gating run: C1's `c_0` stored by a fresh account authorized by `//Eve` (tx `0xdcd8112d…2eca`, best block #970865, `Stored { index: 0, content_hash = chunks[0] }`), fetched by `bitswap_v1_get` and by the gateway.
