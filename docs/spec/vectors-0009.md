# Test vectors: spec 0009 (fan-out groups)

Produced by the `pca` codec (`polkadot-chat-agents` branch `desktop/rfc-0003`,
`bot-core/vendor/app-chat-codec.mjs`: `encodeOpaqueGroupInfoMessage`,
`encodeOpaqueGroupMessage`, `encodeOpaqueGroupLeaveMessage`) on 2026-09-23.
The same bytes are pinned in `bot-core/test/codec.test.mjs`
(`GROUP_INFO_VECTOR`, `GROUP_MESSAGE_VECTOR`, `GROUP_LEAVE_VECTOR`). A second
codec must decode each vector to the values below and must encode the values
below to the same bytes.

Conventions are the same as `vectors-0008.md`. `String` is a SCALE compact
length, then UTF-8 bytes. `Vec<T>` is a compact count, then the items.
`u32` and `u64` are little-endian. The opaque message is a compact length,
then the remote message: `messageId: String`, `timestamp: u64`, a version
byte `0x00`, the content kind byte, then the content.

Content layout:

```
GroupInfo    = { groupId: String, name: String, admin: [u8; 32],
                 members: Vec<Member>, version: u32, createdAt: u64 }
Member       = { account: [u8; 32], username: String, joinedAt: u64 }
GroupMessage = { groupId: String, infoVersion: u32, seq: u64,
                 content: MessageContent }
GroupLeave   = { groupId: String }
```

## Rules the `pca` codec applies

