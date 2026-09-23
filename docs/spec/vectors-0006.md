# Test vectors: spec 0006 (buttons, buttonPress)

Produced by the `pca` codec (`polkadot-chat-agents` branch `desktop/rfc-0003`,
`bot-core/vendor/app-chat-codec.mjs`: `encodeOpaqueButtonsMessage`,
`encodeOpaqueButtonPressMessage`) on 2026-09-23. The same bytes are pinned in
`bot-core/test/codec.test.mjs`. A second codec must decode both vectors to the
values below and must encode the values below to the same bytes.

Conventions (the same as every other kind):

- The **opaque message** is `Bytes(remoteMessage)`: a SCALE compact length,
  then the remote message.
- The **remote message** is `messageId: String`, `timestamp: u64 LE`
  (milliseconds), `version: u8 = 0`, `contentKind: u8`, then the content.
- `String` and `Bytes` are a SCALE compact length, then the bytes (UTF-8 for a
  string). `Vec<T>` is a SCALE compact count, then the items. `bool` is one
  byte, `00` or `01`. `u8` is one byte.
- An enum is one tag byte, then the variant's value.

## Vector A: `buttons` (kind 242 = `0xf2`)

Values:

```
messageId: "BTN-1"
timestamp: 1720000000000
text:      "Pick one"
rows: [
  [ { label: "Echo",   action: command("echo hi") },
    { label: "Colour", action: callback(0x01 0x02) } ],
  [ { label: "Docs",   action: url("https://polkadot.com") } ],
]
oneShot:   false
```

Opaque message (83 bytes):

```
45011442544e2d310030fd779001000000f2205069636b206f6e650808104563686f001c6563686f20686918436f6c6f7572010801020410446f6373025068747470733a2f2f706f6c6b61646f742e636f6d00
```

Remote message (81 bytes) is the same without the first two bytes `4501`.

Field by field:

| Bytes (hex) | Field | Value |
|---|---|---|
| `4501` | compact length of the remote message | 81 (two-byte mode: `0x0145 >> 2`) |
| `14` | compact length of messageId | 5 |
| `42544e2d31` | messageId | `"BTN-1"` |
| `0030fd7790010000` | timestamp, u64 LE | 1720000000000 |
| `00` | version | 0 |
| `f2` | contentKind | 242 `buttons` |
| `20` | compact length of text | 8 |
| `5069636b206f6e65` | text | `"Pick one"` |
| `08` | compact count of rows | 2 |
| `08` | row 0: compact count of buttons | 2 |
| `10` | row 0 button 0: compact length of label | 4 |
| `4563686f` | label | `"Echo"` |
| `00` | action tag | 0 `command` |
| `1c` | compact length of the command string | 7 |
| `6563686f206869` | command | `"echo hi"` |
| `18` | row 0 button 1: compact length of label | 6 |
| `436f6c6f7572` | label | `"Colour"` |
| `01` | action tag | 1 `callback` |
| `08` | compact length of the callback bytes | 2 |
| `0102` | callback payload | `0x01 0x02` |
| `04` | row 1: compact count of buttons | 1 |
| `10` | row 1 button 0: compact length of label | 4 |
| `446f6373` | label | `"Docs"` |
| `02` | action tag | 2 `url` |
| `50` | compact length of the url | 20 |
| `68747470733a2f2f706f6c6b61646f742e636f6d` | url | `"https://polkadot.com"` |
| `00` | oneShot | false |

## Vector B: `buttonPress` (kind 243 = `0xf3`)

Values:

```
envelope messageId: "PRS-1"
timestamp:          1720000001000
messageId:          "BTN-1"   (the buttons message; pca calls it targetMessageId)
row:                0
index:              1
payload:            0x01 0x02
```

Opaque message (28 bytes):

```
6c145052532d31e833fd779001000000f31442544e2d310001080102
```

Remote message (27 bytes) is the same without the first byte `6c`.

Field by field:

| Bytes (hex) | Field | Value |
|---|---|---|
| `6c` | compact length of the remote message | 27 (one-byte mode: `0x6c >> 2`) |
| `14` | compact length of envelope messageId | 5 |
| `5052532d31` | envelope messageId | `"PRS-1"` |
| `e833fd7790010000` | timestamp, u64 LE | 1720000001000 |
| `00` | version | 0 |
| `f3` | contentKind | 243 `buttonPress` |
| `14` | compact length of messageId | 5 |
| `42544e2d31` | messageId (the pressed buttons message) | `"BTN-1"` |
| `00` | row, u8 | 0 |
| `01` | index, u8 | 1 |
| `08` | compact length of payload | 2 |
| `0102` | payload | `0x01 0x02` |

## Decoder rules used by `pca`

- Rows: at most 8. Buttons in a row: at most 4. A larger count makes the
  message undecodable (the other messages in the batch still decode).
- Label: at most 160 bytes on decode (40 characters of up to 4 UTF-8 bytes);
  the encoder refuses more than 40 characters or an empty label.
- `callback` and `buttonPress.payload`: at most 256 bytes.
- `tx` (tag 3): opaque `Bytes` until RFC 0007.
- An action tag above 3 has no known length, so the whole message is
  undecodable. (The spec asks for a disabled button; that needs a
  length-prefixed action, which the current layout does not have.)
- `oneShot` must be `00` or `01`.
