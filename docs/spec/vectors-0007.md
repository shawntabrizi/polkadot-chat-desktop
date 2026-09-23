# Test vectors: spec 0007 (tx intent, transactionReference)

Produced by the `pca` codec (`polkadot-chat-agents` branch `desktop/rfc-0003`,
`bot-core/vendor/app-chat-codec.mjs`: `encodeTxIntent`, `decodeTxIntent`,
`encodeOpaqueButtonsMessage`, `encodeOpaqueTransactionReferenceMessage`) on
2026-09-23. The same bytes are pinned in `bot-core/test/codec.test.mjs`. A
second codec must decode both vectors to the values below and must encode the
values below to the same bytes.

Conventions: the same as `vectors-0006.md` (opaque message = `Bytes(remoteMessage)`;
remote message = `messageId: String`, `timestamp: u64 LE`, `version: u8 = 0`,
`contentKind: u8`, content). In addition:

- `u64` and `u128` are fixed-width little-endian (8 and 16 bytes), not compact.
  `u32` is 4 bytes LE.
- `Option<T>` is `00` for None, or `01` then `T`.
- `chainId` is a `String`: the ASCII text `0x` + 64 lowercase hex digits
  (66 bytes), not 32 raw bytes. The vectors use the placeholder
  `0x` + 64 zeros; the real devnet Asset Hub value is in `contracts/meter.md`.
- The `tx` action (tag 3) is `tx(Bytes)`: a compact length, then the
  `TxIntent` SCALE bytes.

## Vector A: `buttons` (kind 242) with one `tx` button

Values:

```
messageId: "TX-1"
timestamp: 1720000000000
text:      "Top up to continue"
rows: [[ { label: "Top up 1 PAS", action: tx(TxIntent {
  version: 1
  chainId: "0x0000000000000000000000000000000000000000000000000000000000000000"
  calls: [ { kind: 1 (Revive), to: Some(0x1111111111111111111111111111111111111111),
             data: 0xdeadbeef, value: 10000000000,
             gasRefTime: None, gasProofSize: None, storageDepositLimit: None } ]
  display: { title: "Top up", description: "Adds 1 PAS", amount: Some("1"), asset: Some("PAS") }
  dryRunRequired: true
  expiresAt: 1720000060000
}) } ]]
oneShot:   false
```

The TxIntent alone (152 bytes; the payload of the `tx` action):

```
01090130783030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303004010150111111111111111111111111111111111111111110deadbeef00e40b5402000000000000000000000000000018546f702075702841646473203120504153010431010c50415301601afe7790010000
```

Opaque message (207 bytes):

```
35031054582d310030fd779001000000f248546f7020757020746f20636f6e74696e7565040430546f7020757020312050415303610201090130783030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303004010150111111111111111111111111111111111111111110deadbeef00e40b5402000000000000000000000000000018546f702075702841646473203120504153010431010c50415301601afe779001000000
```

Field by field:

