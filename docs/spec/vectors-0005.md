# Test vectors: spec 0005 (typing, seen)

Produced by the `pca` codec (`polkadot-chat-agents` branch `desktop/rfc-0003`,
`bot-core/vendor/app-chat-codec.mjs`: `encodeOpaqueTypingMessage`,
`encodeOpaqueSeenMessage`) on 2026-09-23. The same bytes are pinned in
`bot-core/test/codec.test.mjs`. A second codec must decode both vectors to the
values below and must encode the values below to the same bytes.

Conventions (the same as every other kind):

- The **opaque message** is `Bytes(remoteMessage)`: a SCALE compact length,
  then the remote message.
- The **remote message** is `messageId: String`, `timestamp: u64 LE`
  (milliseconds), `version: u8 = 0`, `contentKind: u8`, then the content.
- `String` is a SCALE compact length, then the UTF-8 bytes. `u64` is 8 bytes,
  little-endian. `u8` is one byte.
- `upTo` is a message id, encoded as a `String` like every other message id
  (the spec's `UUID`).

## Vector A: `typing` (kind 240 = `0xf0`)

Values:

```
messageId: "TYP-1"
timestamp: 1720000000000
until:     1720000006000   (timestamp + 6 s)
kind:      1               (working)
```

Opaque message (26 bytes):

```
64145459502d310030fd779001000000f07047fd779001000001
```

Remote message (25 bytes) is the same without the first byte `64`.

Field by field:

| Bytes (hex) | Field | Value |
|---|---|---|
| `64` | compact length of the remote message | 25 (one-byte mode: `0x64 >> 2`) |
| `14` | compact length of messageId | 5 |
| `5459502d31` | messageId | `"TYP-1"` |
| `0030fd7790010000` | timestamp, u64 LE | 1720000000000 |
| `00` | version | 0 |
| `f0` | contentKind | 240 `typing` |
| `7047fd7790010000` | until, u64 LE | 1720000006000 |
| `01` | kind, u8 | 1 `working` (0 `composing`, 2 `stopped`) |

## Vector B: `seen` (kind 241 = `0xf1`)

Values:

```
messageId: "SEN-1"
timestamp: 1720000002000
upTo:      "MSG-3"
at:        1720000002000
```

Opaque message (31 bytes):

```
781453454e2d31d037fd779001000000f1144d53472d33d037fd7790010000
```

Remote message (30 bytes) is the same without the first byte `78`.

Field by field:

| Bytes (hex) | Field | Value |
|---|---|---|
| `78` | compact length of the remote message | 30 (one-byte mode: `0x78 >> 2`) |
| `14` | compact length of messageId | 5 |
| `53454e2d31` | messageId | `"SEN-1"` |
| `d037fd7790010000` | timestamp, u64 LE | 1720000002000 |
| `00` | version | 0 |
| `f1` | contentKind | 241 `seen` |
| `14` | compact length of upTo | 5 |
| `4d53472d33` | upTo | `"MSG-3"` |
| `d037fd7790010000` | at, u64 LE | 1720000002000 |

## Codec rules used by `pca`

- The encoder accepts only typing kinds 0, 1 and 2, and `until` / `at` in the
  u64 range. It refuses an empty `upTo`.
- The decoder returns the typing kind byte as it is (a value above 2 is not
  rejected; the receiver ignores what it does not know). A message too short
  for its fields is undecodable (the other messages in the batch still
  decode).
- `pca` never persists, answers or dedups a received `typing` or `seen`.
