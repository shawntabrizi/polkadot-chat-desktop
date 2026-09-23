# Test vectors: spec 0008 (botInfo)

Produced by the `pca` codec (`polkadot-chat-agents` branch `desktop/rfc-0003`,
`bot-core/vendor/app-chat-codec.mjs`: `encodeOpaqueBotInfoMessage`) on
2026-09-23. The same bytes are pinned in `bot-core/test/codec.test.mjs`. A
second codec must decode the vector to the values below and must encode the
values below to the same bytes.

Conventions are the same as `vectors-0006.md`: the opaque message is
`Bytes(remoteMessage)`; the remote message is `messageId: String`,
`timestamp: u64 LE`, `version: u8 = 0`, `contentKind: u8`, then the content.
`String` is a SCALE compact length, then UTF-8 bytes. `Vec<T>` is a SCALE
compact count, then the items. `u16` is two bytes, little-endian.

Content layout:

```
BotInfo = { kind: u8, name: String, description: String, greeting: String,
            commands: Vec<Command>, version: u16 LE }
Command = { name: String, description: String }
```

## Vector: `botInfo` (kind 244 = `0xf4`)

Values:

```
messageId:   "BOT-1"
timestamp:   1720000000000
kind:        1 (agent)
name:        "Guide"
description: "Polkadot support guide"
greeting:    "Hi! Ask me about Polkadot."
commands: [
  { name: "staking",    description: "Staking basics" },
  { name: "governance", description: "How OpenGov works" },
]
version:     1
```

Opaque message (130 bytes):

```
010214424f542d310030fd779001000000f40114477569646558506f6c6b61646f7420737570706f7274206775696465684869212041736b206d652061626f757420506f6c6b61646f742e081c7374616b696e67385374616b696e672062617369637328676f7665726e616e636544486f77204f70656e476f7620776f726b730100
```

Remote message (128 bytes) is the same without the first two bytes `0102`.

Field by field:

| Bytes (hex) | Field | Value |
|---|---|---|
| `0102` | compact length of the remote message | 128 (two-byte mode: `0x0201 >> 2`) |
| `14` | compact length of messageId | 5 |
| `424f542d31` | messageId | `"BOT-1"` |
| `0030fd7790010000` | timestamp, u64 LE | 1720000000000 |
| `00` | version | 0 |
| `f4` | contentKind | 244 `botInfo` |
| `01` | kind, u8 | 1 agent |
| `14` | compact length of name | 5 |
| `4775696465` | name | `"Guide"` |
| `58` | compact length of description | 22 |
| `506f6c6b61646f7420737570706f7274206775696465` | description | `"Polkadot support guide"` |
| `68` | compact length of greeting | 26 |
| `4869212041736b206d652061626f757420506f6c6b61646f742e` | greeting | `"Hi! Ask me about Polkadot."` |
| `08` | compact count of commands | 2 |
| `1c` | command 0: compact length of name | 7 |
| `7374616b696e67` | command 0 name | `"staking"` |
| `38` | command 0: compact length of description | 14 |
| `5374616b696e6720626173696373` | command 0 description | `"Staking basics"` |
| `28` | command 1: compact length of name | 10 |
| `676f7665726e616e6365` | command 1 name | `"governance"` |
| `44` | command 1: compact length of description | 17 |
| `486f77204f70656e476f7620776f726b73` | command 1 description | `"How OpenGov works"` |
| `0100` | version, u16 LE | 1 |

## Encoder and decoder rules used by `pca`

- The encoder refuses: `kind` other than 0, 1, 2; an empty `name` or one
  over 40 characters; `description` or `greeting` over 280 characters; more
  than 32 commands; a command name that is empty, over 32 characters, starts
  with `/` or has white space; a command description over 80 characters; a
  `version` outside 0–65535.
- The decoder bounds each string in bytes (4 bytes per character: name 160,
  description and greeting 1120, command name 128, command description 320)
  and the command count at 32. Over a bound, the message is undecodable; the
  other messages in the batch still decode.
- The decoder accepts any `kind` byte (a later revision can add kinds); it
  exposes it as `botKind`.
- `pca` sends `botInfo` on the identity channel right after the accept (with
  the accept and the welcome text in one statement), and on a text `/start`
  (then the greeting as a normal text). A received `botInfo` is stored per
  peer (a lower `version` than the stored one is ignored) and never answered.