| Bytes (hex) | Field | Value |
|---|---|---|
| `3503` | compact length of the remote message | 205 (two-byte mode: `0x0335 >> 2`) |
| `10` | compact length of messageId | 4 |
| `54582d31` | messageId | `"TX-1"` |
| `0030fd7790010000` | timestamp, u64 LE | 1720000000000 |
| `00` | version | 0 |
| `f2` | contentKind | 242 `buttons` |
| `48` | compact length of text | 18 |
| `546f7020757020746f20636f6e74696e7565` | text | `"Top up to continue"` |
| `04` | compact count of rows | 1 |
| `04` | row 0: compact count of buttons | 1 |
| `30` | compact length of label | 12 |
| `546f70207570203120504153` | label | `"Top up 1 PAS"` |
| `03` | action tag | 3 `tx` |
| `6102` | compact length of the TxIntent bytes | 152 (two-byte mode: `0x0261 >> 2`) |
| `01` | TxIntent.version, u8 | 1 |
| `0901` | compact length of chainId | 66 (two-byte mode: `0x0109 >> 2`) |
| `3078` + `30` × 64 | chainId (ASCII) | `"0x000…000"` |
| `04` | compact count of calls | 1 |
| `01` | call 0: kind, u8 | 1 (Revive contract call) |
| `01` | call 0: to, Option tag | Some |
| `50` | compact length of to | 20 |
| `1111111111111111111111111111111111111111` | to | 20 bytes `0x11` |
| `10` | compact length of data | 4 |
| `deadbeef` | data | `0xdeadbeef` |
| `00e40b54020000000000000000000000` | value, u128 LE | 10000000000 (1 PAS) |
| `00` | gasRefTime, Option<u64> | None |
| `00` | gasProofSize, Option<u64> | None |
| `00` | storageDepositLimit, Option<u128> | None |
| `18` | compact length of display.title | 6 |
| `546f70207570` | display.title | `"Top up"` |
| `28` | compact length of display.description | 10 |
| `41646473203120504153` | display.description | `"Adds 1 PAS"` |
| `01` `04` `31` | display.amount: Some, length 1, bytes | `Some("1")` |
| `01` `0c` `504153` | display.asset: Some, length 3, bytes | `Some("PAS")` |
| `01` | dryRunRequired, bool | true |
| `601afe7790010000` | expiresAt, u64 LE (unix ms) | 1720000060000 |
| `00` | oneShot | false |

## Vector B: `transactionReference` (kind 245 = `0xf5`)

Values:

```
messageId:       "REF-1"
timestamp:       1720000010000
chainId:         "0x0000000000000000000000000000000000000000000000000000000000000000"
hash:            32 bytes 0x22
status:          1 (in block)
block:           Some(123)
note:            "Top-up of 1 PAS"
intentMessageId: Some("TX-1")
```

Opaque message (147 bytes):

```
4502145245462d311057fd779001000000f5090130783030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303080222222222222222222222222222222222222222222222222222222222222222201017b0000003c546f702d7570206f66203120504153011054582d31
```

Field by field:

| Bytes (hex) | Field | Value |
|---|---|---|
| `4502` | compact length of the remote message | 145 (two-byte mode: `0x0245 >> 2`) |
| `14` | compact length of messageId | 5 |
| `5245462d31` | messageId | `"REF-1"` |
| `1057fd7790010000` | timestamp, u64 LE | 1720000010000 |
| `00` | version | 0 |
| `f5` | contentKind | 245 `transactionReference` |
| `0901` | compact length of chainId | 66 |
| `3078` + `30` × 64 | chainId (ASCII) | `"0x000…000"` |
| `80` | compact length of hash | 32 |
| `22` × 32 | hash | 32 bytes `0x22` |
| `01` | status, u8 | 1 in block (0 submitted, 2 finalized, 3 failed) |
| `01` | block, Option tag | Some |
| `7b000000` | block, u32 LE | 123 |
| `3c` | compact length of note | 15 |
| `546f702d7570206f66203120504153` | note | `"Top-up of 1 PAS"` |
| `01` | intentMessageId, Option tag | Some |
| `10` | compact length of intentMessageId | 4 |
| `54582d31` | intentMessageId | `"TX-1"` |

## Encoder and decoder rules used by `pca`

- TxIntent: `version` must be 1; `calls` 1 to 8; `data` at most 16 KiB;
  `dryRunRequired` must be true (the encoder refuses false; the decoder
  accepts false so the client can refuse to sign it, and rejects a bool byte
  other than `00`/`01`); a kind-1 call needs a 20-byte `to`; gas fields
  only on kind 1; `display.title` 1 to 60 characters, `description` at most
  280; trailing bytes after `expiresAt` make the intent undecodable.
- transactionReference: `status` 0 to 3 (above 3 is undecodable); `hash` 1
  to 64 bytes; `note` at most 140 characters (560 bytes on decode).
- Decoding a `buttons` message keeps the `tx` action as bytes; a client
  decodes the intent when the button is rendered or pressed.
- The fenced ```buttons block accepts `"action": {"tx": {chainId, calls,
  display, expiresAt, dryRunRequired?}}` with `to`/`data` as 0x hex and
  `value` as a decimal string (u128); an invalid intent leaves the whole block
  as text.