- **AccountId** is 32 raw bytes, with no length prefix (the `admin` field and
  each member's `account`).
- **groupId** is a `String`, the same form as a message id (the textual UUID;
  the `pca` bot does not check the UUID format). It must be 1 to 256 bytes.
- **content** of a `groupMessage` is inline: the kind byte and the body of
  one message content, to the end of the remote message. It has no length
  prefix and no inner messageId or timestamp; the envelope's id and timestamp
  are the message's. The encoder takes an opaque message from any other
  encoder and keeps only its content.
- **No nesting.** A `groupMessage` cannot wrap kind 246, 247 or 248. The
  encoder throws; the decoder makes that message undecodable (the rest of
  the batch still decodes). A `groupMessage` with no content byte is also
  undecodable.
- **Limits.** The encoder refuses: a `name` that is empty or over 60
  characters, 0 or more than 16 members, a `username` over 64 characters, a
  `version` or `infoVersion` outside u32, a `seq`, `joinedAt` or `createdAt`
  outside u64, an account that is not 32 bytes. The decoder refuses more than
  16 members and bounds `name` at 240 bytes and `username` at 256 bytes.
- **seq and ephemeral content (a `pca` choice).** The bot's `typing` inside a
  `groupMessage` carries the bot's current `seq` and does not advance it. A
  receiver that does not store typing therefore sees no gap. Every other
  content advances `seq` by 1.

## Vector (a): `groupInfo` GRP-1

Values:

```
messageId: "GRP-1"            timestamp: 1720000000000
groupId:   "GRP-1"            name:      "Test group"
admin:     0x0101…01 (32 bytes of 0x01)
members:   [ { account: 0x0101…01, username: "alice.01", joinedAt: 1720000000000 },
             { account: 0x0202…02, username: "bob.02",   joinedAt: 1720000001000 } ]
version:   1                  createdAt: 1720000000000
```

The envelope messageId and the groupId are both `"GRP-1"` in this vector.

Opaque message (176 bytes):

```
b902144752502d310030fd779001000000f6144752502d3128546573742067726f7570010101010101010101010101010101010101010101010101010101010101010108010101010101010101010101010101010101010101010101010101010101010120616c6963652e30310030fd7790010000020202020202020202020202020202020202020202020202020202020202020218626f622e3032e833fd7790010000010000000030fd7790010000
```

Remote message (174 bytes) is the same without the first two bytes `b902`.

| Bytes (hex) | Field | Value |
|---|---|---|
| `b902` | compact length of the remote message | 174 (two-byte mode: `0x02b9 >> 2`) |
| `14` | compact length of messageId | 5 |
| `4752502d31` | messageId | `"GRP-1"` |
| `0030fd7790010000` | timestamp, u64 LE | 1720000000000 |
| `00` | version | 0 |
| `f6` | content kind | 246 (`groupInfo`) |
| `14` | compact length of groupId | 5 |
| `4752502d31` | groupId | `"GRP-1"` |
| `28` | compact length of name | 10 |
| `546573742067726f7570` | name | `"Test group"` |
| `0101…01` (32 bytes) | admin | 0x01 × 32 |
| `08` | compact count of members | 2 |
| `0101…01` (32 bytes) | members[0].account | 0x01 × 32 |
| `20` | compact length of members[0].username | 8 |
| `616c6963652e3031` | members[0].username | `"alice.01"` |
| `0030fd7790010000` | members[0].joinedAt, u64 LE | 1720000000000 |
| `0202…02` (32 bytes) | members[1].account | 0x02 × 32 |
| `18` | compact length of members[1].username | 6 |
| `626f622e3032` | members[1].username | `"bob.02"` |
| `e833fd7790010000` | members[1].joinedAt, u64 LE | 1720000001000 |
| `01000000` | version, u32 LE | 1 |
| `0030fd7790010000` | createdAt, u64 LE | 1720000000000 |

## Vector (b): `groupMessage` GRM-1

Values:

```
messageId: "GRM-1"            timestamp: 1720000002000
groupId:   "GRP-1"            infoVersion: 1            seq: 1
content:   text "hello all"
```

Opaque message (46 bytes):

```
b41447524d2d31d037fd779001000000f7144752502d31010000000100000000000000002468656c6c6f20616c6c
```

Remote message (45 bytes) is the same without the first byte `b4`.

| Bytes (hex) | Field | Value |
|---|---|---|
| `b4` | compact length of the remote message | 45 (one-byte mode: `0xb4 >> 2`) |
| `14` | compact length of messageId | 5 |
| `47524d2d31` | messageId | `"GRM-1"` |
| `d037fd7790010000` | timestamp, u64 LE | 1720000002000 |
| `00` | version | 0 |
| `f7` | content kind | 247 (`groupMessage`) |
| `14` | compact length of groupId | 5 |
| `4752502d31` | groupId | `"GRP-1"` |
| `01000000` | infoVersion, u32 LE | 1 |
| `0100000000000000` | seq, u64 LE | 1 |
| `00` | wrapped content kind | 0 (`text`) |
| `24` | compact length of the text | 9 |
| `68656c6c6f20616c6c` | text | `"hello all"` |

## Vector (c): `groupLeave` GRL-1

Values:

```
messageId: "GRL-1"            timestamp: 1720000003000
groupId:   "GRP-1"
```

Opaque message (23 bytes):

```
581447524c2d31b83bfd779001000000f8144752502d31
```

Remote message (22 bytes) is the same without the first byte `58`.

| Bytes (hex) | Field | Value |
|---|---|---|
| `58` | compact length of the remote message | 22 (one-byte mode: `0x58 >> 2`) |
| `14` | compact length of messageId | 5 |
| `47524c2d31` | messageId | `"GRL-1"` |
| `b83bfd7790010000` | timestamp, u64 LE | 1720000003000 |
| `00` | version | 0 |
| `f8` | content kind | 248 (`groupLeave`) |
| `14` | compact length of groupId | 5 |
| `4752502d31` | groupId | `"GRP-1"` |

## What the `pca` bot does with these kinds (devnet, 2026-09-23)

- It applies a `groupInfo` only from the admin it names, and only a higher
  `version`. On join it sends its `botInfo`, wrapped, to every member (this
  is its `seq` 1).
- It answers a member's text with one `groupMessage` to every other member:
  one envelope id and one timestamp for all copies, its next `seq`.
- It opens a chat request to a member it has no session with. The request
  text is `<botInfo name> — <botInfo description>`.
- It rejects a `groupMessage` from a non-member or from a member that sent
  `groupLeave`, and stops sending to a group whose roster does not list it.
- `typing` fans out while it thinks; `seen` does not.
